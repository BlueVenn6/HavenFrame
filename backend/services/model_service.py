import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy.orm import Session

from backend.adapters.model_connectivity import run_connectivity_smoke_test
from backend.core.model_registry import DEPRECATED_HIDDEN_MODEL_IDS, RELEASE_MODEL_KEYS, registry_audit
from backend.core.redaction import redact_url
from backend.core.secure_store import (
    clear_model_api_key,
    is_secret_reference,
    migrate_plain_api_key,
    resolve_model_api_key,
    store_model_api_key,
)
from backend.core.security_context import (
    SecurityContext,
    SecurityContextError,
    require_security_context_allowed,
)
from backend.core.serializers import model_to_dict
from backend.db.models import Asset, ModelConfig, ModuleModelPreference, Task


CAPABILITIES = [
    "text",
    "image",
    "vision",
    "floorplan",
    "board",
    "render",
    "text_to_image",
    "image_to_image",
    "inpaint",
    "style_transfer",
    "upscale",
    "segmentation",
    "multi_image_composition",
]


RUNNABLE_GEMINI_IMAGE_MODEL_IDS = {
    "gemini-2.5-flash-image",
    "gemini-3-pro-image-preview",
    "gemini-3.1-flash-image-preview",
}
RUNNABLE_INTERIOR_IMAGE_MODEL_IDS = {"gpt-image-2", *RUNNABLE_GEMINI_IMAGE_MODEL_IDS}
IMAGE_GENERATION_MIN_TIMEOUT_SEC = 900
IMAGE_GENERATION_MAX_TIMEOUT_SEC = 1800
MOBILE_IMAGE_ROUTE_ERROR = (
    "手机端真实室内出图线路只支持 OpenAI gpt-image-2 或 "
    "Google Gemini 图像模型（Nano Banana / Nano Banana Pro / Nano Banana 2）。"
)


def list_provider_configs(db: Session) -> list[dict[str, Any]]:
    migrate_plain_api_keys(db)
    migrate_image_generation_timeouts(db)
    return [
        _public_config(item)
        for item in db.query(ModelConfig).order_by(ModelConfig.priority.asc()).all()
        if (
            item.model_name not in DEPRECATED_HIDDEN_MODEL_IDS
            and item.provider_type != "local"
            and "comfy" not in item.provider_name.lower()
            and not _extra(item).get("hidden")
            and not _extra(item).get("deprecated")
            and _is_release_visible_config(item)
        )
    ]


def _is_release_visible_config(config: ModelConfig) -> bool:
    if config.provider_type != "built_in_official":
        return True
    extra = _extra(config)
    identity = (
        str(extra.get("provider_id") or "").strip(),
        str(extra.get("model_id") or config.model_name or "").strip(),
    )
    return identity in RELEASE_MODEL_KEYS


def list_mobile_image_routes(db: Session) -> list[dict[str, Any]]:
    configs = list_provider_configs(db)
    routes = []
    for config in configs:
        provider_id = config.get("provider_id")
        model_id = config.get("model_id")
        compatibility_mode = config.get("compatibility_mode")
        routing_mode = config.get("routing_mode")
        if model_id == "gpt-image-2" and (provider_id == "openai" or compatibility_mode == "openai_compatible"):
            routes.append(config)
        elif provider_id == "google_gemini" and model_id in RUNNABLE_GEMINI_IMAGE_MODEL_IDS:
            routes.append(config)
        elif compatibility_mode == "gemini_compatible" and model_id in RUNNABLE_GEMINI_IMAGE_MODEL_IDS:
            routes.append(config)
    return sorted(
        routes,
        key=lambda item: (
            0 if item.get("model_id") == "gpt-image-2" else 1,
            0 if item.get("routing_mode") == "direct_api" else 1,
            item.get("priority") or 100,
        ),
    )


