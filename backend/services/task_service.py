import json
import hashlib
import logging
import os
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from backend.adapters.gemini_image_generation import GeminiImageRequest, generate_gemini_image
from backend.adapters.openai_image_generation import OpenAIImageRequest, generate_openai_image
from backend.core.database import SessionLocal
from backend.core.redaction import redact_json_dumps, redact_secrets, redact_text
from backend.core.serializers import model_to_dict
from backend.core.security_context import (
    SecurityContextError,
    build_security_context,
    require_security_context_allowed,
)
from backend.core.task_limits import (
    enforce_task_create_limits,
    enforce_task_retry_limit,
    ensure_task_not_cancelled,
    task_is_cancelled,
)
from backend.db.models import Asset, ModelConfig, Project, Task, utc_now
from backend.services import asset_service, model_service
from backend.services.image_request_params import append_aspect_ratio_instruction, resolve_image_request_params
from backend.tasks.queue import queue_manager

STALE_TASK_MESSAGE = "已清理过期的本地演示任务。"
PROVIDER_TIMEOUT_MESSAGE = "模型请求超过配置的超时时间，或后端进程在任务完成前停止。"
UNSUPPORTED_PROVIDER_MESSAGE = "当前真实图片生成仅支持 OpenAI gpt-image-2，或 Google Gemini 图像模型（Nano Banana / Nano Banana Pro / Nano Banana 2）的原生 API / 中转 Base URL。请在模型设置中选择这些模型线路。"
DATA_FLOW_CONFIRMATION_MESSAGE = "真实云端/中转生成前必须确认数据流：将发送的素材、提示词、目标 Provider/Endpoint、归档保存和素材授权。"
FALLBACK_DISABLED_MESSAGE = "中转失败，未改发官方服务。"
UNUSABLE_IMAGE_MODEL_IDS = {"studio-custom-image", "relay-text-smoke-test", "custom-rest-model"}
RUNNABLE_GEMINI_IMAGE_MODEL_IDS = {
    "gemini-2.5-flash-image",
    "gemini-3-pro-image-preview",
    "gemini-3.1-flash-image-preview",
}
RUNNABLE_IMAGE_MODEL_IDS = {"gpt-image-2", *RUNNABLE_GEMINI_IMAGE_MODEL_IDS}
RELAY_CHANNEL_ERROR_MARKERS = ("无可用渠道", "no available channel", "no available distributor", "distributor")
logger = logging.getLogger(__name__)

def list_tasks(db: Session, project_id: int | None = None) -> list[dict[str, Any]]:
    mark_stale_live_tasks(db)
    query = db.query(Task)
    query = query.filter((Task.error_message.is_(None)) | (Task.error_message != STALE_TASK_MESSAGE))
    if project_id is not None:
        query = query.filter(Task.project_id == project_id)
    return [model_to_dict(task) for task in query.order_by(Task.updated_at.desc()).all()]


def get_task(db: Session, task_id: int) -> dict[str, Any] | None:
    mark_stale_live_tasks(db)
    task = db.get(Task, task_id)
    return model_to_dict(task) if task else None


