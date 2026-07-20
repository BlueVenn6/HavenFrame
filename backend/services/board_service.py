import json
import os
from html import escape
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from backend.adapters.glm_item_extraction import (
    GLMItemExtractionRequest,
    extract_items_with_glm_vision,
    parse_extracted_items,
)
from backend.core.config import OUTPUTS_DIR
from backend.core.redaction import redact_text
from backend.core.serializers import model_to_dict
from backend.db.models import Asset, BoardDocument, ExtractedItem, ModelConfig, Project, Task, utc_now
from backend.services import asset_service, model_service, task_service


def extract_single_room_items(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("data_flow_confirmed") is not True:
        raise ValueError("GLM 信息提取前必须确认数据流和素材授权。")
    _require_project(db, payload.get("project_id"))
    asset = db.get(Asset, payload.get("asset_id")) if payload.get("asset_id") else None
    if asset is None:
        raise ValueError("Upload a room image before extracting items.")
    if asset.project_id != payload.get("project_id"):
        raise ValueError("所选素材不属于当前项目。")
    resolved_asset = _resolved_image_asset_path(db, asset)
    if resolved_asset is None:
        raise ValueError("The selected asset is not a readable image.")

    runtime = _resolve_extraction_runtime(db, payload)
    prompt = _build_extraction_prompt(payload)
    workflow_slot = str(payload.get("workflow_slot") or "")
    task_module = (
        "multi_room_board"
        if workflow_slot.startswith("multi_room")
        else "space_render"
        if workflow_slot.startswith("space_render")
        else "single_room_board"
    )
    active_task = _find_active_extraction_task(
        db,
        module_name=task_module,
        project_id=payload.get("project_id"),
        asset_id=payload.get("asset_id"),
        model_name=runtime.get("model_id") or payload.get("model_name"),
    )
    if active_task is not None:
        return {
            "task": model_to_dict(active_task),
            "items": list_extracted_items(
                db,
                project_id=payload.get("project_id"),
                asset_id=payload.get("asset_id"),
            ),
            "model_id": active_task.model_name,
            "deduped": True,
        }
    task = task_service.queue_task(
        db=db,
        module=task_module,
        task_type="extract_items",
        payload={
            "project_id": payload.get("project_id"),
            "provider_config_id": runtime.get("provider_config_id"),
            "inputs": {
                "asset_id": payload.get("asset_id"),
                "room_type": payload.get("room_type"),
                "style": payload.get("style"),
            },
            "prompt_snapshot": {
                "resolved_prompt": prompt,
                "negative_prompt": "missed core furniture, merged items",
            },
            "params_snapshot": {
                "must_keep": payload.get("must_keep", []),
                "real_provider": True,
                "data_flow_confirmed": True,
                "extraction_mode": "vision_json",
                "extraction_runtime": model_service.build_runtime_snapshot(
                    db,
                    runtime,
                    capability="structured_information_extraction",
                ),
            },
        },
        provider=runtime.get("provider_label") or payload.get("provider_name") or "Zhipu GLM",
        model_name=runtime.get("model_id") or payload.get("model_name") or "glm-4.5v",
    )
    task_service.mark_task_running(db, int(task["id"]))
    existing_items = _query_extracted_items(
        db,
        project_id=payload.get("project_id"),
        asset_id=payload.get("asset_id"),
    )
    previous_selection = {
        _item_identity(item): _extract_selection_metadata(item.notes)
        for item in existing_items
    }
    for item in existing_items:
        db.delete(item)
    db.flush()

    try:
        extraction_result = extract_items_with_glm_vision(
            GLMItemExtractionRequest(
                base_url=runtime.get("base_url") or "",
                api_key=runtime.get("api_key") or "",
                model_id=runtime.get("model_id") or "",
                image_path=resolved_asset,
                prompt=prompt,
                timeout_sec=int(runtime.get("timeout_sec") or 120),
                headers_json=runtime.get("headers_json"),
            )
        )
        extracted_payload = parse_extracted_items(extraction_result["raw_text"])
        items = [
            _extracted_item_from_model_payload(
                payload=item,
                request_payload=payload,
                previous_selection=previous_selection,
                task_id=int(task["id"]),
                model_id=runtime.get("model_id") or "",
            )
            for item in extracted_payload
        ]
        db.add_all(items)
        db.commit()
        serialized_items = [_serialize_extracted_item(item) for item in items]
        task_service.finalize_task(
            db,
            task["id"],
            {
                "extracted_items": serialized_items,
                "endpoint_used": extraction_result.get("endpoint_used"),
                "surface": extraction_result.get("surface"),
                "model_id": runtime.get("model_id"),
            },
        )
        return {
            "task": task_service.get_task(db, task["id"]),
            "items": serialized_items,
            "endpoint_used": extraction_result.get("endpoint_used"),
            "model_id": runtime.get("model_id"),
        }
    except Exception as exc:
        db.rollback()
        task_service.mark_task_failed(db, int(task["id"]), redact_text(str(exc)) or "提取任务失败。")
        raise


def generate_single_room_board(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    _require_project(db, payload.get("project_id"))
    extracted_items = _resolve_board_items(
        db,
        project_id=payload.get("project_id"),
        asset_ids=[payload.get("asset_id")],
        selected_item_ids=payload.get("selected_item_ids") or [],
    )
    keep_items = payload.get("keep_items") or [
        item.name for item in extracted_items if _extract_selection_metadata(item.notes).get("selection_state") == "keep"
    ]
    replace_items = payload.get("replace_items") or [
        item.name
        for item in extracted_items
        if _extract_selection_metadata(item.notes).get("selection_state") == "replace"
    ]
    task = task_service.queue_task(
        db=db,
        module="single_room_board",
        task_type="generate_board",
        payload={
            "project_id": payload.get("project_id"),
            "inputs": {
                "asset_id": payload.get("asset_id"),
                "room_type": payload.get("room_type"),
                "style": payload.get("style"),
                "keep_items": keep_items,
                "replace_items": replace_items,
            },
            "prompt_snapshot": {
                "resolved_prompt": payload.get("custom_prompt")
                or f"为{payload.get('room_type', '客厅')}生成一套{payload.get('style', '柔和极简')}风格的材料板、色彩板和报价板。",
                "negative_prompt": payload.get("negative_prompt")
                or "版面拥挤, 标注不可读, 家具语言不统一",
            },
            "params_snapshot": {
                "composer": "structured-board-v1",
                "prompt_template_id": payload.get("prompt_template_id"),
                **payload.get("params_snapshot", {}),
            },
        },
        provider="Qigou Board Composer",
        model_name="structured-board-v1",
    )
    prepared_payload = {
        **payload,
        "keep_items": keep_items,
        "replace_items": replace_items,
    }
    task_service.mark_task_running(db, int(task["id"]))
    try:
        created_docs = _create_single_room_documents(
            db,
            prepared_payload,
            task["id"],
            [_serialize_extracted_item(item) for item in extracted_items],
        )
        quote_card = _create_quote_card_payload(db, prepared_payload, task["id"])
        output_payload = {
            "board_documents": created_docs,
            "quote_card": quote_card,
        }
        task_service.finalize_task(db, task["id"], output_payload)
    except Exception as exc:
        db.rollback()
        task_service.mark_task_failed(db, int(task["id"]), str(exc) or "单房间方案板生成失败。")
        raise
    return {
        "task": task_service.get_task(db, task["id"]),
        "board_documents": created_docs,
        "quote_card": quote_card,
    }


def generate_quote_card(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    _require_project(db, payload.get("project_id"))
    _select_quote_items(db, payload)
    task = task_service.queue_task(
        db=db,
        module="single_room_board",
        task_type="generate_quote",
        payload={
            "project_id": payload.get("project_id"),
            "inputs": {
                "asset_id": payload.get("asset_id"),
                "room_type": payload.get("room_type"),
                "budget_label": payload.get("budget_label"),
            },
            "prompt_snapshot": {
                "resolved_prompt": f"为{payload.get('room_type', '房间')}软装家具生成报价卡。",
                "negative_prompt": "缺少价格, 规格不清楚",
            },
            "params_snapshot": {"selected_item_ids": payload.get("selected_item_ids", [])},
        },
    )
    task_service.mark_task_running(db, int(task["id"]))
    try:
        quote_card = _create_quote_card_payload(db, payload, task["id"])
        task_service.finalize_task(db, task["id"], {"quote_card": quote_card})
    except Exception as exc:
        db.rollback()
        task_service.mark_task_failed(db, int(task["id"]), str(exc) or "报价卡生成失败。")
        raise
    return {
        "task": task_service.get_task(db, task["id"]),
        "quote_card": quote_card,
    }


def generate_multi_room_board(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    _require_project(db, payload.get("project_id"))
    asset_ids = payload.get("asset_ids", [])
    if not asset_ids:
        raise ValueError("请先上传并标注至少一个房间图片。")
    extracted_items = _resolve_board_items(
        db,
        project_id=payload.get("project_id"),
        asset_ids=asset_ids,
        selected_item_ids=payload.get("selected_item_ids") or [],
    )
    serialized_items = [_serialize_extracted_item(item) for item in extracted_items]
    prepared_payload = {**payload, "room_tags": _room_tags_for_assets(payload)}
    budget_summary = _multi_room_budget_summary(payload, serialized_items)
    task = task_service.queue_task(
        db=db,
        module="multi_room_board",
        task_type="generate_multi_room_board",
        payload={
            "project_id": payload.get("project_id"),
            "inputs": {
                "asset_ids": asset_ids,
                "room_tags": prepared_payload["room_tags"],
                "style_consistency": payload.get("style_consistency", 0.8),
            },
            "prompt_snapshot": {
                "resolved_prompt": "生成整屋综合方案板、分房间方案板和预算汇总。",
                "negative_prompt": "风格漂移, 版面密度不均, 预算逻辑不清",
            },
            "params_snapshot": {
                "composer": "structured-board-v1",
                **payload.get("params_snapshot", {}),
            },
        },
        provider="Qigou Board Composer",
        model_name="structured-board-v1",
    )
    task_service.mark_task_running(db, int(task["id"]))
    try:
        board_documents = _create_multi_room_documents(db, prepared_payload, task["id"], serialized_items, budget_summary)
        output_payload = {
            "board_documents": board_documents,
            "budget_summary": budget_summary,
        }
        task_service.finalize_task(db, task["id"], output_payload)
    except Exception as exc:
        db.rollback()
        task_service.mark_task_failed(db, int(task["id"]), str(exc) or "多房间方案板生成失败。")
        raise
    return {
        "task": task_service.get_task(db, task["id"]),
        "board_documents": board_documents,
        "budget_summary": output_payload["budget_summary"],
    }


def list_board_documents(db: Session, project_id: int | None = None) -> list[dict[str, Any]]:
    query = db.query(BoardDocument)
    if project_id is not None:
        query = query.filter(BoardDocument.project_id == project_id)
    return [model_to_dict(item) for item in query.order_by(BoardDocument.updated_at.desc()).all()]


def list_extracted_items(
    db: Session,
    project_id: int | None = None,
    asset_id: int | None = None,
) -> list[dict[str, Any]]:
    items = _query_extracted_items(db, project_id=project_id, asset_id=asset_id)
    return [_serialize_extracted_item(item) for item in items]


def update_extracted_item(db: Session, item_id: int, payload: dict[str, Any]) -> dict[str, Any] | None:
    item = db.get(ExtractedItem, item_id)
    if item is None:
        return None

    metadata = _extract_selection_metadata(item.notes)
    summary = payload.get("notes", metadata.get("summary"))
    selection_state = payload.get("selection_state", metadata.get("selection_state", "undecided"))
    replacement_notes = payload.get("replacement_notes", metadata.get("replacement_notes"))
    task_id = payload.get("task_id", metadata.get("task_id"))
    if "price_min" in payload:
        item.price_min = payload.get("price_min")
    if "price_max" in payload:
        item.price_max = payload.get("price_max")
    if item.price_min is not None and item.price_max is not None and item.price_min > item.price_max:
        raise ValueError("最低预算不能高于最高预算")
    revision_no = int(metadata.get("selection_revision_no", 0)) + 1
    saved_at = utc_now().isoformat()

    item.notes = json.dumps(
        {
            "summary": summary,
            "selection_state": selection_state,
            "replacement_notes": replacement_notes,
            "task_id": task_id,
            "selection_updated_at": saved_at,
            "last_saved_at": saved_at,
            "selection_revision_no": revision_no,
            "review_schema_version": 2,
            "procurement_status": payload.get("procurement_status", metadata.get("procurement_status")),
            "quantity": payload.get("quantity", metadata.get("quantity")),
            "purchase_method": payload.get("purchase_method", metadata.get("purchase_method")),
            "purchase_url": payload.get("purchase_url", metadata.get("purchase_url")),
            "extraction_source": metadata.get("extraction_source", "provider_vision"),
            "extraction_signature": metadata.get("extraction_signature"),
            "inference_reason": metadata.get("inference_reason"),
        },
        ensure_ascii=False,
    )
    db.commit()
    db.refresh(item)
    return _serialize_extracted_item(item)


def _resolved_image_asset_path(db: Session, asset: Asset) -> Path | None:
    resolved = asset_service.get_asset_path(db, asset.id)
    if resolved is None:
        return None
    path, _ = resolved
    mime_type = asset.mime_type or ""
    if mime_type and not mime_type.startswith("image/"):
        return None
    return path


def _resolve_extraction_runtime(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    requested_model = str(payload.get("model_name") or "")
    requested_provider = str(payload.get("provider_name") or "")
    explicit_config_id = payload.get("provider_config_id")
    preference_module = (
        "multi_room_board_extraction"
        if str(payload.get("workflow_slot") or "").startswith("multi_room")
        else "room_board_extraction"
    )
    if explicit_config_id is not None and _extraction_compatible_config(db, explicit_config_id) is None:
        raise ValueError("所选 GLM 提取模型配置不存在、已删除或不兼容，请重新选择提取模型。")
    if explicit_config_id is None and requested_provider and requested_model:
        explicit_config = (
            db.query(ModelConfig)
            .filter(ModelConfig.provider_name == requested_provider, ModelConfig.model_name == requested_model)
            .first()
        )
        if explicit_config is None or _extraction_compatible_config(db, explicit_config.id) is None:
            raise ValueError("所选 extractionProvider/extractionModel 与已保存的 GLM 配置不一致。")

    selection = model_service.resolve_module_selection(
        db=db,
        module_name=preference_module,
        provider_name=requested_provider,
        model_name=requested_model,
        provider_config_id=explicit_config_id,
    )
    selected_config = _extraction_compatible_config(db, selection.get("provider_config_id"))
    if selected_config is None and explicit_config_id is None and not (requested_provider and requested_model):
        selection = model_service.resolve_module_selection(db=db, module_name=preference_module)
        selected_config = _extraction_compatible_config(db, selection.get("provider_config_id"))
    if selected_config is None:
        raise ValueError("没有可用的 GLM 信息提取配置，请先在模型设置中保存中国大陆智谱 GLM、国际 Z.AI GLM 或 GLM 兼容中转。")
    selected_extra = _model_config_extra(selected_config) if selected_config is not None else {}
    selected_model_id = str(selected_extra.get("model_id") or (selected_config.model_name if selected_config is not None else "") or "")
    selected_uses_relay = selected_config is not None and selected_config.routing_mode == "relay_base_url"
    routing_mode = selected_config.routing_mode if selected_config is not None else "direct_api"
    provider_id = str(selected_extra.get("provider_id") or "zhipu_glm")
    compatibility_mode = str(
        selected_extra.get("compatibility_mode")
        or ("openai_compatible" if provider_id in {"zhipu_glm", "zai_glm"} or routing_mode == "relay_base_url" else "native")
    )
    requested_model_is_vision = (
        bool(requested_model)
        and requested_model.strip().lower().startswith("glm")
        and not _is_image_generation_model_id(requested_model)
        and not _is_placeholder_extraction_model_id(requested_model)
    )
    selected_model_is_vision = bool(selected_model_id) and not _is_image_generation_model_id(selected_model_id) and not _is_placeholder_extraction_model_id(selected_model_id)
    requested_model_candidate = requested_model if requested_model_is_vision else None
    base_url = (
        (selected_config.base_url if selected_config is not None else None)
        or _official_extraction_base_url(provider_id, routing_mode)
    )
    vision_model = (
        requested_model_candidate
        or selected_extra.get("vision_model_id")
        or (selected_model_id if selected_model_is_vision else None)
        or "glm-4.5v"
    )
    runtime_payload: dict[str, Any] = {
        "provider_config_id": selected_config.id if selected_config is not None else None,
        "provider_id": provider_id,
        "provider_label": selected_config.provider_name if selected_config is not None else "Zhipu GLM",
        "model_id": vision_model,
        "model_label": vision_model,
        "capability": "vision",
        "routing_mode": routing_mode,
        "compatibility_mode": compatibility_mode,
        "base_url": base_url,
        "timeout_sec": 180,
    }
    runtime = model_service.resolve_runtime_model_payload(db, runtime_payload)
    runtime["model_id"] = vision_model
    if base_url:
        runtime["base_url"] = base_url
    runtime["api_key"] = runtime.get("api_key") or _extraction_env_api_key(provider_id, selected_uses_relay)
    if not runtime.get("base_url"):
        raise ValueError("GLM 提取模型缺少 Base URL。请在模型设置中检查所选大陆或国际 GLM 配置。")
    return runtime


def _official_extraction_base_url(provider_id: str, routing_mode: str) -> str | None:
    if routing_mode != "direct_api":
        return None
    if provider_id == "zhipu_glm":
        return "https://open.bigmodel.cn/api/paas/v4"
    if provider_id == "zai_glm":
        return "https://api.z.ai/api/paas/v4"
    return None


def _extraction_env_api_key(provider_id: str, uses_relay: bool) -> str | None:
    if uses_relay:
        return os.getenv("OPENAI_RELAY_API_KEY") or os.getenv("OPENAI_API_KEY")
    if provider_id == "zhipu_glm":
        return os.getenv("ZHIPU_API_KEY")
    if provider_id == "zai_glm":
        return os.getenv("ZAI_API_KEY")
    return None


def _extraction_compatible_config(db: Session, provider_config_id: Any) -> ModelConfig | None:
    if provider_config_id is None:
        return None
    try:
        config = db.get(ModelConfig, int(provider_config_id))
    except (TypeError, ValueError):
        return None
    if config is None:
        return None
    model_id = str(_model_config_extra(config).get("model_id") or config.model_name or "")
    provider_id = str(_model_config_extra(config).get("provider_id") or "")
    vision_override = str(_model_config_extra(config).get("vision_model_id") or "")
    effective_model_id = vision_override or model_id
    if not effective_model_id.strip().lower().startswith("glm"):
        return None
    if config.routing_mode == "direct_api" and provider_id not in {"zhipu_glm", "zai_glm"}:
        return None
    # Image-generation configs are never valid extraction configs, even when
    # an old database entry still carries a stale vision_model_id override.
    if _is_image_generation_model_id(model_id):
        return None
    if _is_placeholder_extraction_model_id(model_id) and not str(config.base_url or "").strip():
        return None
    text = " ".join(
        str(value)
        for value in [
            config.provider_type,
            config.provider_name,
            config.routing_mode,
            config.capabilities_json,
            config.tags_json,
            _model_config_extra(config),
        ]
        if value
    ).lower()
    return config if ("compatible" in text or "relay" in text or "zhipu" in text or "glm" in text) else None


def _model_config_extra(config: ModelConfig | None) -> dict[str, Any]:
    if config is None or not config.extra_config_json:
        return {}
    if isinstance(config.extra_config_json, dict):
        return dict(config.extra_config_json)
    if isinstance(config.extra_config_json, str):
        try:
            parsed = json.loads(config.extra_config_json)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _is_image_generation_model_id(model_id: str) -> bool:
    normalized = model_id.strip().lower()
    return (
        normalized.startswith("gpt-image")
        or "flash-image" in normalized
        or "image-preview" in normalized
        or "seedream" in normalized
        or "jimeng" in normalized
    )


def _is_placeholder_extraction_model_id(model_id: str) -> bool:
    return model_id.strip().lower() in {"relay-text-smoke-test", "studio-custom-image", "custom-rest-model"}


def _build_extraction_prompt(payload: dict[str, Any]) -> str:
    english = payload.get("output_language") == "en"
    room_type = payload.get("room_type") or ("Room" if english else "房间")
    style = payload.get("style") or ("Not specified" if english else "未指定")
    must_keep = (", " if english else "、").join(payload.get("must_keep") or []) or ("None" if english else "无")
    if str(payload.get("workflow_slot") or "").startswith("space_render"):
        if english:
            return (
                "You are a visual-analysis assistant for interior design reference images. Analyze only the current reference image. "
                "Extract only visible style, color, material, furniture, and lighting features that can guide another space. "
                "Do not infer off-image content or introduce other images, historical projects, brands, prices, or purchase links. "
                "Write names, materials, colors, and evidence in English. Return JSON only with this schema: "
                '{"items":[{"category":"style/color/material/furniture/lighting","name":"visible reference feature",'
                '"material":"observed material or null","color":"observed color or null",'
                '"color_hex":"approximate visible color as #RRGGBB or null",'
                '"bbox":{"x":0.1,"y":0.1,"width":0.5,"height":0.5},'
                '"selection_state":"undecided","notes":"short visual evidence","price_min":null,"price_max":null}]}. '
                "Normalize bbox coordinates to 0-1; use null for abstract features without a local region. "
                f"Reference role: {room_type}. Extraction focus: {style}. User notes: {must_keep}."
            )
        return (
            "你是室内设计参考图视觉分析助手，只分析当前这一张参考图。"
            "根据用户指定的参考角色，提取画面中确实可见且可迁移到另一空间的风格、配色、材质、家具或灯光特征。"
            "不得推断画面外内容，不得加入其他图片、历史项目、品牌、价格或购买链接。"
            "名称、材质、颜色和证据说明使用简体中文。只返回 JSON，结构必须为："
            '{"items":[{"category":"风格/配色/材质/家具/灯光之一","name":"可采用的参考特征",'
            '"material":"观察到的材质或 null","color":"观察到的颜色或 null",'
            '"color_hex":"从图片像素近似推断的主色 #RRGGBB 或 null",'
            '"bbox":{"x":0.1,"y":0.1,"width":0.5,"height":0.5} 或 null，'
            '"selection_state":"undecided","notes":"说明该特征在图中的可见证据",'
            '"price_min":null,"price_max":null}]}. '
            "bbox 坐标必须按原图宽高归一化到 0-1，风格等无法局部框选的抽象特征可返回 null。"
            f"参考角色：{room_type}。提取重点：{style}。用户指定补充：{must_keep}。"
        )
    if english:
        return (
            "You are an interior FF&E extraction assistant. Analyze only the uploaded room image. "
            "Extract furniture, lighting, rugs, curtains, major decor, and finish/material cues that are genuinely visible. "
            "Do not invent invisible items or prices. Write names, materials, colors, and evidence in English. "
            "Return JSON only with this schema: "
            '{"items":[{"category":"item category","name":"visible item name","material":"observed material or null",'
            '"color":"observed color or null","selection_state":"undecided","notes":"short visual evidence",'
            '"color_hex":"dominant color as #RRGGBB or null",'
            '"bbox":{"x":0.1,"y":0.1,"width":0.5,"height":0.5},"price_min":null,"price_max":null}]}. '
            "Normalize bbox coordinates to 0-1. "
            f"Room type: {room_type}. Target style: {style}. Required notes: {must_keep}."
        )
    return (
        "你是室内设计 FF&E 信息提取助手，只分析用户上传的房间图片。"
        "提取画面中确实可见的家具、灯具、地毯、窗帘、主要装饰和明确的饰面/材质线索；不得虚构不可见物品或价格。"
        "名称、材质、颜色和证据说明使用简体中文。只返回 JSON，结构必须为："
        '{"items":[{"category":"sofa","name":"visible item name","material":"observed material or null",'
        '"color":"observed color or null","selection_state":"undecided","notes":"short visual evidence",'
        '"color_hex":"dominant color as #RRGGBB or null",'
        '"bbox":{"x":0.1,"y":0.1,"width":0.5,"height":0.5} or null,'
        '"price_min":null,"price_max":null}]}. '
        "bbox 坐标必须按原图宽高归一化到 0-1。"
        f"房间类型：{room_type}。目标方案风格：{style}。必须保留备注：{must_keep}。"
    )


def _extracted_item_from_model_payload(
    *,
    payload: dict[str, Any],
    request_payload: dict[str, Any],
    previous_selection: dict[str, dict[str, Any]] | None,
    task_id: int,
    model_id: str,
) -> ExtractedItem:
    category = payload.get("category") or "item"
    name = payload.get("name") or "Visible item"
    existing = previous_selection.get(f"{category}:{name}", {}) if previous_selection else {}
    if existing.get("review_schema_version") != 2:
        existing = {}
    selection_state = existing.get("selection_state") or "undecided"
    notes = json.dumps(
        {
            "summary": payload.get("notes") or "Extracted by configured vision model from the uploaded room image.",
            "selection_state": selection_state,
            "replacement_notes": existing.get("replacement_notes"),
            "task_id": task_id,
            "selection_updated_at": existing.get("selection_updated_at"),
            "last_saved_at": utc_now().isoformat(),
            "selection_revision_no": existing.get("selection_revision_no", 0),
            "review_schema_version": existing.get("review_schema_version"),
            "procurement_status": existing.get("procurement_status"),
            "quantity": existing.get("quantity"),
            "purchase_method": existing.get("purchase_method"),
            "purchase_url": existing.get("purchase_url"),
            "extraction_source": "provider_vision",
            "extraction_signature": f"provider_vision::{model_id}",
            "inference_reason": f"Extracted from uploaded asset {request_payload.get('asset_id')} by model {model_id}.",
            "color_hex": payload.get("color_hex"),
        },
        ensure_ascii=False,
    )
    return ExtractedItem(
        project_id=request_payload.get("project_id"),
        asset_id=request_payload.get("asset_id"),
        room_type=request_payload.get("room_type"),
        category=str(category)[:128],
        name=str(name)[:255],
        material=payload.get("material"),
        color=payload.get("color"),
        bbox_json=json.dumps(payload.get("bbox"), ensure_ascii=False) if payload.get("bbox") else None,
        price_min=payload.get("price_min"),
        price_max=payload.get("price_max"),
        notes=notes,
    )


def _create_single_room_documents(
    db: Session,
    payload: dict[str, Any],
    task_id: int,
    extracted_items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    project_id = payload.get("project_id")
    english = _output_language(payload) == "en"
    room_type = payload.get("room_type", "Room" if english else "客厅")
    materials = list(dict.fromkeys([item.get("material") for item in extracted_items if item.get("material")]))
    colors = list(dict.fromkeys([item.get("color") for item in extracted_items if item.get("color")]))
    quote_summary = _compute_quote_summary(extracted_items, "en" if english else "zh-CN")
    provenance = _board_delivery_provenance(payload, [payload.get("asset_id")])
    hero = {
        "room_type": room_type,
        "style": payload.get("style", "Soft Minimal" if english else "柔和极简"),
        "asset_id": payload.get("asset_id"),
    }
    docs = [
        (
            "material_board",
            f"{room_type} {'Material Board' if english else '材料板'}",
            {
                **provenance,
                "hero": hero,
                "materials": materials or ["No materials identified" if english else "未识别到明确材质"],
                "selected_items": extracted_items,
            },
        ),
        (
            "color_board",
            f"{room_type} {'Color Board' if english else '色彩板'}",
            {
                **provenance,
                "hero": hero,
                "colors": colors or ["No colors identified" if english else "未识别到明确颜色"],
                "accent_notes": ["Preserve the spatial structure", "Furnishings remain adjustable"] if english else ["保留空间结构", "软装可继续调整"],
            },
        ),
        (
            "board_preview",
            f"{room_type} {'Design Board' if english else '方案板'}",
            {
                **provenance,
                "hero": hero,
                "reference_area": {
                    "asset_id": payload.get("asset_id"),
                    "heading": f"{room_type} {'Visual Reference' if english else '参考效果图'}",
                },
                "selected_items": extracted_items,
                "materials": materials or ["No materials identified" if english else "未识别到明确材质"],
                "colors": colors or ["No colors identified" if english else "未识别到明确颜色"],
                "quote_summary": quote_summary,
            },
        ),
    ]
    created: list[dict[str, Any]] = []
    for board_type, title, content in docs:
        board = BoardDocument(
            project_id=project_id,
            task_id=task_id,
            board_type=board_type,
            title=title,
            layout_json=json.dumps({"layout": "proposal_grid"}, ensure_ascii=False),
            data_json=json.dumps(content, ensure_ascii=False),
        )
        db.add(board)
        db.flush()
        board.preview_asset_id = _create_board_asset(
            db,
            project_id,
            title,
            board.id,
            task_id,
            board_type,
            content,
        )
        created.append(model_to_dict(board))
    db.commit()
    return created


def _create_multi_room_documents(
    db: Session,
    payload: dict[str, Any],
    task_id: int,
    extracted_items: list[dict[str, Any]],
    budget_summary: dict[str, Any],
) -> list[dict[str, Any]]:
    project_id = payload.get("project_id")
    english = _output_language(payload) == "en"
    room_tags = payload.get("room_tags", {}) or {
        f"room_{index + 1}": f"{'Room' if english else '房间'} {index + 1}"
        for index, _ in enumerate(payload.get("asset_ids", []))
    }
    provenance = _board_delivery_provenance(payload, payload.get("asset_ids", []))
    docs = [
        (
            "integrated_board",
            payload.get("integrated_board_title", "Whole-home Design Board" if english else "整屋综合方案板"),
            {
                **provenance,
                "hero": {"heading": "Whole-home Design Narrative" if english else "整屋住宅方案叙事", "style_consistency": payload.get("style_consistency", 0.8)},
                "rooms": list(room_tags.values()),
                "selected_items": extracted_items,
                "layout": "integrated_storyline",
                "sections": ["Hero Visual", "Room Narrative", "Material Rhythm", "Budget Summary"] if english else ["主视觉", "房间叙事", "材料节奏", "预算汇总"],
            },
        ),
        (
            "budget_summary",
            "Budget Summary Board" if english else "预算汇总板",
            {
                **provenance,
                "bands": ["Core Furniture", "Hard Finishes", "Accessories"] if english else ["核心家具", "硬装/饰面", "软装配饰"],
                **budget_summary,
            },
        ),
    ]
    docs.extend(
        [
            (
                "split_room_board",
                f"{room_name} {'Room Board' if english else '分房间方案板'}",
                {
                    **provenance,
                    "room": room_name,
                    "layout": "room_focus",
                    "sections": ["Reference", "Key Items", "Colors and Materials"] if english else ["参考图", "关键单品", "色彩材料"],
                },
            )
            for room_name in room_tags.values()
        ]
    )

    created: list[dict[str, Any]] = []
    for board_type, title, data in docs:
        board = BoardDocument(
            project_id=project_id,
            task_id=task_id,
            board_type=board_type,
            title=title,
            layout_json=json.dumps({"layout": "proposal_grid"}, ensure_ascii=False),
            data_json=json.dumps(data, ensure_ascii=False),
        )
        db.add(board)
        db.flush()
        board.preview_asset_id = _create_board_asset(
            db,
            project_id,
            title,
            board.id,
            task_id,
            board_type,
            data,
        )
        created.append(model_to_dict(board))
    db.commit()
    return created


def _create_quote_card_payload(db: Session, payload: dict[str, Any], task_id: int) -> dict[str, Any]:
    english = _output_language(payload) == "en"
    selected_items = _select_quote_items(db, payload)
    items = [_serialize_extracted_item(item) for item in selected_items]
    total_min = sum(item.get("price_min") or 0 for item in items)
    total_max = sum(item.get("price_max") or 0 for item in items)
    provenance = _board_delivery_provenance(payload, [payload.get("asset_id")])
    board = BoardDocument(
        project_id=payload.get("project_id"),
        task_id=task_id,
        board_type="quote_card",
        title=f"{payload.get('room_type', 'Room' if english else '房间')} {'Quote Card' if english else '报价卡'}",
        layout_json=json.dumps({"layout": "quote_card"}, ensure_ascii=False),
        data_json=json.dumps(
            {
                **provenance,
                "budget_label": payload.get("budget_label", "Mid" if english else "中档"),
                "items": items,
                "total_min": total_min,
                "total_max": total_max,
                "currency": "CNY" if english else "人民币",
            },
            ensure_ascii=False,
        ),
    )
    db.add(board)
    db.flush()
    board.preview_asset_id = _create_board_asset(
        db,
        payload.get("project_id"),
        board.title,
        board.id,
        task_id,
        "quote_card",
        {
            **provenance,
            "budget_label": payload.get("budget_label", "Mid" if english else "中档"),
            "items": items,
            "total_min": total_min,
            "total_max": total_max,
            "currency": "CNY" if english else "人民币",
        },
    )
    db.commit()
    db.refresh(board)
    return {
        "board_document": model_to_dict(board),
        "items": items,
        "total_min": total_min,
        "total_max": total_max,
        "currency": "CNY" if english else "人民币",
    }


def _create_board_asset(
    db: Session,
    project_id: int | None,
    title: str,
    board_id: int,
    task_id: int | None,
    board_type: str,
    content: dict[str, Any],
) -> int:
    folder = OUTPUTS_DIR / f"project-{project_id or 'shared'}"
    folder.mkdir(parents=True, exist_ok=True)
    file_name = f"{board_id}-{title.lower().replace(' ', '-')}.svg"
    file_path = folder / file_name
    file_path.write_text(
        _render_board_preview_svg(title=title, board_type=board_type, content=content),
        encoding="utf-8",
    )
    asset = Asset(
        project_id=project_id,
        type="board_output",
        file_name=file_name,
        file_path=str(file_path),
        mime_type="image/svg+xml",
        source="board_preview_renderer",
        metadata_json=json.dumps(
            {
                "board_id": board_id,
                "task_id": task_id,
                "board_type": board_type,
                "render_mode": "svg_preview",
                "storage_key": asset_service.workspace_storage_key(file_path),
            },
            ensure_ascii=False,
        ),
    )
    db.add(asset)
    db.flush()
    return asset.id


def _query_extracted_items(
    db: Session,
    *,
    project_id: int | None = None,
    asset_id: int | None = None,
) -> list[ExtractedItem]:
    query = db.query(ExtractedItem)
    if project_id is not None:
        query = query.filter(ExtractedItem.project_id == project_id)
    if asset_id is not None:
        query = query.filter(ExtractedItem.asset_id == asset_id)
    return query.order_by(ExtractedItem.created_at.desc()).all()


def _require_project(db: Session, project_id: Any) -> Project:
    try:
        project = db.get(Project, int(project_id))
    except (TypeError, ValueError):
        project = None
    if project is None:
        raise ValueError("方案板所属项目不存在。")
    return project


def _query_extracted_items_for_assets(
    db: Session,
    *,
    project_id: int | None,
    asset_ids: list[int],
) -> list[ExtractedItem]:
    query = db.query(ExtractedItem).filter(ExtractedItem.asset_id.in_(asset_ids))
    if project_id is not None:
        query = query.filter(ExtractedItem.project_id == project_id)
    return query.order_by(ExtractedItem.created_at.desc()).all()


def _resolve_board_items(
    db: Session,
    *,
    project_id: int | None,
    asset_ids: list[int | None],
    selected_item_ids: list[int],
) -> list[ExtractedItem]:
    normalized_asset_ids = [int(asset_id) for asset_id in asset_ids if asset_id is not None]
    if not normalized_asset_ids:
        raise ValueError("方案板没有绑定当前图片素材。")
    all_items = _query_extracted_items_for_assets(
        db,
        project_id=project_id,
        asset_ids=normalized_asset_ids,
    )
    if not selected_item_ids:
        return [item for item in all_items if _manual_review_state(item) == "keep"]

    items_by_id = {int(item.id): item for item in all_items}
    requested_ids = [int(item_id) for item_id in selected_item_ids]
    if any(item_id not in items_by_id for item_id in requested_ids):
        raise ValueError("部分已选元素不存在或不属于当前图片，请刷新后重试。")
    selected = [items_by_id[item_id] for item_id in requested_ids]
    if any(_manual_review_state(item) == "remove" for item in selected):
        raise ValueError("已删除的元素不能进入方案板。")
    for item in selected:
        if item.price_min is not None and item.price_max is not None and item.price_min > item.price_max:
            raise ValueError(f"{item.name} 的最低预算不能高于最高预算。")
    return selected


def _manual_review_state(item: ExtractedItem) -> str:
    metadata = _extract_selection_metadata(item.notes)
    if metadata.get("review_schema_version") != 2 or not metadata.get("selection_updated_at"):
        return "undecided"
    state = str(metadata.get("selection_state") or "undecided")
    if state in {"remove", "replace"}:
        return "remove"
    return "keep" if state == "keep" else "undecided"


def _room_tags_for_assets(payload: dict[str, Any]) -> dict[str, str]:
    asset_ids = [int(asset_id) for asset_id in payload.get("asset_ids", [])]
    incoming = payload.get("room_tags") or {}
    incoming_values = [str(value) for value in incoming.values() if str(value).strip()]
    return {
        str(asset_id): str(incoming.get(str(asset_id)) or (incoming_values[index] if index < len(incoming_values) else f"房间 {index + 1}"))
        for index, asset_id in enumerate(asset_ids)
    }


def _multi_room_budget_summary(payload: dict[str, Any], items: list[dict[str, Any]]) -> dict[str, Any]:
    params = payload.get("params_snapshot", {})
    extracted_min = sum(item.get("price_min") or 0 for item in items if item.get("selection_state") != "replace")
    extracted_max = sum(item.get("price_max") or 0 for item in items if item.get("selection_state") != "replace")
    range_min = extracted_min or max(0, float(params.get("budget_min") or 0))
    range_max = extracted_max or max(range_min, float(params.get("budget_max") or range_min))
    return {
        "range_min": range_min,
        "range_max": range_max,
        "currency": "人民币",
        "rooms": len(payload.get("asset_ids", [])),
        "source": "extracted_items" if extracted_min or extracted_max else "user_budget",
    }


def _find_active_extraction_task(
    db: Session,
    *,
    module_name: str,
    project_id: int | None,
    asset_id: int | None,
    model_name: str | None,
) -> Task | None:
    if asset_id is None:
        return None

    query = db.query(Task).filter(
        Task.module == module_name,
        Task.task_type == "extract_items",
        Task.status.in_(("queued", "running")),
    )
    if project_id is not None:
        query = query.filter(Task.project_id == project_id)
    if model_name:
        query = query.filter(Task.model_name == model_name)

    for task in query.order_by(Task.updated_at.desc()).limit(8).all():
        try:
            inputs = json.loads(task.input_payload_json or "{}")
        except json.JSONDecodeError:
            continue
        if inputs.get("asset_id") == asset_id:
            return task
    return None


def _extract_selection_metadata(notes: str | None) -> dict[str, Any]:
    if not notes:
        return {}
    try:
        parsed = json.loads(notes)
        return parsed if isinstance(parsed, dict) else {"summary": str(parsed)}
    except json.JSONDecodeError:
        return {"summary": notes}


def _serialize_extracted_item(item: ExtractedItem) -> dict[str, Any]:
    payload = model_to_dict(item)
    metadata = _extract_selection_metadata(item.notes)
    payload["notes"] = metadata.get("summary") or payload.get("notes")
    payload["selection_state"] = metadata.get("selection_state", "undecided")
    payload["replacement_notes"] = metadata.get("replacement_notes")
    payload["selection_updated_at"] = metadata.get("selection_updated_at")
    payload["selection_task_id"] = metadata.get("task_id")
    payload["selection_revision_no"] = metadata.get("selection_revision_no", 0)
    payload["review_schema_version"] = metadata.get("review_schema_version")
    payload["procurement_status"] = metadata.get("procurement_status")
    payload["quantity"] = metadata.get("quantity")
    payload["purchase_method"] = metadata.get("purchase_method")
    payload["purchase_url"] = metadata.get("purchase_url")
    payload["last_saved_at"] = metadata.get("last_saved_at")
    payload["extraction_source"] = metadata.get("extraction_source", "provider_vision")
    payload["extraction_signature"] = metadata.get("extraction_signature")
    payload["inference_reason"] = metadata.get("inference_reason")
    payload["color_hex"] = metadata.get("color_hex")
    if item.bbox_json:
        try:
            payload["bbox"] = json.loads(item.bbox_json)
        except json.JSONDecodeError:
            payload["bbox"] = None
    return payload


def _item_identity(item: ExtractedItem) -> str:
    return f"{item.category or 'item'}:{item.name}"


def _compute_quote_summary(items: list[dict[str, Any]], output_language: str = "zh-CN") -> dict[str, Any]:
    total_min = sum(item.get("price_min") or 0 for item in items if item.get("selection_state") != "replace")
    total_max = sum(item.get("price_max") or 0 for item in items if item.get("selection_state") != "replace")
    keep_count = sum(1 for item in items if item.get("selection_state") == "keep")
    replace_count = sum(1 for item in items if item.get("selection_state") == "replace")
    return {
        "total_min": total_min,
        "total_max": total_max,
        "keep_count": keep_count,
        "replace_count": replace_count,
        "currency": "CNY" if output_language == "en" else "人民币",
    }


def _board_delivery_provenance(payload: dict[str, Any], source_asset_ids: list[Any]) -> dict[str, Any]:
    params = payload.get("params_snapshot") or {}
    return {
        "source_asset_ids": [int(value) for value in source_asset_ids if value is not None],
        "selected_item_ids": [int(value) for value in payload.get("selected_item_ids", [])],
        "review_schema_version": params.get("review_schema_version"),
        "delivery_prompt_version": params.get("delivery_prompt_version"),
        "review_snapshot": params.get("review_snapshot"),
        "output_language": params.get("output_language") if params.get("output_language") in {"zh-CN", "en"} else "zh-CN",
    }


def _output_language(payload: dict[str, Any]) -> str:
    params = payload.get("params_snapshot") or {}
    return "en" if params.get("output_language") == "en" else "zh-CN"


def _select_quote_items(db: Session, payload: dict[str, Any]) -> list[ExtractedItem]:
    selected_item_ids = payload.get("selected_item_ids") or []
    if selected_item_ids:
        query = db.query(ExtractedItem).filter(ExtractedItem.id.in_(selected_item_ids))
        if payload.get("project_id") is not None:
            query = query.filter(ExtractedItem.project_id == payload.get("project_id"))
        if payload.get("asset_id") is not None:
            query = query.filter(ExtractedItem.asset_id == payload.get("asset_id"))
        selected = query.order_by(ExtractedItem.created_at.desc()).all()
        if len(selected) != len(set(selected_item_ids)):
            raise ValueError("部分报价项不存在或不属于当前项目/素材。")
        return selected

    items = _query_extracted_items(
        db,
        project_id=payload.get("project_id"),
        asset_id=payload.get("asset_id"),
    )
    return [item for item in items if _manual_review_state(item) == "keep"][:4]


def _render_board_preview_svg(title: str, board_type: str, content: dict[str, Any]) -> str:
    width = 1200
    height = 900
    language = "en" if content.get("output_language") == "en" else "zh-CN"
    panels = _preview_sections_for_board(board_type, content, language)
    section_blocks = []
    for index, panel in enumerate(panels[:4]):
        x = 60 + (index % 2) * 540
        y = 250 + (index // 2) * 250
        section_blocks.append(
            f"""
            <g>
              <rect x="{x}" y="{y}" width="500" height="190" rx="28" fill="{panel['fill']}" />
              <text x="{x + 28}" y="{y + 42}" font-size="22" font-weight="700" fill="#0F172A">{escape(panel['title'])}</text>
              {_svg_text_lines(panel["lines"], x + 28, y + 76)}
            </g>
            """
        )

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
      <defs>
        <linearGradient id="hero" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0F766E" />
          <stop offset="100%" stop-color="#E2F5F2" />
        </linearGradient>
      </defs>
      <rect width="{width}" height="{height}" rx="40" fill="#F8FAFC" />
      <rect x="40" y="40" width="{width - 80}" height="170" rx="36" fill="url(#hero)" />
      <text x="72" y="102" font-size="18" font-weight="700" fill="#D1FAE5">{'HavenFrame' if language == 'en' else '栖构工作台'}</text>
      <text x="72" y="150" font-size="44" font-weight="800" fill="#FFFFFF">{escape(title)}</text>
      <text x="72" y="186" font-size="20" font-weight="500" fill="#ECFDF5">{escape(_board_type_label(board_type, language))}</text>
      {''.join(section_blocks)}
    </svg>"""


def _preview_sections_for_board(board_type: str, content: dict[str, Any], language: str = "zh-CN") -> list[dict[str, Any]]:
    english = language == "en"
    if board_type == "quote_card":
        items = _preview_list(content.get("items"))
        totals = f"{content.get('currency', '人民币')} {int(content.get('total_min', 0)):,} - {int(content.get('total_max', 0)):,}"
        return [
            {"title": "Budget Range" if english else "预算区间", "lines": [totals, f"{'Tier' if english else '档位'}：{content.get('budget_label', 'Mid' if english else '中档')}"], "fill": "#FFFFFF"},
            {"title": "Selected Items" if english else "已选单品", "lines": [str(item.get("name", "")) for item in items[:4]], "fill": "#ECFDF5"},
        ]

    materials = [str(item) for item in _preview_list(content.get("materials"))[:4]]
    colors = [str(item) for item in _preview_list(content.get("colors"))[:4]]
    selected_items = [
        f"{item.get('name')} · {_selection_state_label(str(item.get('selection_state', 'undecided')), language)}"
        for item in _preview_list(content.get("selected_items"))[:4]
        if isinstance(item, dict)
    ]
    rooms = [str(room) for room in _preview_list(content.get("rooms"))[:4]]
    sections = [str(section) for section in _preview_list(content.get("sections"))[:4]]
    quote_summary = content.get("quote_summary", {})
    quote_line = (
        f"{quote_summary.get('currency', '人民币')} {int(quote_summary.get('total_min', 0)):,} - {int(quote_summary.get('total_max', 0)):,}"
        if quote_summary
        else ("Budget summary pending" if english else "预算汇总待生成")
    )

    base_sections = [
        {"title": "Reference" if english else "参考区域", "lines": [str(content.get("reference_area", {}).get("heading", "Archived design reference" if english else "已归档方案参考")), quote_line], "fill": "#FFFFFF"},
        {"title": "Key Items" if english else "关键单品", "lines": selected_items or ["No saved items" if english else "暂无已保存单品"], "fill": "#ECFDF5"},
        {"title": "Materials" if english else "材料", "lines": materials or ["No materials identified" if english else "未识别到明确材质"], "fill": "#FEFCE8"},
        {"title": "Color / Room" if english else "色彩 / 房间", "lines": colors or rooms or sections or ["No colors identified" if english else "未识别到明确颜色"], "fill": "#F5F3FF"},
    ]

    if board_type == "integrated_board":
        base_sections[0]["title"] = "Design Narrative" if english else "方案叙事"
        base_sections[0]["lines"] = sections or (["Hero Visual", "Room Narrative", "Budget Summary"] if english else ["主视觉", "房间叙事", "预算汇总"])
        base_sections[1]["title"] = "Rooms" if english else "房间"
        base_sections[1]["lines"] = rooms or ["No rooms assigned" if english else "暂无已绑定房间"]
    if board_type == "budget_summary":
        budget_line = (
            f"{content.get('currency', '人民币')} {int(content.get('range_min', 0)):,} - {int(content.get('range_max', 0)):,}"
        )
        base_sections[0]["title"] = "Budget Range" if english else "预算范围"
        bands = _preview_list(content.get("bands"))
        base_sections[0]["lines"] = [budget_line, f"{'Categories' if english else '分类'}: {', '.join(str(item) for item in bands[:3])}"]
    if board_type == "split_room_board":
        base_sections[0]["title"] = str(content.get("room", "Room focus"))
        base_sections[0]["lines"] = sections or (["Reference", "Key Items", "Colors and Materials"] if english else ["参考图", "关键单品", "色彩材料"])

    return base_sections


def _preview_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, (list, tuple)) else []


def _svg_text_lines(lines: list[str], x: int, y: int) -> str:
    rendered = []
    for index, line in enumerate([line for line in lines if line][:5]):
        rendered.append(
            f'<text x="{x}" y="{y + index * 28}" font-size="18" font-weight="500" fill="#475569">{escape(line[:48])}</text>'
        )
    return "".join(rendered)


def _board_type_label(board_type: str, language: str = "zh-CN") -> str:
    labels = {
        "material_board": "材料板",
        "color_board": "色彩板",
        "board_preview": "方案板",
        "integrated_board": "整屋综合方案板",
        "budget_summary": "预算汇总",
        "split_room_board": "分房间方案板",
        "quote_card": "报价卡",
    }
    english_labels = {
        "material_board": "Material Board",
        "color_board": "Color Board",
        "board_preview": "Design Board",
        "integrated_board": "Whole-home Design Board",
        "budget_summary": "Budget Summary",
        "split_room_board": "Room Board",
        "quote_card": "Quote Card",
    }
    return (english_labels if language == "en" else labels).get(board_type, board_type)


def _selection_state_label(value: str, language: str = "zh-CN") -> str:
    labels = {
        "keep": "保留",
        "remove": "删除",
        "replace": "替换",
        "undecided": "待定",
    }
    english_labels = {"keep": "Keep", "remove": "Remove", "replace": "Replace", "undecided": "Pending"}
    return (english_labels if language == "en" else labels).get(value, value)