def ensure_mobile_image_route(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    model_id = str(payload.get("model_name") or payload.get("model_id") or "")
    provider_id = str(payload.get("provider_id") or "")
    routing_mode = str(payload.get("routing_mode") or "direct_api")
    compatibility_mode = str(payload.get("compatibility_mode") or ("gemini_compatible" if provider_id == "google_gemini" else "openai_compatible"))
    if not _is_supported_mobile_image_route(provider_id, compatibility_mode, model_id):
        raise ValueError(MOBILE_IMAGE_ROUTE_ERROR)
    provider_name = "Google Gemini" if provider_id == "google_gemini" else "OpenAI"
    if compatibility_mode == "openai_compatible" and routing_mode == "relay_base_url":
        provider_name = "OpenAI-Compatible Relay"
    if compatibility_mode == "gemini_compatible" and routing_mode == "relay_base_url":
        provider_name = "Google Gemini"
    display_name = _default_mobile_image_display_name(model_id) or payload.get("display_name") or model_id

    existing = _find_route_config(db, provider_id, model_id, routing_mode, compatibility_mode)
    config_payload = {
        "id": existing.id if existing is not None else None,
        "provider_type": "built_in_official" if routing_mode == "direct_api" or provider_id == "google_gemini" else "openai_compatible",
        "provider_name": provider_name,
        "routing_mode": routing_mode,
        "compatibility_mode": compatibility_mode,
        "base_url": payload.get("base_url") or _default_route_base_url(provider_id, compatibility_mode, routing_mode),
        "api_key_encrypted": payload.get("api_key") or payload.get("api_key_encrypted"),
        "model_name": model_id,
        "capabilities_json": ["image", "text_to_image", "image_to_image"],
        "timeout_sec": max(IMAGE_GENERATION_MIN_TIMEOUT_SEC, int(payload.get("timeout_sec") or IMAGE_GENERATION_MIN_TIMEOUT_SEC)),
        "max_concurrency": 1,
        "is_enabled": bool(payload.get("is_enabled", True)),
        "priority": int(payload.get("priority") or (20 if provider_id == "openai" else 30)),
        "tags_json": ["mobile", "interior_render"],
        "extra_config_json": {
            "provider_id": provider_id,
            "provider_label": provider_name,
            "model_id": model_id,
            "label": display_name,
            "model_label": display_name,
            "display_name": display_name,
            "capability": "image",
            "capabilities": ["image_generation", "image_edit", "interior_render"],
            "compatibility_mode": compatibility_mode,
            "api_key_name": payload.get("api_key_name") or _default_api_key_name(provider_id),
            "default_endpoint_path": _default_endpoint_path(provider_id, compatibility_mode, model_id),
            "request_schema_type": _default_request_schema(provider_id, compatibility_mode, model_id),
            "response_schema_type": _default_response_schema(provider_id, compatibility_mode, model_id),
            "relay_supported": routing_mode == "relay_base_url",
            "direct_api_supported": routing_mode == "direct_api",
            "costly": True,
            "preview": model_id.endswith("-preview"),
            "recommended": model_id in RUNNABLE_INTERIOR_IMAGE_MODEL_IDS,
        },
    }
    return save_provider_config(db, config_payload)


def ensure_mobile_model_route(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    provider_id = str(payload.get("provider_id") or "").strip().lower()
    model_id = str(payload.get("model_name") or payload.get("model_id") or "").strip()
    if provider_id not in {"zhipu_glm", "zai_glm"}:
        return ensure_mobile_image_route(db, payload)
    if not model_id.lower().startswith("glm"):
        raise ValueError("移动端信息提取线路只允许 GLM 模型。")

    routing_mode = str(payload.get("routing_mode") or "direct_api")
    compatibility_mode = "openai_compatible"
    existing = _find_route_config(db, provider_id, model_id, routing_mode, compatibility_mode)
    display_name = str(payload.get("display_name") or model_id)
    config_payload = {
        "id": existing.id if existing is not None else None,
        "provider_type": "built_in_official" if routing_mode == "direct_api" else "openai_compatible",
        "provider_name": ("Z.AI International" if provider_id == "zai_glm" else "Zhipu GLM Mainland") if routing_mode == "direct_api" else "GLM-Compatible Relay",
        "routing_mode": routing_mode,
        "compatibility_mode": compatibility_mode,
        "base_url": payload.get("base_url") or _default_route_base_url(provider_id, compatibility_mode, routing_mode),
        "api_key_encrypted": payload.get("api_key") or payload.get("api_key_encrypted"),
        "model_name": model_id,
        "capabilities_json": ["text", "vision"],
        "timeout_sec": int(payload.get("timeout_sec") or 180),
        "max_concurrency": 1,
        "is_enabled": bool(payload.get("is_enabled", True)),
        "priority": int(payload.get("priority") or 40),
        "tags_json": ["mobile", "extraction", "glm"],
        "extra_config_json": {
            "provider_id": provider_id,
            "provider_label": "Z.AI International" if provider_id == "zai_glm" else "Zhipu GLM Mainland",
            "model_id": model_id,
            "label": display_name,
            "model_label": display_name,
            "display_name": display_name,
            "capability": "vision",
            "capabilities": ["text", "vision", "structured_information_extraction"],
            "compatibility_mode": compatibility_mode,
            "api_key_name": payload.get("api_key_name") or ("ZAI_API_KEY" if provider_id == "zai_glm" else "ZHIPU_API_KEY"),
            "default_endpoint_path": "/chat/completions",
            "request_schema_type": "openai_chat_completions",
            "response_schema_type": "openai_text",
            "relay_supported": True,
            "direct_api_supported": True,
            "recommended": model_id == "glm-4.5v",
        },
    }
    return save_provider_config(db, config_payload)


def _default_mobile_image_display_name(model_id: str) -> str | None:
    return {
        "gpt-image-2": "GPT Image 2",
        "gemini-2.5-flash-image": "Gemini 2.5 Flash Image (Nano Banana)",
        "gemini-3-pro-image-preview": "Gemini 3 Pro Image Preview (Nano Banana Pro)",
        "gemini-3.1-flash-image-preview": "Gemini 3.1 Flash Image Preview (Nano Banana 2)",
    }.get(model_id)


def _is_supported_mobile_image_route(provider_id: str, compatibility_mode: str, model_id: str) -> bool:
    model_id = model_id.strip()
    provider_id = provider_id.strip().lower()
    compatibility_mode = compatibility_mode.strip().lower()
    if model_id == "gpt-image-2":
        return provider_id == "openai" or compatibility_mode == "openai_compatible"
    if model_id in RUNNABLE_GEMINI_IMAGE_MODEL_IDS:
        return provider_id == "google_gemini" or compatibility_mode == "gemini_compatible"
    return False


def list_model_registry() -> dict[str, Any]:
    return registry_audit()


def create_provider_config(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    payload = _prepare_config_payload(payload)
    model_config = ModelConfig(**payload)
    db.add(model_config)
    db.commit()
    db.refresh(model_config)
    return _public_config(model_config)


def update_provider_config(db: Session, config_id: int, payload: dict[str, Any]) -> dict[str, Any] | None:
    config = db.get(ModelConfig, config_id)
    if not config:
        return None
    existing = {
        column.name: getattr(config, column.name)
        for column in ModelConfig.__table__.columns
        if column.name not in {"id", "created_at", "updated_at"}
    }
    existing_extra = _extra(config)
    existing["extra_config_json"] = existing_extra
    incoming_extra = payload.get("extra_config_json")
    merged = {**existing, **payload}
    if isinstance(incoming_extra, dict):
        merged["extra_config_json"] = {**existing_extra, **incoming_extra}
    else:
        merged["extra_config_json"] = existing_extra
    payload = _prepare_config_payload(merged)
    for key, value in payload.items():
        if hasattr(config, key):
            setattr(config, key, value)
    db.commit()
    db.refresh(config)
    return _public_config(config)


def save_provider_config(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    config_id = payload.pop("id", None)
    if config_id:
        updated = update_provider_config(db, int(config_id), payload)
        if updated is not None:
            return updated
    return create_provider_config(db, payload)


def _find_route_config(
    db: Session,
    provider_id: str,
    model_id: str,
    routing_mode: str,
    compatibility_mode: str,
) -> ModelConfig | None:
    for config in db.query(ModelConfig).filter(ModelConfig.model_name == model_id).all():
        extra = _extra(config)
        if (
            str(extra.get("provider_id") or "") == provider_id
            and config.routing_mode == routing_mode
            and str(extra.get("compatibility_mode") or "") == compatibility_mode
        ):
            return config
    return None


def _default_route_base_url(provider_id: str, compatibility_mode: str, routing_mode: str) -> str:
    if routing_mode == "relay_base_url":
        return ""
    if provider_id == "google_gemini" or compatibility_mode == "gemini_compatible":
        return "https://generativelanguage.googleapis.com/v1beta"
    if provider_id == "zhipu_glm":
        return "https://open.bigmodel.cn/api/paas/v4"
    if provider_id == "zai_glm":
        return "https://api.z.ai/api/paas/v4"
    return "https://api.openai.com/v1"


def validate_provider_config(db: Session, config_id: int) -> dict[str, Any] | None:
    config = db.get(ModelConfig, config_id)
    if not config:
        return None
    return {
        "id": config_id,
        "status": _extra(config).get("last_test_status", "not_tested"),
        "provider_name": config.provider_name,
        "routing_mode": config.routing_mode,
        "message": "Use POST /api/models/test with credentials to run a live connectivity test.",
    }


def test_model_connection(
    db: Session,
    payload: dict[str, Any],
    transport: httpx.BaseTransport | None = None,
) -> dict[str, Any]:
    migrate_plain_api_keys(db)
    merged = _merge_test_payload_with_config(db, payload)
    merged = _apply_env_defaults(merged)
    policy_error = _url_policy_error(merged)
    if policy_error:
        return _policy_failure_result(merged, policy_error)
    result = run_connectivity_smoke_test(merged, transport=transport)
    config_id = merged.get("provider_config_id")
    if config_id and result.get("error_type") == "model_lookup_unavailable":
        evidence = _successful_image_task_evidence(db, int(config_id))
        if evidence is not None:
            result = {
                **result,
                "ok": True,
                "endpoint_used": evidence["endpoint_used"],
                "status_code": None,
                "response_preview": f"任务 #{evidence['task_id']} 已成功返回并保存图片。",
                "normalized_output": f"已通过任务 #{evidence['task_id']} 的真实出图和落盘文件验证。",
                "error_type": None,
                "error": None,
                "raw_error_preview": None,
                "release_status": "PASS",
                "verification_source": "successful_task_history",
                "verified_task_id": evidence["task_id"],
            }
    if config_id:
        _store_last_test_result(db, int(config_id), result)
    return result


def _successful_image_task_evidence(db: Session, config_id: int) -> dict[str, Any] | None:
    tasks = (
        db.query(Task)
        .filter(Task.provider_config_id == config_id, Task.status == "success")
        .order_by(Task.id.desc())
        .limit(50)
        .all()
    )
    for task in tasks:
        try:
            output = json.loads(task.output_payload_json or "{}")
        except json.JSONDecodeError:
            continue
        if not isinstance(output, dict):
            continue
        raw_assets = output.get("assets")
        if not isinstance(raw_assets, list) or not raw_assets:
            continue
        asset_ids = [
            int(item["id"])
            for item in raw_assets
            if isinstance(item, dict) and isinstance(item.get("id"), int)
        ]
        if len(asset_ids) != len(raw_assets):
            continue
        assets = db.query(Asset).filter(Asset.id.in_(asset_ids)).all()
        if len(assets) != len(asset_ids):
            continue
        if not all(
            asset.mime_type
            and asset.mime_type.startswith("image/")
            and Path(asset.file_path).is_file()
            for asset in assets
        ):
            continue
        return {
            "task_id": task.id,
            "endpoint_used": redact_url(str(output.get("endpoint_used") or "")) or None,
        }
    return None


def resolve_runtime_model_payload(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    migrate_plain_api_keys(db)
    merged = _merge_test_payload_with_config(db, payload)
    config_id = merged.get("provider_config_id")
    if config_id and not merged.get("api_key"):
        config = db.get(ModelConfig, int(config_id))
        if config is not None and config.api_key_encrypted:
            merged["api_key"] = resolve_model_api_key(config.api_key_encrypted)
    provider_id = str(merged.get("provider_id") or "")
    compatibility_mode = str(merged.get("compatibility_mode") or "")
    routing_mode = str(merged.get("routing_mode") or "direct_api")
    model_id = str(merged.get("model_id") or merged.get("model_name") or "")
    if not merged.get("base_url"):
        merged["base_url"] = _default_route_base_url(provider_id, compatibility_mode, routing_mode)
    if not merged.get("endpoint_path"):
        merged["endpoint_path"] = _default_endpoint_path(provider_id, compatibility_mode, model_id)
    merged = _apply_env_defaults(merged)
    _enforce_url_policy(merged)
    return merged


def build_runtime_snapshot(
    db: Session,
    runtime: dict[str, Any],
    *,
    capability: str,
) -> dict[str, Any]:
    """Return the non-secret routing facts used by a queued model request."""
    config_id = runtime.get("provider_config_id")
    config: ModelConfig | None = None
    if config_id is not None:
        try:
            config = db.get(ModelConfig, int(config_id))
        except (TypeError, ValueError):
            config = None

    base_url = str(runtime.get("base_url") or "").rstrip("/")
    endpoint_path = str(runtime.get("endpoint_path") or "").strip()
    if (
        capability == "image_to_image"
        and str(runtime.get("compatibility_mode") or "") in {"native", "openai_compatible"}
    ):
        endpoint_path = "/images/edits"
    resolved_endpoint = base_url
    if base_url and endpoint_path:
        resolved_endpoint = f"{base_url}/{endpoint_path.lstrip('/')}"

    return {
        "snapshot_schema_version": 1,
        "capability": capability,
        "provider_config_id": int(config_id) if config_id is not None else None,
        "provider_id": str(runtime.get("provider_id") or ""),
        "provider_label": str(runtime.get("provider_label") or ""),
        "model_id": str(runtime.get("model_id") or runtime.get("model_name") or ""),
        "routing_mode": str(runtime.get("routing_mode") or "direct_api"),
        "compatibility_mode": str(runtime.get("compatibility_mode") or "native"),
        "base_url": redact_url(base_url) if base_url else None,
        "endpoint_path": endpoint_path or None,
        "resolved_endpoint": redact_url(resolved_endpoint) if resolved_endpoint else None,
        "config_updated_at": config.updated_at.isoformat() if config is not None and config.updated_at else None,
        "config_source": "model_config" if config is not None else "runtime_default_or_environment",
    }


def clear_provider_api_key(db: Session, config_id: int) -> dict[str, Any] | None:
    config = db.get(ModelConfig, config_id)
    if config is None:
        return None
    clear_model_api_key(config.api_key_encrypted)
    config.api_key_encrypted = None
    db.commit()
    db.refresh(config)
    return _public_config(config)


def migrate_plain_api_keys(db: Session) -> int:
    changed = 0
    for config in db.query(ModelConfig).all():
        if not config.api_key_encrypted or is_secret_reference(config.api_key_encrypted):
            continue
        config.api_key_encrypted = migrate_plain_api_key(config.api_key_encrypted)
        changed += 1
    if changed:
        db.commit()
    return changed


def migrate_image_generation_timeouts(db: Session) -> int:
    changed = 0
    for config in db.query(ModelConfig).all():
        extra = _with_connectivity_defaults(
            provider_name=config.provider_name,
            model_name=config.model_name,
            routing_mode=config.routing_mode,
            provider_type=config.provider_type,
            extra=_extra(config),
        )
        model_id = str(extra.get("model_id") or config.model_name)
        if model_id not in RUNNABLE_INTERIOR_IMAGE_MODEL_IDS:
            continue
        if int(config.timeout_sec or 0) >= IMAGE_GENERATION_MIN_TIMEOUT_SEC:
            continue
        config.timeout_sec = IMAGE_GENERATION_MIN_TIMEOUT_SEC
        changed += 1
    if changed:
        db.commit()
    return changed


def test_all_configured_models(
    db: Session,
    payload: dict[str, Any] | None = None,
    transport: httpx.BaseTransport | None = None,
) -> list[dict[str, Any]]:
    include_cost_risk = bool((payload or {}).get("include_costly") or (payload or {}).get("include_cost_risk"))
    allowed_routing_modes = set((payload or {}).get("routing_modes") or ["direct_api", "relay_base_url"])
    allowed_capabilities = set((payload or {}).get("capabilities") or [])
    test_prompt = (payload or {}).get("test_prompt") or "Return the word OK."
    results: list[dict[str, Any]] = []
    for config in db.query(ModelConfig).filter(ModelConfig.is_enabled.is_(True)).order_by(ModelConfig.priority.asc()).all():
        public = _public_config(config)
        capability = public.get("capability") or _primary_capability(public.get("capabilities_json") or [])
        if public["routing_mode"] not in allowed_routing_modes:
            continue
        if allowed_capabilities and capability not in allowed_capabilities:
            continue
        test_payload = {
            "provider_config_id": config.id,
            "provider_id": public["provider_id"],
            "provider_label": public["provider_label"],
            "model_id": public["model_id"],
            "model_label": public["model_label"],
            "capability": capability,
            "routing_mode": public["routing_mode"],
            "compatibility_mode": public["compatibility_mode"],
            "base_url": public.get("base_url"),
            "endpoint_path": public.get("default_endpoint_path"),
            "headers_json": public.get("headers_json"),
            "body_template_json": public.get("payload_template_json"),
            "test_prompt": test_prompt,
            "timeout_sec": public.get("timeout_sec") or 30,
        }
        env_payload = _apply_env_defaults(test_payload)
        if public.get("needs_official_id_verification"):
            results.append(_skipped_result(public, "needs_official_id_verification", "Official API model id is not confirmed; live test disabled."))
            continue
        if public["provider_id"] == "jimeng_consumer_app":
            results.append(_skipped_result(public, "unsupported_consumer_app", "Jimeng Consumer App is not an API provider."))
            continue
        if public["provider_id"] == "volcengine_jimeng":
            results.append(
                _skipped_result(
                    public,
                    "unsupported_auth",
                    "Volcengine Jimeng AK/SK signing is not implemented yet.",
                )
            )
            continue
        if public["routing_mode"] == "relay_base_url" and not env_payload.get("base_url"):
            results.append(run_connectivity_smoke_test(env_payload, transport=transport))
            continue
        if _has_cost_risk(capability) and not include_cost_risk and not _supports_non_costly_probe(public):
            results.append(_skipped_result(public, "skipped_cost_risk", "Skipped image model. Set LIVE_COSTLY_MODEL_TESTS=1 or include_costly=true to run it."))
            continue
        results.append(test_model_connection(db, test_payload, transport=transport))
    return results


def list_capabilities() -> list[str]:
    return CAPABILITIES


def resolve_module_selection(
    db: Session,
    module_name: str,
    provider_name: str | None = None,
    model_name: str | None = None,
    provider_config_id: int | None = None,
) -> dict[str, Any]:
    selected: ModelConfig | None = None
    if provider_config_id is not None:
        selected = db.get(ModelConfig, provider_config_id)
    elif provider_name and model_name:
        selected = (
            db.query(ModelConfig)
            .filter(ModelConfig.provider_name == provider_name, ModelConfig.model_name == model_name)
            .first()
        )

    if selected is None:
        preference = (
            db.query(ModuleModelPreference)
            .filter(ModuleModelPreference.module_name == module_name)
            .first()
        )
        if preference is not None and preference.default_provider_config_id is not None:
            selected = db.get(ModelConfig, preference.default_provider_config_id)
        if selected is None and preference is not None:
            preferred_models = (
                json.loads(preference.priority_order_json)
                if isinstance(preference.priority_order_json, str)
                else preference.priority_order_json
            )
            for preferred_model in preferred_models:
                selected = (
                    db.query(ModelConfig)
                    .filter(ModelConfig.model_name == preferred_model, ModelConfig.is_enabled.is_(True))
                    .first()
                )
                if selected is not None:
                    break

    if selected is None:
        selected = db.query(ModelConfig).filter(ModelConfig.is_enabled.is_(True)).order_by(ModelConfig.priority.asc()).first()

    if selected is None:
        return {
            "provider_config_id": None,
            "provider_name": provider_name or "OpenAI",
            "model_name": model_name or "gpt-image-2",
        }

    public = _public_config(selected)
    return {
        "provider_config_id": selected.id,
        "provider_name": selected.provider_name,
        "model_name": selected.model_name,
        "provider_id": public.get("provider_id"),
        "compatibility_mode": public.get("compatibility_mode"),
    }


def list_module_preferences(db: Session) -> list[dict[str, Any]]:
    return [model_to_dict(item) for item in db.query(ModuleModelPreference).order_by(ModuleModelPreference.module_name.asc()).all()]


def update_module_preference(db: Session, module_name: str, payload: dict[str, Any]) -> dict[str, Any]:
    preference = (
        db.query(ModuleModelPreference)
        .filter(ModuleModelPreference.module_name == module_name)
        .first()
    )
    if preference is None:
        preference = ModuleModelPreference(module_name=module_name, priority_order_json="[]", fallback_enabled=True)
        db.add(preference)
    if "priority_order_json" in payload and isinstance(payload["priority_order_json"], list):
        payload["priority_order_json"] = json.dumps(payload["priority_order_json"], ensure_ascii=False)
    for key, value in payload.items():
        if hasattr(preference, key):
            setattr(preference, key, value)
    db.commit()
    db.refresh(preference)
    return model_to_dict(preference)


def _encode_json_payload(payload: dict[str, Any]) -> dict[str, Any]:
    encoded = dict(payload)
    for key in (
        "capabilities_json",
        "tags_json",
        "extra_config_json",
        "headers_json",
        "query_params_json",
        "payload_template_json",
        "response_mapping_json",
    ):
        if key in encoded and isinstance(encoded[key], (dict, list)):
            encoded[key] = json.dumps(encoded[key], ensure_ascii=False)
    return encoded


def _prepare_config_payload(payload: dict[str, Any]) -> dict[str, Any]:
    prepared = dict(payload)
    extra = dict(prepared.get("extra_config_json") or {})
    for key in (
        "provider_id",
        "provider_label",
        "model_id",
        "model_label",
        "display_name",
        "short_name",
        "capability",
    ):
        if key in prepared:
            value = prepared.pop(key)
            if value not in (None, ""):
                extra[key] = value
    if "compatibility_mode" in prepared:
        extra["compatibility_mode"] = prepared.pop("compatibility_mode")
    if "api_key_name" in prepared:
        extra["api_key_name"] = prepared.pop("api_key_name")
    extra = _with_connectivity_defaults(
        provider_name=prepared.get("provider_name") or "",
        model_name=prepared.get("model_name") or "",
        routing_mode=prepared.get("routing_mode") or "direct_api",
        provider_type=prepared.get("provider_type") or "",
        extra=extra,
    )
    model_id = str(extra.get("model_id") or prepared.get("model_name") or "")
    if model_id in RUNNABLE_INTERIOR_IMAGE_MODEL_IDS:
        requested_timeout = int(prepared.get("timeout_sec") or IMAGE_GENERATION_MIN_TIMEOUT_SEC)
        prepared["timeout_sec"] = max(
            IMAGE_GENERATION_MIN_TIMEOUT_SEC,
            min(requested_timeout, IMAGE_GENERATION_MAX_TIMEOUT_SEC),
        )
    if prepared.get("routing_mode") == "relay_base_url" and not str(prepared.get("base_url") or "").strip():
        raise ValueError("中转 Base URL 不能为空。请保存完整的 HTTPS 中转地址后再应用模型线路。")
    _enforce_url_policy(
        {
            "base_url": prepared.get("base_url"),
            "endpoint": prepared.get("endpoint"),
            "provider_id": extra.get("provider_id"),
            "routing_mode": prepared.get("routing_mode") or "direct_api",
            "compatibility_mode": extra.get("compatibility_mode"),
            "provider_type": prepared.get("provider_type"),
        }
    )
    api_key = prepared.get("api_key") or prepared.get("api_key_encrypted")
    if api_key and is_secret_reference(str(api_key)):
        prepared["api_key_encrypted"] = str(api_key)
    elif api_key:
        prepared["api_key_encrypted"] = store_model_api_key(
            str(api_key),
            str(prepared.get("api_key_encrypted") or "") if is_secret_reference(prepared.get("api_key_encrypted")) else None,
        )
    prepared["extra_config_json"] = extra
    prepared.pop("api_key", None)
    prepared.pop("access_key", None)
    prepared.pop("secret_key", None)
    return _encode_json_payload(prepared)


def _public_config(config: ModelConfig) -> dict[str, Any]:
    data = model_to_dict(config)
    data.pop("api_key_encrypted", None)
    extra = _with_connectivity_defaults(
        provider_name=config.provider_name,
        model_name=config.model_name,
        routing_mode=config.routing_mode,
        provider_type=config.provider_type,
        extra=dict(data.get("extra_config_json") or {}),
    )
    data["extra_config_json"] = extra
    data["provider_id"] = extra["provider_id"]
    data["provider_label"] = extra["provider_label"]
    data["model_id"] = extra["model_id"]
    data["model_label"] = extra["model_label"]
    data["display_name"] = extra.get("display_name") or extra["model_label"]
    data["short_name"] = extra.get("short_name")
    data["capability"] = extra["capability"]
    data["registry_capabilities"] = extra.get("capabilities", [])
    data["modality"] = extra.get("modality", [])
    data["api_surface"] = extra.get("api_surface")
    data["recommended"] = bool(extra.get("recommended"))
    data["deprecated"] = bool(extra.get("deprecated"))
    data["preview"] = bool(extra.get("preview"))
    data["costly"] = bool(extra.get("costly"))
    data["direct_api_supported"] = bool(extra.get("direct_api_supported", True))
    data["relay_supported"] = bool(extra.get("relay_supported", False))
    data["needs_official_id_verification"] = bool(extra.get("needs_official_id_verification"))
    data["status_reason"] = extra.get("status_reason")
    data["hidden"] = bool(extra.get("hidden"))
    data["compatibility_mode"] = extra["compatibility_mode"]
    data["api_key_name"] = extra.get("api_key_name")
    data["required_auth_fields"] = extra["required_auth_fields"]
    data["default_endpoint_path"] = extra["default_endpoint_path"]
    data["request_schema_type"] = extra["request_schema_type"]
    data["response_schema_type"] = extra["response_schema_type"]
    data["last_test_status"] = extra.get("last_test_status", "not_tested")
    data["last_test_at"] = extra.get("last_test_at")
    data["last_latency_ms"] = extra.get("last_latency_ms")
    data["last_error_summary"] = extra.get("last_error_summary")
    data["has_api_key"] = bool(config.api_key_encrypted)
    return data


def _with_connectivity_defaults(
    *,
    provider_name: str,
    model_name: str,
    routing_mode: str,
    provider_type: str,
    extra: dict[str, Any],
) -> dict[str, Any]:
    provider_id = extra.get("provider_id") or _provider_id(provider_name, provider_type)
    compatibility_mode = extra.get("compatibility_mode") or _default_compatibility(provider_id, provider_type, routing_mode)
    capabilities = extra.get("capabilities") or []
    capability = extra.get("capability") or _default_capability(model_name, capabilities)
    return {
        **extra,
        "provider_id": provider_id,
        "provider_label": extra.get("provider_label") or provider_name,
        "model_id": extra.get("model_id") or model_name,
        "model_label": extra.get("model_label") or extra.get("display_name") or extra.get("label") or model_name,
        "display_name": extra.get("display_name") or extra.get("model_label") or extra.get("label") or model_name,
        "short_name": extra.get("short_name"),
        "capabilities": extra.get("capabilities") or [],
        "modality": extra.get("modality") or [],
        "api_surface": extra.get("api_surface"),
        "recommended": extra.get("recommended", False),
        "deprecated": extra.get("deprecated", False),
        "preview": extra.get("preview", False),
        "costly": extra.get("costly", False),
        "direct_api_supported": extra.get("direct_api_supported", True),
        "relay_supported": extra.get("relay_supported", False),
        "needs_official_id_verification": extra.get("needs_official_id_verification", False),
        "status_reason": extra.get("status_reason"),
        "hidden": extra.get("hidden", False),
        "capability": capability,
        "compatibility_mode": compatibility_mode,
        "api_key_name": extra.get("api_key_name") or _default_api_key_name(provider_id),
        "required_auth_fields": extra.get("required_auth_fields") or _required_auth_fields(provider_id, routing_mode),
        "default_endpoint_path": extra.get("default_endpoint_path") or _default_endpoint_path(provider_id, compatibility_mode, model_name),
        "request_schema_type": extra.get("request_schema_type") or _default_request_schema(provider_id, compatibility_mode, model_name),
        "response_schema_type": extra.get("response_schema_type") or _default_response_schema(provider_id, compatibility_mode, model_name),
        "last_test_status": extra.get("last_test_status", "not_tested"),
        "last_test_at": extra.get("last_test_at"),
        "last_latency_ms": extra.get("last_latency_ms"),
        "last_error_summary": extra.get("last_error_summary"),
    }


def _merge_test_payload_with_config(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    merged = dict(payload)
    config_id = merged.get("provider_config_id")
    if config_id:
        config = db.get(ModelConfig, int(config_id))
        if config is not None:
            public = _public_config(config)
            merged = {
                "provider_config_id": config.id,
                "provider_id": public["provider_id"],
                "provider_label": public["provider_label"],
                "model_id": public["model_id"],
                "model_label": public["model_label"],
                "capability": public["capability"],
                "routing_mode": public["routing_mode"],
                "compatibility_mode": public["compatibility_mode"],
                "base_url": public.get("base_url"),
                "endpoint_path": public.get("default_endpoint_path"),
                "headers_json": public.get("headers_json"),
                "body_template_json": public.get("payload_template_json"),
                "timeout_sec": public.get("timeout_sec") or 30,
                "api_key": resolve_model_api_key(config.api_key_encrypted),
                **{key: value for key, value in payload.items() if value not in (None, "")},
            }
    return merged


def _apply_env_defaults(payload: dict[str, Any]) -> dict[str, Any]:
    merged = dict(payload)
    provider_id = merged.get("provider_id")
    routing_mode = merged.get("routing_mode")
    compatibility_mode = merged.get("compatibility_mode")
    if routing_mode == "relay_base_url":
        if not merged.get("base_url"):
            if compatibility_mode == "gemini_compatible":
                merged["base_url"] = os.getenv("GEMINI_RELAY_BASE_URL")
            elif compatibility_mode == "openai_compatible":
                merged["base_url"] = os.getenv("OPENAI_RELAY_BASE_URL")
            elif compatibility_mode == "custom_rest":
                merged["base_url"] = os.getenv("CUSTOM_REST_BASE_URL")
        if not merged.get("api_key"):
            if compatibility_mode == "gemini_compatible":
                merged["api_key"] = os.getenv("GEMINI_RELAY_API_KEY")
            elif compatibility_mode == "openai_compatible":
                merged["api_key"] = os.getenv("OPENAI_RELAY_API_KEY")
            elif compatibility_mode == "custom_rest":
                merged["api_key"] = os.getenv("CUSTOM_REST_API_KEY")
        if compatibility_mode == "openai_compatible" and provider_id in {"custom_openai", "openai_compatible_custom"}:
            relay_model = os.getenv("OPENAI_RELAY_MODEL")
            if relay_model and (not merged.get("model_id") or merged.get("model_id") == "relay-text-smoke-test"):
                merged["model_id"] = relay_model
    elif provider_id == "openai" and not merged.get("api_key"):
        merged["api_key"] = os.getenv("OPENAI_API_KEY")
    elif provider_id == "google_gemini" and not merged.get("api_key"):
        merged["api_key"] = os.getenv("GEMINI_API_KEY")
    elif provider_id == "zhipu_glm" and not merged.get("api_key"):
        merged["api_key"] = os.getenv("ZHIPU_API_KEY")
    elif provider_id == "zai_glm" and not merged.get("api_key"):
        merged["api_key"] = os.getenv("ZAI_API_KEY")
    elif provider_id == "volcengine_ark" and not merged.get("api_key"):
        merged["api_key"] = os.getenv("ARK_API_KEY")
    elif provider_id == "volcengine_jimeng":
        merged["access_key"] = merged.get("access_key") or os.getenv("VOLCENGINE_ACCESS_KEY_ID") or os.getenv("JIMENG_ACCESS_KEY")
        merged["secret_key"] = merged.get("secret_key") or os.getenv("VOLCENGINE_SECRET_ACCESS_KEY") or os.getenv("JIMENG_SECRET_KEY")
        merged["region"] = merged.get("region") or os.getenv("VOLCENGINE_REGION")
    elif provider_id == "custom_rest":
        merged["base_url"] = merged.get("base_url") or os.getenv("CUSTOM_REST_BASE_URL")
        merged["api_key"] = merged.get("api_key") or os.getenv("CUSTOM_REST_API_KEY")
    return merged


def _enforce_url_policy(payload: dict[str, Any]) -> None:
    for key in ("base_url", "endpoint"):
        value = payload.get(key)
        if not value:
            continue
        if key == "endpoint" and "://" not in str(value):
            continue
        require_security_context_allowed(
            endpoint=str(value),
            provider_id=str(payload.get("provider_id") or ""),
            routing_mode=str(payload.get("routing_mode") or "direct_api"),
            compatibility_mode=str(payload.get("compatibility_mode") or ""),
            provider_type=str(payload.get("provider_type") or ""),
        )


def _url_policy_error(payload: dict[str, Any]) -> SecurityContext | None:
    try:
        _enforce_url_policy(payload)
    except SecurityContextError as exc:
        return exc.context
    return None


def _policy_failure_result(payload: dict[str, Any], error: SecurityContext) -> dict[str, Any]:
    return {
        "ok": False,
        "provider_id": payload.get("provider_id") or "",
        "model_id": payload.get("model_id") or payload.get("model_name") or "",
        "model_id_used": payload.get("model_id") or payload.get("model_name") or "",
        "display_name": payload.get("display_name") or payload.get("model_label") or payload.get("model_id") or "",
        "capability": payload.get("capability") or "text",
        "routing_mode": payload.get("routing_mode") or "direct_api",
        "compatibility_mode": payload.get("compatibility_mode"),
        "base_url_used": payload.get("base_url"),
        "endpoint_used": payload.get("endpoint"),
        "timeout_sec": payload.get("timeout_sec") or 30,
        "status_code": None,
        "latency_ms": None,
        "response_preview": None,
        "normalized_output": None,
        "error_type": "url_policy_blocked",
        "error": error.reason,
        "raw_error_preview": None,
        "cost_risk": _has_cost_risk(str(payload.get("capability") or "")),
        "live_tested": False,
        "request_attempted": False,
        "response_received": False,
        "release_status": "CODE_FAILURE",
        "fallback_used": False,
        "endpoint_risk_level": error.risk_level,
        "security_context": error.as_dict(),
    }


def _store_last_test_result(db: Session, config_id: int, result: dict[str, Any]) -> None:
    config = db.get(ModelConfig, config_id)
    if config is None:
        return
    extra = _extra(config)
    extra["last_test_status"] = "connected" if result.get("ok") else "failed"
    extra["last_test_at"] = datetime.now(timezone.utc).isoformat()
    extra["last_latency_ms"] = result.get("latency_ms")
    extra["last_error_summary"] = result.get("error")
    config.extra_config_json = json.dumps(extra, ensure_ascii=False)
    db.commit()


def _extra(config: ModelConfig) -> dict[str, Any]:
    if not config.extra_config_json:
        return {}
    if isinstance(config.extra_config_json, dict):
        return dict(config.extra_config_json)
    try:
        parsed = json.loads(config.extra_config_json)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _provider_id(provider_name: str, provider_type: str) -> str:
    value = f"{provider_name} {provider_type}".lower()
    if "gemini" in value:
        return "google_gemini"
    if "consumer" in value:
        return "jimeng_consumer_app"
    if "ark" in value:
        return "volcengine_ark"
    if "jimeng" in value or "volcengine" in value:
        return "volcengine_jimeng"
    if "custom rest" in value or provider_type == "custom_rest":
        return "custom_rest"
    if "compatible" in value:
        return "custom_openai"
    if "openai" in value:
        return "openai"
    return provider_name.lower().replace(" / ", "_").replace(" ", "_")


def _default_compatibility(provider_id: str, provider_type: str, routing_mode: str) -> str:
    if provider_type == "custom_rest" or provider_id == "custom_rest":
        return "custom_rest"
    if provider_id in {"custom_openai", "openai_compatible_custom"}:
        return "openai_compatible"
    if routing_mode == "relay_base_url" and provider_id == "google_gemini":
        return "gemini_compatible"
    return "native"


def _default_capability(model_name: str, capabilities: list[str]) -> str:
    joined = " ".join([model_name, *capabilities]).lower()
    if "image" in joined or "render" in joined:
        return "image"
    return "text"


def _primary_capability(capabilities: list[str]) -> str:
    return _default_capability("", capabilities)


def _required_auth_fields(provider_id: str, routing_mode: str) -> list[str]:
    if routing_mode == "relay_base_url":
        return ["base_url", "api_key_or_headers"]
    if provider_id in {"openai", "google_gemini", "zhipu_glm", "zai_glm", "custom_openai", "openai_compatible_custom"}:
        return ["api_key"]
    if provider_id == "volcengine_ark":
        return ["api_key"]
    if provider_id == "volcengine_jimeng":
        return ["access_key", "secret_key", "region", "service", "action", "version"]
    if provider_id == "jimeng_consumer_app":
        return []
    if provider_id == "custom_rest":
        return ["base_url"]
    return ["api_key"]


def _default_api_key_name(provider_id: str) -> str | None:
    return {
        "openai": "OPENAI_API_KEY",
        "custom_openai": "OPENAI_RELAY_API_KEY",
        "openai_compatible_custom": "OPENAI_RELAY_API_KEY",
        "google_gemini": "GEMINI_API_KEY",
        "zhipu_glm": "ZHIPU_API_KEY",
        "zai_glm": "ZAI_API_KEY",
        "volcengine_ark": "ARK_API_KEY",
        "volcengine_jimeng": "VOLCENGINE_ACCESS_KEY_ID",
    }.get(provider_id)


def _default_endpoint_path(provider_id: str, compatibility_mode: str, model_name: str) -> str:
    if provider_id == "volcengine_ark":
        return "/images/generations"
    if provider_id in {"volcengine_jimeng", "jimeng_consumer_app"}:
        return ""
    if compatibility_mode == "gemini_compatible" or provider_id == "google_gemini":
        return f"/models/{model_name}:generateContent"
    if provider_id in {"zhipu_glm", "zai_glm"}:
        return "/chat/completions"
    if compatibility_mode == "custom_rest" or provider_id == "custom_rest":
        return ""
    if model_name.startswith("gpt-image"):
        return "/images/generations"
    return "/responses"


def _default_request_schema(provider_id: str, compatibility_mode: str, model_name: str = "") -> str:
    if provider_id == "volcengine_ark":
        return "ark_image_generation"
    if provider_id == "volcengine_jimeng":
        return "volcengine_signed_visual"
    if provider_id == "jimeng_consumer_app":
        return "unsupported_consumer_app"
    if compatibility_mode == "gemini_compatible" or provider_id == "google_gemini":
        return "gemini_generate_content"
    if provider_id in {"zhipu_glm", "zai_glm"}:
        return "openai_chat_completions"
    if compatibility_mode == "custom_rest" or provider_id == "custom_rest":
        return "custom_json"
    if model_name.startswith("gpt-image"):
        return "openai_image_generation"
    return "openai_responses"


def _default_response_schema(provider_id: str, compatibility_mode: str, model_name: str = "") -> str:
    if provider_id == "volcengine_ark":
        return "ark_image"
    if provider_id == "volcengine_jimeng":
        return "volcengine_visual"
    if provider_id == "jimeng_consumer_app":
        return "unsupported_consumer_app"
    if compatibility_mode == "gemini_compatible" or provider_id == "google_gemini":
        return "gemini_candidates_text_or_image" if "image" in model_name else "gemini_candidates_text"
    if compatibility_mode == "custom_rest" or provider_id == "custom_rest":
        return "custom_preview"
    if model_name.startswith("gpt-image"):
        return "openai_image"
    return "openai_text"


def _has_cost_risk(capability: str) -> bool:
    return capability in {
        "image",
        "text_to_image",
        "image_to_image",
        "image_generation",
        "image_edit",
    }


def _supports_non_costly_probe(config: dict[str, Any]) -> bool:
    provider_id = config.get("provider_id")
    compatibility_mode = config.get("compatibility_mode")
    if provider_id in {"openai", "zhipu_glm", "zai_glm", "custom_openai", "openai_compatible_custom"}:
        return True
    if provider_id == "google_gemini" or compatibility_mode == "gemini_compatible":
        return True
    return False


def _skipped_result(config: dict[str, Any], error_type: str, reason: str) -> dict[str, Any]:
    endpoint_used = _preview_endpoint(config)
    return {
        "ok": False,
        "provider_id": config["provider_id"],
        "model_id": config["model_id"],
        "display_name": config.get("display_name") or config.get("model_label") or config["model_id"],
        "capability": config.get("capability"),
        "routing_mode": config["routing_mode"],
        "compatibility_mode": config["compatibility_mode"],
        "base_url_used": _preview_base_url(config),
        "endpoint_used": endpoint_used,
        "status_code": None,
        "latency_ms": None,
        "response_preview": None,
        "normalized_output": None,
        "error_type": error_type,
        "error": reason,
        "raw_error_preview": None,
        "cost_risk": _has_cost_risk(config.get("capability") or ""),
        "live_tested": False,
    }


def _preview_endpoint(config: dict[str, Any]) -> str | None:
    base_url = _preview_base_url(config)
    endpoint_path = config.get("default_endpoint_path")
    if base_url and _is_openai_endpoint_url(str(base_url)):
        return str(base_url).rstrip("/")
    if base_url and endpoint_path:
        return f"{str(base_url).rstrip('/')}/{str(endpoint_path).lstrip('/')}"
    return endpoint_path or base_url or config.get("endpoint")


def _preview_base_url(config: dict[str, Any]) -> str | None:
    provider_id = config.get("provider_id")
    if config.get("routing_mode") == "direct_api":
        if provider_id == "google_gemini":
            return "https://generativelanguage.googleapis.com/v1beta"
        if provider_id == "openai":
            return "https://api.openai.com/v1"
        if provider_id == "zhipu_glm":
            return "https://open.bigmodel.cn/api/paas/v4"
        if provider_id == "zai_glm":
            return "https://api.z.ai/api/paas/v4"
        if provider_id == "volcengine_ark":
            return "https://ark.volcengineapi.com/api/v3"
        if provider_id == "volcengine_jimeng":
            return "https://visual.volcengineapi.com"
    return config.get("base_url")


def _is_openai_endpoint_url(value: str) -> bool:
    normalized = value.rstrip("/")
    return normalized.endswith("/responses") or normalized.endswith("/chat/completions")