def queue_task(
    db: Session,
    module: str,
    task_type: str,
    payload: dict[str, Any],
    provider: str = "OpenAI",
    model_name: str = "gpt-image-2",
) -> dict[str, Any]:
    enforce_task_create_limits(
        db,
        provider=provider,
        project_id=payload.get("project_id"),
        task_type=task_type,
    )
    task = Task(
        project_id=payload.get("project_id"),
        template_id=payload.get("template_id"),
        module=module,
        task_type=task_type,
        provider=provider,
        model_name=model_name,
        provider_config_id=payload.get("provider_config_id"),
        status="queued",
        progress=0,
        input_payload_json=redact_json_dumps(payload.get("inputs", payload)),
        prompt_snapshot_json=redact_json_dumps(payload.get("prompt_snapshot", {})),
        params_snapshot_json=redact_json_dumps(payload.get("params_snapshot", {})),
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    queue_manager.enqueue(model_to_dict(task))
    return model_to_dict(task)


def queue_provider_image_task(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    if db.get(Project, int(payload["project_id"])) is None:
        raise ValueError("图片生成任务所属项目不存在，请先创建或选择项目。")
    _ensure_data_flow_confirmed(payload)
    payload = _normalize_provider_image_payload(db, payload)
    payload_json = payload.get("payload_json") or {}
    incoming_params = payload.get("params_snapshot") or {}
    timeout_sec = _provider_task_timeout(db, payload.get("provider_config_id"), incoming_params)
    image_params = resolve_image_request_params(payload_json, incoming_params)
    prompt_snapshot = payload.get("prompt_snapshot") or {}
    resolved_prompt = append_aspect_ratio_instruction(
        str(
            prompt_snapshot.get("resolved_prompt")
            or payload_json.get("prompt")
            or payload.get("payload_summary")
            or "生成一张精修的室内设计效果图。"
        ),
        image_params,
    )
    task_type = payload.get("task_type") or "provider_image_generation"
    provider = payload.get("provider") or "OpenAI"
    model_name = payload.get("model_name") or "gpt-image-2"
    request_signature = _provider_task_signature(
        module=payload["module"],
        task_type=task_type,
        project_id=payload.get("project_id"),
        provider=provider,
        model_name=model_name,
        provider_config_id=payload.get("provider_config_id"),
        payload_json=payload_json,
        prompt=resolved_prompt,
        params={
            **incoming_params,
            "output_count": image_params.output_count,
            "aspect_ratio": image_params.aspect_ratio,
            "requested_size": image_params.requested_size,
        },
    )
    duplicate = _find_recent_duplicate_provider_task(
        db,
        module=payload["module"],
        task_type=task_type,
        project_id=payload.get("project_id"),
        request_signature=request_signature,
    )
    if duplicate:
        return duplicate

    task_payload = {
        "project_id": payload.get("project_id"),
        "provider_config_id": payload.get("provider_config_id"),
        "inputs": {
            "capability": payload.get("capability"),
            "payload_summary": payload.get("payload_summary"),
            "payload_json": payload_json,
        },
        "prompt_snapshot": {
            **prompt_snapshot,
            "resolved_prompt": resolved_prompt,
        },
        "params_snapshot": {
            "real_provider": True,
            "capability": payload.get("capability"),
            **incoming_params,
            "timeout_sec": timeout_sec,
            "output_count": image_params.output_count,
            "aspect_ratio": image_params.aspect_ratio,
            "requested_size": image_params.requested_size,
            "request_signature": request_signature,
            "data_flow_confirmed": True,
            "allow_provider_fallback": bool(incoming_params.get("allow_provider_fallback") or payload.get("allow_provider_fallback")),
        },
    }
    task = queue_task(
        db=db,
        module=payload["module"],
        task_type=task_type,
        payload=task_payload,
        provider=provider,
        model_name=model_name,
    )
    task_id = int(task["id"])
    _start_provider_image_worker(
        task_id=task_id,
        payload=payload,
        resolved_prompt=resolved_prompt,
        image_params={
            "aspect_ratio": image_params.aspect_ratio,
            "requested_size": image_params.requested_size,
            "output_count": image_params.output_count,
        },
    )
    return task


def finalize_task(
    db: Session,
    task_id: int,
    output_payload: dict[str, Any],
    status: str = "success",
    progress: int = 100,
) -> dict[str, Any] | None:
    task = db.get(Task, task_id)
    if not task:
        return None
    if task.started_at is None:
        task.started_at = utc_now()
    task.status = status
    task.progress = progress
    task.error_message = None if status == "success" else task.error_message
    task.output_payload_json = redact_json_dumps(output_payload)
    task.finished_at = utc_now()
    db.commit()
    db.refresh(task)
    queue_manager.update(
        task_id,
        {
            "status": status,
            "progress": progress,
            "error_message": None if status == "success" else task.error_message,
            "output_payload_json": output_payload,
        },
    )
    return model_to_dict(task)


def _mark_running(db: Session, task_id: int) -> dict[str, Any] | None:
    task = db.get(Task, task_id)
    if task is None:
        return None
    if task.status == "cancelled":
        return model_to_dict(task)
    task.status = "running"
    task.progress = 15
    task.started_at = utc_now()
    db.commit()
    db.refresh(task)
    queue_manager.update(task_id, {"status": "running", "progress": 15})
    return model_to_dict(task)


def _mark_failed(db: Session, task_id: int, error: str) -> dict[str, Any] | None:
    task = db.get(Task, task_id)
    if task is None:
        return None
    safe_error = redact_text(error) or "任务失败。"
    error_type = classify_task_error(safe_error)
    task.status = "failed"
    task.progress = 100
    task.error_message = safe_error
    task.output_payload_json = redact_json_dumps({"error": safe_error, "error_type": error_type})
    task.finished_at = utc_now()
    db.commit()
    db.refresh(task)
    queue_manager.update(
        task_id,
        {"status": "failed", "progress": 100, "error_message": safe_error, "error_type": error_type},
    )
    return model_to_dict(task)


def classify_task_error(error: str) -> str:
    normalized = error.lower()
    if any(marker in normalized for marker in ("unsupported", "不支持", "未知渲染引擎")):
        return "unsupported_platform_or_provider"
    if any(marker in normalized for marker in ("api key is required", "缺少 base url", "missing base url", "未配置", "尚未配置")):
        return "config_error"
    if any(marker in normalized for marker in ("http 401", "http 403", "authentication", "unauthorized", "forbidden", "鉴权", "凭据")):
        return "authentication_error"
    if any(marker in normalized for marker in ("http 429", "rate limit", "too many requests", "限流")):
        return "rate_limit"
    if any(marker in normalized for marker in ("timed out", "timeout", "超时", "超过配置的超时时间")):
        return "timeout"
    if any(marker in normalized for marker in ("network", "connect", "dns", "tls", "ssl", "网络")):
        return "network_error"
    if any(marker in normalized for marker in ("json", "parse", "schema", "response did not", "响应", "解析")):
        return "invalid_response_or_parsing_error"
    if any(marker in normalized for marker in ("file", "path", "文件", "目录")):
        return "file_error"
    if any(marker in normalized for marker in ("database", "sqlite", "sqlalchemy", "数据库")):
        return "database_error"
    return "provider_error"


def mark_task_failed(db: Session, task_id: int, error: str) -> dict[str, Any] | None:
    return _mark_failed(db, task_id, error)


def mark_task_running(db: Session, task_id: int) -> dict[str, Any] | None:
    return _mark_running(db, task_id)


def mark_stale_live_tasks(db: Session) -> None:
    now = utc_now()
    stale_tasks = (
        db.query(Task)
        .filter(Task.status.in_(("running", "queued")))
        .all()
    )
    if not stale_tasks:
        return
    changed = False
    for task in stale_tasks:
        timeout_sec = _task_timeout_sec(task)
        started_at = _aware_datetime(task.started_at or task.created_at)
        elapsed_sec = max(0, int((now - started_at).total_seconds()))
        grace_sec = max(60, timeout_sec) if _is_provider_task(task) else 60
        if elapsed_sec <= timeout_sec + grace_sec:
            continue
        task.status = "failed" if _is_provider_task(task) else "cancelled"
        task.progress = 100
        task.error_message = redact_text(PROVIDER_TIMEOUT_MESSAGE if _is_provider_task(task) else STALE_TASK_MESSAGE)
        task.output_payload_json = redact_json_dumps(
            {
                "error": task.error_message,
                "error_type": "timeout" if _is_provider_task(task) else "cancelled_stale_task",
                "elapsed_sec": elapsed_sec,
                "timeout_sec": timeout_sec,
            }
        )
        task.finished_at = task.finished_at or utc_now()
        queue_manager.update(
            int(task.id),
            {
                "status": task.status,
                "progress": task.progress,
                "error_message": task.error_message,
                "output_payload_json": {
                    "error": task.error_message,
                    "error_type": "timeout" if _is_provider_task(task) else "cancelled_stale_task",
                    "elapsed_sec": elapsed_sec,
                    "timeout_sec": timeout_sec,
                },
            },
        )
        changed = True
    if changed:
        db.commit()


def cancel_task(db: Session, task_id: int) -> dict[str, Any] | None:
    task = db.get(Task, task_id)
    if not task:
        return None
    task.status = "cancelled"
    task.progress = 100
    task.error_message = redact_text("用户取消任务。")
    task.finished_at = utc_now()
    db.commit()
    queue_manager.cancel(task_id)
    db.refresh(task)
    return model_to_dict(task)


def retry_task(db: Session, task_id: int) -> dict[str, Any] | None:
    task = db.get(Task, task_id)
    if not task:
        return None
    enforce_task_retry_limit(task)
    if task.status not in {"failed", "cancelled"}:
        raise ValueError("只有失败或已取消的任务可以重试。")
    if not task.task_type.startswith("provider_"):
        raise ValueError("该任务无法从安全快照自动重放，请回到对应工作流重新提交。")
    enforce_task_create_limits(
        db,
        provider=task.provider,
        project_id=task.project_id,
        task_type=task.task_type,
    )
    task.status = "queued"
    task.progress = 0
    task.retry_count += 1
    task.error_message = None
    task.output_payload_json = None
    task.started_at = None
    task.finished_at = None
    db.commit()
    db.refresh(task)
    queue_manager.enqueue(model_to_dict(task))
    inputs = _json_dict(task.input_payload_json)
    prompt_snapshot = _json_dict(task.prompt_snapshot_json)
    params_snapshot = _json_dict(task.params_snapshot_json)
    payload = {
        "project_id": task.project_id,
        "module": task.module,
        "task_type": task.task_type,
        "capability": inputs.get("capability"),
        "provider": task.provider,
        "model_name": task.model_name,
        "provider_config_id": task.provider_config_id,
        "payload_summary": inputs.get("payload_summary"),
        "payload_json": inputs.get("payload_json") or {},
        "prompt_snapshot": prompt_snapshot,
        "params_snapshot": params_snapshot,
        "data_flow_confirmed": params_snapshot.get("data_flow_confirmed") is True,
        "allow_provider_fallback": params_snapshot.get("allow_provider_fallback") is True,
    }
    _start_provider_image_worker(
        task_id=task.id,
        payload=payload,
        resolved_prompt=str(prompt_snapshot.get("resolved_prompt") or ""),
        image_params={
            "aspect_ratio": params_snapshot.get("aspect_ratio") or "1:1",
            "requested_size": params_snapshot.get("requested_size") or "1024x1024",
            "output_count": params_snapshot.get("output_count") or 1,
        },
    )
    return model_to_dict(task)


def run_provider_image_task_now(task_id: int, payload: dict[str, Any], resolved_prompt: str, image_params: dict[str, Any]) -> dict[str, Any] | None:
    """Run a provider image task in a fresh session; used by the background worker and tests."""
    with SessionLocal() as db:
        try:
            return _run_provider_image_task(db, task_id, payload, resolved_prompt, image_params)
        except ValueError as exc:
            if task_is_cancelled(db, task_id):
                return get_task(db, task_id)
            raise exc


def get_task_result(db: Session, task_id: int) -> dict[str, Any] | None:
    mark_stale_live_tasks(db)
    task = db.get(Task, task_id)
    if not task:
        return None
    return {
        "task": model_to_dict(task),
        "result": json.loads(task.output_payload_json) if task.output_payload_json else {"assets": []},
    }


def _start_provider_image_worker(
    *,
    task_id: int,
    payload: dict[str, Any],
    resolved_prompt: str,
    image_params: dict[str, Any],
) -> None:
    thread = threading.Thread(
        target=_run_provider_image_task_safely,
        args=(task_id, payload, resolved_prompt, image_params),
        name=f"provider-image-task-{task_id}",
        daemon=True,
    )
    thread.start()


def _normalize_provider_image_payload(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(payload)
    module_name = _module_preference_name(str(normalized.get("module") or ""))
    provider_config_id = normalized.get("provider_config_id")
    requested_provider = str(normalized.get("provider") or "")
    requested_model = str(normalized.get("model_name") or "")
    if provider_config_id is not None:
        try:
            configured = db.get(ModelConfig, int(provider_config_id))
        except (TypeError, ValueError) as exc:
            raise ValueError("图片生成模型配置 ID 无效，请重新选择模型。") from exc
        if configured is None:
            raise ValueError("图片生成模型配置不存在或已删除，请重新选择模型。")
        if requested_provider and configured.provider_name != requested_provider:
            raise ValueError("客户端显示的 generationProvider 与 provider_config_id 不一致，请刷新模型配置。")
        if requested_model and configured.model_name != requested_model:
            raise ValueError("客户端显示的 generationModel 与 provider_config_id 不一致，请刷新模型配置。")
    elif requested_provider and requested_model:
        configured = (
            db.query(ModelConfig)
            .filter(ModelConfig.provider_name == requested_provider, ModelConfig.model_name == requested_model)
            .first()
        )
        if configured is None:
            raise ValueError("所选图片生成 provider/model 与已保存配置不一致，请在模型设置中重新保存。")

    selected = model_service.resolve_module_selection(
        db=db,
        module_name=module_name,
        provider_name=requested_provider,
        model_name=requested_model,
        provider_config_id=provider_config_id,
    )
    selected_model = str(selected.get("model_name") or requested_model or "")
    if requested_model in UNUSABLE_IMAGE_MODEL_IDS or selected_model in UNUSABLE_IMAGE_MODEL_IDS:
        raise ValueError(UNSUPPORTED_PROVIDER_MESSAGE)
    if not _selection_is_runnable_image_provider(selected):
        raise ValueError(UNSUPPORTED_PROVIDER_MESSAGE)
    normalized["provider_config_id"] = selected.get("provider_config_id")
    normalized["provider"] = selected.get("provider_name") or normalized.get("provider") or "OpenAI"
    normalized["model_name"] = selected.get("model_name") or normalized.get("model_name") or "gpt-image-2"
    return normalized


def _module_preference_name(module: str) -> str:
    if module in {"single_room_board", "multi_room_board"}:
        return "boards"
    if module == "custom_tasks":
        return "boards"
    return module or "boards"


def _provider_task_timeout(db: Session, provider_config_id: Any, incoming_params: dict[str, Any]) -> int:
    explicit_timeout = incoming_params.get("timeout_sec")
    if explicit_timeout is not None:
        return max(model_service.IMAGE_GENERATION_MIN_TIMEOUT_SEC, min(int(explicit_timeout), model_service.IMAGE_GENERATION_MAX_TIMEOUT_SEC))
    if provider_config_id is not None:
        try:
            config = db.get(ModelConfig, int(provider_config_id))
        except (TypeError, ValueError):
            config = None
        if config is not None and config.timeout_sec:
            return max(model_service.IMAGE_GENERATION_MIN_TIMEOUT_SEC, min(int(config.timeout_sec), model_service.IMAGE_GENERATION_MAX_TIMEOUT_SEC))
    return model_service.IMAGE_GENERATION_MIN_TIMEOUT_SEC


def _selection_is_runnable_image_provider(selection: dict[str, Any]) -> bool:
    provider = str(selection.get("provider_name") or "").lower()
    model = str(selection.get("model_name") or "")
    model_lower = model.lower()
    if model in UNUSABLE_IMAGE_MODEL_IDS:
        return False
    provider_id = str(selection.get("provider_id") or "").lower()
    compatibility_mode = str(selection.get("compatibility_mode") or "").lower()
    is_openai_image = (
        "openai" in provider
        or provider_id in {"openai", "custom_openai", "openai_compatible_custom"}
        or compatibility_mode == "openai_compatible"
    ) and model_lower == "gpt-image-2"
    is_gemini_image = (
        "gemini" in provider
        or provider_id == "google_gemini"
        or compatibility_mode == "gemini_compatible"
    ) and model_lower in RUNNABLE_GEMINI_IMAGE_MODEL_IDS
    return is_openai_image or is_gemini_image


def _run_provider_image_task_safely(task_id: int, payload: dict[str, Any], resolved_prompt: str, image_params: dict[str, Any]) -> None:
    try:
        run_provider_image_task_now(task_id, payload, resolved_prompt, image_params)
    except Exception:
        logger.exception("Provider image task %s crashed outside task error handling.", task_id)
        with SessionLocal() as db:
            _mark_failed(db, task_id, "真实图片任务执行异常，请查看后端日志。")


def _run_provider_image_task(
    db: Session,
    task_id: int,
    payload: dict[str, Any],
    resolved_prompt: str,
    image_params: dict[str, Any],
) -> dict[str, Any] | None:
    ensure_task_not_cancelled(db, task_id)
    _mark_running(db, task_id)
    ensure_task_not_cancelled(db, task_id)
    payload_json = payload.get("payload_json") or {}

    try:
        source_asset_ids = _source_asset_ids(payload_json)
        source_files = _source_asset_paths(db, source_asset_ids, project_id=payload.get("project_id"))
        if payload_json.get("require_source_images") and not source_files:
            raise ValueError("该图片任务要求参考图，但没有可读取的项目图片素材。")
        prompt = (
            resolved_prompt
            or (payload.get("prompt_snapshot") or {}).get("resolved_prompt")
            or payload_json.get("prompt")
            or payload.get("payload_summary")
            or "生成一张精修的室内设计效果图。"
        )
        runtime_payload = {
            "provider_config_id": payload.get("provider_config_id"),
            "provider_id": _provider_id(payload.get("provider")),
            "provider_label": payload.get("provider"),
            "model_id": payload.get("model_name") or "gpt-image-2",
            "model_label": payload.get("model_name") or "gpt-image-2",
            "capability": payload.get("capability") or "image_to_image",
        }
        requested_timeout = (payload.get("params_snapshot") or {}).get("timeout_sec")
        if requested_timeout is not None:
            runtime_payload["timeout_sec"] = int(requested_timeout)
        if not payload.get("provider_config_id"):
            runtime_payload.update(
                {
                    "routing_mode": "relay_base_url" if _looks_openai_relay(payload.get("provider")) else "direct_api",
                    "compatibility_mode": "openai_compatible" if _looks_openai_relay(payload.get("provider")) else "native",
                }
            )
        runtime = model_service.resolve_runtime_model_payload(db, runtime_payload)
        runtime["allow_provider_fallback"] = bool(
            payload.get("allow_provider_fallback")
            or (payload.get("params_snapshot") or {}).get("allow_provider_fallback")
            or (payload_json.get("data_flow") or {}).get("allow_provider_fallback")
        )
        runtime["data_flow_confirmed"] = _data_flow_confirmed(payload)
        _persist_model_runtime_snapshot(
            db,
            task_id,
            runtime,
            capability=str(payload.get("capability") or "image_to_image"),
        )
        if not _runtime_supports_image_generation(runtime):
            raise ValueError(UNSUPPORTED_PROVIDER_MESSAGE)
        ensure_task_not_cancelled(db, task_id)
        image_result = _generate_provider_image(runtime, payload, payload_json, prompt, source_files, image_params)
        ensure_task_not_cancelled(db, task_id)
        output_asset = asset_service.create_generated_output_asset(
            db,
            project_id=payload.get("project_id"),
            module=payload["module"],
            file_bytes=image_result["image_bytes"],
            mime_type=image_result.get("mime_type") or "image/png",
            provider=payload.get("provider") or runtime.get("provider_label") or "OpenAI",
            model_name=runtime.get("model_id") or payload.get("model_name") or "gpt-image-2",
            source_asset_ids=source_asset_ids,
            metadata={
                "endpoint_used": redact_text(str(image_result.get("endpoint_used") or "")),
                "status_code": image_result.get("status_code"),
                "aspect_ratio": image_params.get("aspect_ratio"),
                "requested_size": image_params.get("requested_size"),
                "output_count": image_params.get("output_count"),
                "review_schema_version": payload_json.get("review_schema_version"),
                "selected_item_ids": payload_json.get("selected_item_ids"),
                "room_labels": payload_json.get("rooms"),
                "delivery_prompt_version": payload_json.get("delivery_prompt_version"),
                "review_snapshot": payload_json.get("review_snapshot"),
                "reference_asset_ids": payload_json.get("reference_asset_ids"),
                "reference_review_snapshot": payload_json.get("reference_review_snapshot"),
                "use_reference_images": payload_json.get("use_reference_images"),
                "fallback_used": image_result.get("fallback_used"),
                "fallback_reason": redact_text(str(image_result.get("fallback_reason") or "")),
                "fallback_status": image_result.get("fallback_status"),
                "provider_response": redact_secrets(image_result.get("provider_response")),
            },
        )
        return finalize_task(
            db,
            task_id,
            {
                "message": "真实图片模型生成已完成。",
                "assets": [output_asset],
                "source_asset_ids": source_asset_ids,
                "endpoint_used": redact_text(str(image_result.get("endpoint_used") or "")),
                "fallback_used": image_result.get("fallback_used"),
                "fallback_reason": redact_text(str(image_result.get("fallback_reason") or "")),
                "fallback_status": image_result.get("fallback_status"),
                "aspect_ratio": image_params.get("aspect_ratio"),
                "requested_size": image_params.get("requested_size"),
                "actual_size": _asset_size_label(output_asset),
                "ratio_matched": _asset_ratio_matches(output_asset, str(image_params.get("aspect_ratio") or "1:1")),
            },
        )
    except Exception as exc:
        return _mark_failed(db, task_id, str(exc))


def _persist_model_runtime_snapshot(
    db: Session,
    task_id: int,
    runtime: dict[str, Any],
    *,
    capability: str,
) -> None:
    task = db.get(Task, task_id)
    if task is None:
        return
    params = _json_dict(task.params_snapshot_json)
    params["generation_runtime"] = model_service.build_runtime_snapshot(
        db,
        runtime,
        capability=capability,
    )
    task.params_snapshot_json = redact_json_dumps(params)
    task.provider_config_id = runtime.get("provider_config_id") or task.provider_config_id
    task.provider = str(runtime.get("provider_label") or task.provider)
    task.model_name = str(runtime.get("model_id") or task.model_name)
    db.commit()


def _generate_openai_image_with_relay_fallback(runtime: dict[str, Any], request: OpenAIImageRequest) -> dict[str, Any]:
    fallback_context = build_security_context(
        endpoint=request.base_url,
        provider_id=str(runtime.get("provider_id") or ""),
        routing_mode=str(runtime.get("routing_mode") or "direct_api"),
        compatibility_mode=str(runtime.get("compatibility_mode") or ""),
        provider_type=str(runtime.get("provider_type") or ""),
        task_type="provider_image_generation",
        data_flow_confirmed=bool(runtime.get("data_flow_confirmed")),
        require_data_flow=True,
        allow_provider_fallback=bool(runtime.get("allow_provider_fallback")),
    )
    try:
        return {**generate_openai_image(request), "fallback_used": False, "fallback_status": "provider_ok"}
    except RuntimeError as exc:
        error_text = redact_text(str(exc)) or "Provider request failed."
        fallback_allowed = fallback_context.fallback_state == "allowed"
        if not fallback_allowed:
            logger.warning(
                "Provider relay failed; fallback disabled. provider=%s model=%s error=%s",
                runtime.get("provider_id"),
                request.model_id,
                error_text,
            )
            raise RuntimeError(f"{FALLBACK_DISABLED_MESSAGE} provider_failed fallback_disabled：{error_text}") from exc
        if not _should_fallback_to_official_openai(runtime, request, error_text):
            raise
        logger.warning(
            "Provider relay failed; fallback allowed and will use official OpenAI. provider=%s model=%s error=%s",
            runtime.get("provider_id"),
            request.model_id,
            error_text,
        )
        fallback_request = OpenAIImageRequest(
            base_url="https://api.openai.com/v1",
            api_key=os.getenv("OPENAI_API_KEY", "").strip(),
            model_id=request.model_id,
            prompt=request.prompt,
            timeout_sec=request.timeout_sec,
            headers_json=None,
            source_files=request.source_files,
            size=request.size,
            require_source_images=request.require_source_images,
        )
        return {
            **generate_openai_image(fallback_request),
            "fallback_used": True,
            "fallback_reason": "relay_image_channel_unavailable",
            "fallback_status": "fallback_used",
        }


def _should_fallback_to_official_openai(runtime: dict[str, Any], request: OpenAIImageRequest, error: str) -> bool:
    official_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not official_key:
        return False
    if not request.model_id.startswith("gpt-image"):
        return False
    base_url_host = (urlparse(str(request.base_url or "")).hostname or "").lower()
    if base_url_host == "api.openai.com":
        return False
    routing_mode = str(runtime.get("routing_mode") or "").lower()
    compatibility_mode = str(runtime.get("compatibility_mode") or "").lower()
    if routing_mode != "relay_base_url" and compatibility_mode != "openai_compatible":
        return False
    normalized_error = error.lower()
    return any(marker in normalized_error for marker in RELAY_CHANNEL_ERROR_MARKERS)


def _source_asset_ids(payload_json: dict[str, Any]) -> list[int]:
    raw = payload_json.get("asset_ids") or payload_json.get("source_asset_ids") or []
    if isinstance(raw, int):
        return [raw]
    if isinstance(raw, list):
        return [int(item) for item in raw if isinstance(item, int) or str(item).isdigit()]
    return []


def _source_asset_paths(db: Session, asset_ids: list[int], *, project_id: int | None = None) -> list[Path]:
    paths = []
    for asset_id in asset_ids:
        asset = db.get(Asset, asset_id)
        if asset is None:
            raise ValueError(f"来源素材 {asset_id} 不存在。")
        if project_id is not None and asset.project_id != project_id:
            raise ValueError(f"来源素材 {asset_id} 不属于当前项目。")
        resolved = asset_service.get_asset_path(db, asset_id)
        if resolved is None:
            raise ValueError(f"来源素材 {asset_id} 的文件不存在或不可读取。")
        path, media_type = resolved
        if media_type and not media_type.startswith("image/"):
            raise ValueError(f"来源素材 {asset_id} 不是图片文件。")
        paths.append(path)
    return paths


def _provider_id(provider: str | None) -> str:
    if provider and "gemini" in provider.lower():
        return "google_gemini"
    if provider and "compatible" in provider.lower():
        return "custom_openai"
    if provider and "openai" in provider.lower():
        return "openai"
    if provider and "relay" in provider.lower():
        return "custom_openai"
    return provider.lower().replace(" / ", "_").replace(" ", "_") if provider else "openai"


def _looks_openai_relay(provider: str | None) -> bool:
    lowered = (provider or "").lower()
    return "compatible" in lowered or ("relay" in lowered and "openai" in lowered)


def _runtime_supports_openai_image_generation(runtime: dict[str, Any]) -> bool:
    provider_id = str(runtime.get("provider_id") or "").lower()
    compatibility_mode = str(runtime.get("compatibility_mode") or "").lower()
    model_id = str(runtime.get("model_id") or "").lower()
    is_openai_runtime = provider_id in {"openai", "custom_openai", "openai_compatible_custom"} or compatibility_mode == "openai_compatible"
    return is_openai_runtime and model_id == "gpt-image-2"


def _runtime_supports_gemini_image_generation(runtime: dict[str, Any]) -> bool:
    provider_id = str(runtime.get("provider_id") or "").lower()
    compatibility_mode = str(runtime.get("compatibility_mode") or "").lower()
    model_id = str(runtime.get("model_id") or "").lower()
    return (provider_id == "google_gemini" or compatibility_mode == "gemini_compatible") and model_id in RUNNABLE_GEMINI_IMAGE_MODEL_IDS


def _runtime_supports_image_generation(runtime: dict[str, Any]) -> bool:
    return _runtime_supports_openai_image_generation(runtime) or _runtime_supports_gemini_image_generation(runtime)


def _generate_provider_image(
    runtime: dict[str, Any],
    payload: dict[str, Any],
    payload_json: dict[str, Any],
    prompt: Any,
    source_files: list[Any],
    image_params: dict[str, Any],
) -> dict[str, Any]:
    if str(runtime.get("routing_mode") or "").lower() == "relay_base_url" and not runtime.get("base_url"):
        raise ValueError("中转 Base URL 不能为空。请在模型设置里填写中转地址，或配置对应的 *_RELAY_BASE_URL 环境变量。")

    if _runtime_supports_gemini_image_generation(runtime):
        base_url = runtime.get("base_url") or "https://generativelanguage.googleapis.com/v1beta"
        _require_runtime_allowed(runtime, base_url)
        request = GeminiImageRequest(
            base_url=base_url,
            api_key=runtime.get("api_key") or "",
            model_id=runtime.get("model_id") or payload.get("model_name") or "gemini-2.5-flash-image",
            prompt=str(prompt),
            timeout_sec=int(runtime.get("timeout_sec") or model_service.IMAGE_GENERATION_MIN_TIMEOUT_SEC),
            headers_json=runtime.get("headers_json"),
            source_files=source_files,
        )
        return {**generate_gemini_image(request), "fallback_used": False}

    base_url = runtime.get("base_url") or "https://api.openai.com/v1"
    _require_runtime_allowed(runtime, base_url)
    request = OpenAIImageRequest(
        base_url=base_url,
        api_key=runtime.get("api_key") or "",
        model_id=runtime.get("model_id") or payload.get("model_name") or "gpt-image-2",
        prompt=str(prompt),
        timeout_sec=int(runtime.get("timeout_sec") or model_service.IMAGE_GENERATION_MIN_TIMEOUT_SEC),
        headers_json=runtime.get("headers_json"),
        source_files=source_files,
        size=str(image_params.get("requested_size") or "1024x1024"),
        require_source_images=bool(payload_json.get("require_source_images")),
    )
    return _generate_openai_image_with_relay_fallback(runtime, request)


def _require_runtime_allowed(runtime: dict[str, Any], base_url: str) -> None:
    try:
        require_security_context_allowed(
            endpoint=base_url,
            provider_id=str(runtime.get("provider_id") or ""),
            routing_mode=str(runtime.get("routing_mode") or "direct_api"),
            compatibility_mode=str(runtime.get("compatibility_mode") or ""),
            provider_type=str(runtime.get("provider_type") or ""),
            task_type="provider_image_generation",
            data_flow_confirmed=bool(runtime.get("data_flow_confirmed")),
            require_data_flow=True,
            allow_provider_fallback=bool(runtime.get("allow_provider_fallback")),
        )
    except SecurityContextError as exc:
        raise ValueError(exc.reason) from exc


def _ensure_data_flow_confirmed(payload: dict[str, Any]) -> None:
    context = build_security_context(
        endpoint=None,
        provider_id=_provider_id(payload.get("provider")),
        routing_mode=str(payload.get("routing_mode") or "direct_api"),
        compatibility_mode=str(payload.get("compatibility_mode") or ""),
        task_type=str(payload.get("task_type") or "provider_image_generation"),
        data_flow_confirmed=_data_flow_confirmed(payload),
        require_data_flow=True,
        allow_provider_fallback=bool(payload.get("allow_provider_fallback") or (payload.get("params_snapshot") or {}).get("allow_provider_fallback")),
    )
    if context.data_flow_state != "confirmed":
        raise ValueError(DATA_FLOW_CONFIRMATION_MESSAGE)


def _data_flow_confirmed(payload: dict[str, Any]) -> bool:
    if payload.get("data_flow_confirmed") is True:
        return True
    params = payload.get("params_snapshot") or {}
    payload_json = payload.get("payload_json") or {}
    data_flow = payload_json.get("data_flow") or {}
    return params.get("data_flow_confirmed") is True or data_flow.get("confirmed") is True


def _asset_size_label(asset: dict[str, Any]) -> str | None:
    width = asset.get("width")
    height = asset.get("height")
    if isinstance(width, int) and isinstance(height, int) and width > 0 and height > 0:
        return f"{width}x{height}"
    return None


def _asset_ratio_matches(asset: dict[str, Any], aspect_ratio: str) -> bool | None:
    width = asset.get("width")
    height = asset.get("height")
    if not isinstance(width, int) or not isinstance(height, int) or width <= 0 or height <= 0:
        return None
    parts = aspect_ratio.split(":")
    if len(parts) != 2:
        return None
    try:
        target = float(parts[0]) / float(parts[1])
    except (ValueError, ZeroDivisionError):
        return None
    actual = width / height
    return abs(actual - target) / target <= 0.03


def _task_timeout_sec(task: Task) -> int:
    params = _json_dict(task.params_snapshot_json)
    value = params.get("timeout_sec")
    try:
        timeout_sec = int(value)
    except (TypeError, ValueError):
        timeout_sec = 300 if _is_provider_task(task) else 7200
    return max(60, timeout_sec)


def _json_dict(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _is_provider_task(task: Task) -> bool:
    return task.task_type.startswith("provider_") or _json_dict(task.params_snapshot_json).get("real_provider") is True


def _aware_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _provider_task_signature(
    *,
    module: str,
    task_type: str,
    project_id: Any,
    provider: str,
    model_name: str,
    provider_config_id: Any,
    payload_json: dict[str, Any],
    prompt: str,
    params: dict[str, Any],
) -> str:
    relevant_payload = {
        key: payload_json.get(key)
        for key in (
            "asset_ids",
            "source_asset_ids",
            "rooms",
            "room_type",
            "aspect_ratio",
            "output_count",
            "require_source_images",
        )
        if key in payload_json
    }
    relevant_params = {
        key: params.get(key)
        for key in (
            "aspect_ratio",
            "requested_size",
            "output_count",
            "budget_min",
            "budget_max",
            "item_budget_min",
            "item_budget_max",
        )
        if key in params
    }
    raw = {
        "module": module,
        "task_type": task_type,
        "project_id": project_id,
        "provider": provider,
        "model_name": model_name,
        "provider_config_id": provider_config_id,
        "payload": relevant_payload,
        "params": relevant_params,
        "prompt": " ".join(prompt.split()),
    }
    text = json.dumps(raw, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _find_recent_duplicate_provider_task(
    db: Session,
    *,
    module: str,
    task_type: str,
    project_id: Any,
    request_signature: str,
) -> dict[str, Any] | None:
    since = utc_now() - timedelta(minutes=30)
    query = (
        db.query(Task)
        .filter(Task.module == module)
        .filter(Task.task_type == task_type)
        .filter(Task.status.in_(("queued", "running")))
        .filter(Task.created_at >= since)
    )
    if project_id is None:
        query = query.filter(Task.project_id.is_(None))
    else:
        query = query.filter(Task.project_id == int(project_id))

    for task in query.order_by(Task.created_at.desc()).all():
        params = _json_dict(task.params_snapshot_json)
        if params.get("request_signature") == request_signature:
            queue_manager.update(
                int(task.id),
                {
                    "status": task.status,
                    "progress": task.progress,
                    "duplicate_reused": True,
                },
            )
            return model_to_dict(task)
    return None
