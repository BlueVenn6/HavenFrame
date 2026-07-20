import json

from sqlalchemy.orm import Session

from backend.core.config import PROJECTS_DIR
from backend.core.model_registry import (
    DEPRECATED_HIDDEN_MODEL_IDS,
    MODULE_MODEL_PREFERENCES,
    model_config_payload,
    release_registry,
)
from backend.db.models import (
    CustomTaskTemplate,
    ModelConfig,
    ModuleModelPreference,
    PromptTemplate,
)


def _dump(data: object) -> str:
    return json.dumps(data, ensure_ascii=False)


def _loads_dict(value: object) -> dict:
    if not value:
        return {}
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


INTERIOR_PROMPT_PRESETS = [
    {
        "name": "空间图精修真实感",
        "module": "space_render",
        "system_prompt": "你是一名严谨的室内设计可视化助手，优先保留原始空间结构。",
        "user_prompt": "基于上传的空间照片或 SU 截图生成真实感室内效果图。必须保留原始空间结构、墙体位置、门窗洞口、顶面高度、地面边界、主要家具尺度和相机视角；优化材质、灯光、软装和氛围。风格为 {style}，空间类型为 {room_type}，材质关键词为 {material_keywords}。输出应像专业室内摄影，光线自然，细节清晰，可直接用于客户沟通。",
        "negative_prompt": "改变户型结构、移动门窗、墙体变形、家具比例错误、过度豪华、画面拥挤、低清晰度、文字水印、畸变、脏乱、假植物过多",
        "variables": ["style", "room_type", "material_keywords"],
    },
    {
        "name": "毛坯 / 白模转精装",
        "module": "space_render",
        "system_prompt": "你是一名室内效果图深化助手，目标是把白模或毛坯图转成可信的精装交付图。",
        "user_prompt": "将上传的毛坯、白模或 SketchUp 截图转为完成度高的精装室内渲染图。保持原始空间体块、开窗、梁柱、墙地顶关系和透视角度不变；补充真实材质、灯带、家具、窗帘、地毯、装饰画和绿植。风格为 {style}，材质为 {material_keywords}，整体干净、克制、有交付质感。",
        "negative_prompt": "拆改结构、窗户消失、透视错误、比例失真、材质廉价、过曝、过暗、模型感、卡通感、文字和 logo",
        "variables": ["style", "material_keywords"],
    },
    {
        "name": "单房间软装方案板",
        "module": "single_room_board",
        "system_prompt": "你是一名室内软装方案板设计助手，输出要适合客户快速确认方向。",
        "user_prompt": "根据上传房间图生成一张室内软装方案板。保留房间主色调和空间关系，提炼 {style} 风格方向，展示主视觉效果、材质样板、家具建议、灯具建议、色彩搭配和预算提示。空间类型为 {room_type}，材质关键词为 {material_keywords}。版面应清晰、留白充足、适合给客户快速确认方向。",
        "negative_prompt": "版面拥挤、文字不可读、价格胡编、图片重复、材质不一致、风格漂移、低清晰度",
        "variables": ["style", "room_type", "material_keywords"],
    },
    {
        "name": "平面图 2D/3D 可视化",
        "module": "floorplan",
        "system_prompt": "你是一名室内平面可视化助手，必须保持平面结构关系准确。",
        "user_prompt": "将上传的平面图、草图或黑白图转成清晰的室内设计展示图。必须保留墙体、门窗、房间关系、动线和开间进深比例；增强空间分区、家具布置、地面材质和色彩层级。输出为 {style} 风格，空间类型为 {room_type}，适合方案汇报。",
        "negative_prompt": "改变墙体、缺失门窗、房间关系错误、标注混乱、比例失真、文字乱码、低清晰度",
        "variables": ["style", "room_type"],
    },
]


def seed_default_data(session: Session) -> None:
    if session.query(PromptTemplate).count() == 0:
        session.add_all(
            [
                PromptTemplate(
                    name="空间精修提示词",
                    module="space_render",
                    scope="global",
                    system_prompt="你是一名室内可视化助手。",
                    user_prompt="为 {room_type} 生成一张 {style} 风格的精修渲染图，材质关键词为 {material_keywords}。",
                    negative_prompt="结构扭曲, 光线差, 杂乱",
                    variables_json=_dump(
                        [
                            "room_type",
                            "style",
                            "material_keywords",
                            "provider_name",
                            "model_name",
                        ]
                    ),
                    is_builtin=True,
                    is_favorite=True,
                ),
                PromptTemplate(
                    name="方案板增强提示词",
                    module="single_room_board",
                    scope="global",
                    system_prompt="生成可用于工作室提案的方案材料。",
                    user_prompt="为 {room_type} 生成一张 {style} 风格方案板，预算级别为 {budget_level}。",
                    negative_prompt="版面拥挤, 标签不可读",
                    variables_json=_dump(["room_type", "style", "budget_level"]),
                    is_builtin=True,
                ),
            ]
        )
        session.commit()

    if session.query(ModelConfig).count() == 0:
        configs = [model_config_payload(entry) for entry in release_registry()]
        session.add_all([ModelConfig(**config) for config in configs])
        session.commit()

    if session.query(ModuleModelPreference).count() == 0:
        session.add_all(
            [
                ModuleModelPreference(
                    module_name=module_name,
                    priority_order_json=_dump(order),
                    fallback_enabled=not module_name.endswith("_extraction"),
                )
                for module_name, order in MODULE_MODEL_PREFERENCES.items()
            ]
        )
        session.commit()

    _sync_model_registry(session)

    if session.query(CustomTaskTemplate).count() == 0:
        session.add(
            CustomTaskTemplate(
                name="工作室提案起步模板",
                description="空间精修 -> 方案板预览 -> 图片报告导出交付。",
                module_chain_json=_dump(["space_render", "single_room_board", "export"]),
                input_schema_json=_dump(
                    {
                        "required": ["render_input"],
                        "optional": ["reference_image", "logo"],
                    }
                ),
                output_schema_json=_dump({"outputs": ["render_output", "board_output", "image_report"]}),
                default_provider="OpenAI",
                default_model="gpt-image-2",
                export_rules_json=_dump({"formats": ["svg", "png"]}),
                is_team_visible=True,
            )
        )
        session.commit()

    if (
        session.query(ModuleModelPreference)
        .filter(ModuleModelPreference.module_name == "floorplan")
        .first()
        is None
    ):
        session.add(
            ModuleModelPreference(
                module_name="floorplan",
                priority_order_json=_dump(
                    [
                        "gpt-image-2",
                        "gemini-2.5-flash-image",
                    ]
                ),
                fallback_enabled=True,
            )
        )
        session.commit()

    _sync_model_registry(session)

    if (
        session.query(PromptTemplate)
        .filter(PromptTemplate.name == "平面图上色基础提示词")
        .first()
        is None
    ):
        session.add(
            PromptTemplate(
                name="平面图上色基础提示词",
                module="floorplan",
                scope="global",
                system_prompt="你是一名室内平面可视化助手。",
                user_prompt="将上传的平面图转换为 {render_mode} 输出，空间类型为 {room_type}，风格为 {style}。",
                negative_prompt="墙体变形, 动线缺失, 标注不清",
                variables_json=_dump(["render_mode", "style", "room_type"]),
                is_builtin=True,
            )
        )
        session.commit()

    _ensure_interior_prompt_presets(session)


def _sync_model_registry(session: Session) -> None:
    changed = False

    for config in session.query(ModelConfig).all():
        if _is_non_release_test_config(config):
            session.delete(config)
            changed = True

    for config in (
        session.query(ModelConfig)
        .filter(ModelConfig.model_name.in_(DEPRECATED_HIDDEN_MODEL_IDS))
        .all()
    ):
        session.delete(config)
        changed = True

    for config in (
        session.query(ModelConfig)
        .filter(ModelConfig.provider_name == "Jimeng / Volcengine")
        .all()
    ):
        session.delete(config)
        changed = True

    release_entries = release_registry()
    release_keys = {(entry.provider_id, entry.model_id) for entry in release_entries}
    for config in session.query(ModelConfig).filter(ModelConfig.provider_type == "built_in_official").all():
        extra = _loads_dict(config.extra_config_json)
        identity = (
            str(extra.get("provider_id") or "").strip(),
            str(extra.get("model_id") or config.model_name or "").strip(),
        )
        if identity not in release_keys and not config.api_key_encrypted:
            session.delete(config)
            changed = True

    for entry in release_entries:
        payload = model_config_payload(entry)
        existing = _config_for_entry(session, entry)
        if existing is None:
            session.add(ModelConfig(**payload))
            changed = True
            continue
        if entry.provider_family == "custom":
            payload = _preserve_custom_provider_config(existing, payload)
        else:
            payload = _preserve_user_provider_runtime_config(existing, payload, entry)
        for key, value in payload.items():
            if hasattr(existing, key) and getattr(existing, key) != value:
                setattr(existing, key, value)
                changed = True

    if _restore_env_relay_image_config(session):
        changed = True

    for preference in session.query(ModuleModelPreference).all():
        try:
            order = json.loads(preference.priority_order_json)
        except (TypeError, json.JSONDecodeError):
            continue
        if not isinstance(order, list):
            continue
        new_order = [item for item in order if item not in DEPRECATED_HIDDEN_MODEL_IDS]
        has_user_override = _has_user_module_preference_override(session, preference)
        if preference.module_name.endswith("_extraction") and preference.module_name in MODULE_MODEL_PREFERENCES and not has_user_override:
            new_order = MODULE_MODEL_PREFERENCES[preference.module_name]
            if preference.fallback_enabled:
                preference.fallback_enabled = False
                changed = True
        elif preference.module_name in MODULE_MODEL_PREFERENCES and not has_user_override:
            new_order = MODULE_MODEL_PREFERENCES[preference.module_name]
        if new_order != order:
            preference.priority_order_json = _dump(new_order)
            changed = True
        if not has_user_override:
            default_config = (
                _config_for_extraction_model(session, new_order[0] if new_order else None)
                if preference.module_name.endswith("_extraction")
                else _config_for_model(session, new_order[0] if new_order else None)
            )
            if default_config is not None and preference.default_provider_config_id != default_config.id:
                preference.default_provider_config_id = default_config.id
                changed = True

    existing_modules = {item.module_name for item in session.query(ModuleModelPreference).all()}
    for module_name, order in MODULE_MODEL_PREFERENCES.items():
        default_config = _config_for_model(session, order[0] if order else None)
        if module_name not in existing_modules:
            session.add(
                ModuleModelPreference(
                    module_name=module_name,
                    priority_order_json=_dump(order),
                    default_provider_config_id=default_config.id if default_config is not None else None,
                    fallback_enabled=not module_name.endswith("_extraction"),
                )
            )
            changed = True

    if changed:
        session.commit()


def _ensure_interior_prompt_presets(session: Session) -> None:
    changed = False
    for preset in INTERIOR_PROMPT_PRESETS:
        existing = (
            session.query(PromptTemplate)
            .filter(PromptTemplate.name == preset["name"])
            .first()
        )
        if existing is None:
            session.add(
                PromptTemplate(
                    name=preset["name"],
                    module=preset["module"],
                    scope="global",
                    system_prompt=preset["system_prompt"],
                    user_prompt=preset["user_prompt"],
                    negative_prompt=preset["negative_prompt"],
                    variables_json=_dump(preset["variables"]),
                    is_builtin=True,
                    is_favorite=preset["module"] in {"space_render", "floorplan"},
                )
            )
            changed = True
            continue
        updates = {
            "module": preset["module"],
            "scope": "global",
            "system_prompt": preset["system_prompt"],
            "user_prompt": preset["user_prompt"],
            "negative_prompt": preset["negative_prompt"],
            "variables_json": _dump(preset["variables"]),
            "is_builtin": True,
        }
        for key, value in updates.items():
            if getattr(existing, key) != value:
                setattr(existing, key, value)
                changed = True
    if changed:
        session.commit()


def _preserve_custom_provider_config(existing: ModelConfig, payload: dict) -> dict:
    preserved = dict(payload)
    for key in (
        "routing_mode",
        "endpoint",
        "base_url",
        "api_key_encrypted",
        "headers_json",
        "query_params_json",
        "payload_template_json",
        "response_mapping_json",
        "timeout_sec",
        "max_concurrency",
        "is_enabled",
    ):
        current = getattr(existing, key, None)
        if current not in (None, "", "[]", "{}"):
            preserved[key] = current

    current_extra = _loads_dict(existing.extra_config_json)
    next_extra = _loads_dict(preserved.get("extra_config_json"))
    for key in (
        "compatibility_mode",
        "api_key_name",
        "default_endpoint_path",
        "last_test_status",
        "last_test_at",
        "last_latency_ms",
        "last_error_summary",
    ):
        if current_extra.get(key) not in (None, ""):
            next_extra[key] = current_extra[key]
    preserved["extra_config_json"] = _dump(next_extra)
    return preserved


def _preserve_user_provider_runtime_config(existing: ModelConfig, payload: dict, entry) -> dict:
    preserved = dict(payload)
    if entry.provider_id in {"zhipu_glm", "zai_glm"}:
        if existing.api_key_encrypted:
            preserved["api_key_encrypted"] = existing.api_key_encrypted
        if existing.timeout_sec:
            preserved["timeout_sec"] = existing.timeout_sec
        if existing.max_concurrency:
            preserved["max_concurrency"] = existing.max_concurrency
        current_extra = _loads_dict(existing.extra_config_json)
        next_extra = _loads_dict(preserved.get("extra_config_json"))
        for key in (
            "last_test_status",
            "last_test_at",
            "last_latency_ms",
            "last_error_summary",
        ):
            if current_extra.get(key) not in (None, ""):
                next_extra[key] = current_extra[key]
        preserved["extra_config_json"] = _dump(next_extra)
        return preserved

    if not _has_user_runtime_override(existing, payload):
        return preserved

    for key in (
        "routing_mode",
        "endpoint",
        "base_url",
        "api_key_encrypted",
        "headers_json",
        "query_params_json",
        "payload_template_json",
        "response_mapping_json",
        "timeout_sec",
        "max_concurrency",
    ):
        current = getattr(existing, key, None)
        if current not in (None, "", "[]", "{}"):
            preserved[key] = current

    current_extra = _loads_dict(existing.extra_config_json)
    next_extra = _loads_dict(preserved.get("extra_config_json"))
    for key in (
        "compatibility_mode",
        "api_key_name",
        "default_endpoint_path",
        "last_test_status",
        "last_test_at",
        "last_latency_ms",
        "last_error_summary",
    ):
        if current_extra.get(key) not in (None, ""):
            next_extra[key] = current_extra[key]
    if existing.routing_mode == "relay_base_url" and entry.relay_supported:
        next_extra["relay_supported"] = True
    preserved["extra_config_json"] = _dump(next_extra)
    return preserved


def _has_user_runtime_override(existing: ModelConfig, payload: dict) -> bool:
    if existing.routing_mode == "relay_base_url":
        return True
    if existing.base_url and existing.base_url != payload.get("base_url"):
        return True
    if existing.endpoint and existing.endpoint != payload.get("endpoint"):
        return True
    current_extra = _loads_dict(existing.extra_config_json)
    next_extra = _loads_dict(payload.get("extra_config_json"))
    return any(
        current_extra.get(key) not in (None, "", next_extra.get(key))
        for key in ("compatibility_mode", "api_key_name", "default_endpoint_path")
    )


def _restore_env_relay_image_config(session: Session) -> bool:
    """Create or repair a separate OpenAI image relay config without overwriting direct API."""
    import os

    relay_base_url = os.getenv("OPENAI_RELAY_BASE_URL")
    if not relay_base_url:
        return False

    entry = next((item for item in MODEL_REGISTRY if item.provider_id == "openai" and item.model_id == "gpt-image-2"), None)
    if entry is None:
        return False
    config = _config_for_route(session, "openai", "gpt-image-2", "relay_base_url", "openai_compatible")
    if config is not None and config.base_url:
        return False
    if config is None:
        payload = model_config_payload(entry)
        payload["routing_mode"] = "relay_base_url"
        payload["base_url"] = relay_base_url
        payload["provider_type"] = "openai_compatible"
        payload["priority"] = entry.priority + 1
        extra = _loads_dict(payload.get("extra_config_json"))
        extra["compatibility_mode"] = "openai_compatible"
        extra["api_key_name"] = "OPENAI_RELAY_API_KEY"
        extra["default_endpoint_path"] = "/images/generations"
        extra["relay_supported"] = True
        payload["extra_config_json"] = _dump(extra)
        session.add(ModelConfig(**payload))
        return True

    config.routing_mode = "relay_base_url"
    config.base_url = relay_base_url
    config.provider_type = "openai_compatible"
    extra = _loads_dict(config.extra_config_json)
    extra["compatibility_mode"] = "openai_compatible"
    extra["api_key_name"] = "OPENAI_RELAY_API_KEY"
    extra["default_endpoint_path"] = "/images/generations"
    extra["relay_supported"] = True
    config.extra_config_json = _dump(extra)
    return True


def _config_for_entry(session: Session, entry) -> ModelConfig | None:
    candidates = (
        session.query(ModelConfig)
        .filter(ModelConfig.model_name == entry.model_id)
        .order_by(ModelConfig.priority.asc(), ModelConfig.id.asc())
        .all()
    )
    provider_matches: list[ModelConfig] = []
    for config in candidates:
        extra = _loads_dict(config.extra_config_json)
        if extra.get("provider_id") == entry.provider_id:
            provider_matches.append(config)
            continue
        if not extra.get("provider_id") and config.provider_name == entry.provider_label:
            provider_matches.append(config)
    for config in provider_matches:
        if (
            config.routing_mode == entry.default_routing_mode
            and _compatibility_for_config(config, entry) == entry.default_compatibility_mode
        ):
            return config
    if entry.provider_id in {"zhipu_glm", "zai_glm"} and provider_matches:
        return provider_matches[0]
    return None


def _config_for_route(
    session: Session,
    provider_id: str,
    model_name: str,
    routing_mode: str,
    compatibility_mode: str,
) -> ModelConfig | None:
    candidates = (
        session.query(ModelConfig)
        .filter(ModelConfig.model_name == model_name, ModelConfig.routing_mode == routing_mode)
        .order_by(ModelConfig.priority.asc(), ModelConfig.id.asc())
        .all()
    )
    for config in candidates:
        extra = _loads_dict(config.extra_config_json)
        if (
            extra.get("provider_id") == provider_id
            and (extra.get("compatibility_mode") or "") == compatibility_mode
        ):
            return config
    return None


def _compatibility_for_config(config: ModelConfig, entry) -> str:
    extra = _loads_dict(config.extra_config_json)
    value = extra.get("compatibility_mode")
    if value:
        return str(value)
    if config.routing_mode == "relay_base_url":
        modes = entry.relay_compatibility_modes or ["openai_compatible"]
        return modes[0]
    return entry.default_compatibility_mode


def _config_for_model(session: Session, model_name: str | None) -> ModelConfig | None:
    if not model_name:
        return None
    configs = (
        session.query(ModelConfig)
        .filter(ModelConfig.model_name == model_name, ModelConfig.is_enabled.is_(True))
        .order_by(ModelConfig.priority.asc())
        .all()
    )
    if not configs:
        return None
    for config in configs:
        extra = _loads_dict(config.extra_config_json)
        if (
            config.routing_mode == "relay_base_url"
            and config.base_url
            and (config.api_key_encrypted or extra.get("api_key_name"))
        ):
            return config
    for config in configs:
        if config.routing_mode == "direct_api":
            return config
    return configs[0]


def _config_for_extraction_model(session: Session, model_name: str | None) -> ModelConfig | None:
    if not model_name:
        return None
    configs = (
        session.query(ModelConfig)
        .filter(ModelConfig.model_name == model_name, ModelConfig.is_enabled.is_(True))
        .order_by(ModelConfig.priority.asc(), ModelConfig.id.asc())
        .all()
    )
    compatible = [config for config in configs if _is_extraction_config(config)]
    return next((config for config in compatible if config.api_key_encrypted), None) or (compatible[0] if compatible else None)


def _is_extraction_config(config: ModelConfig) -> bool:
    extra = _loads_dict(config.extra_config_json)
    provider_id = str(extra.get("provider_id") or "").lower()
    model_id = str(extra.get("model_id") or config.model_name or "").lower()
    capability_values = extra.get("capabilities") or []
    capabilities = {str(value).lower() for value in capability_values} if isinstance(capability_values, list) else set()
    return (
        model_id.startswith("glm")
        and not model_id.startswith("gpt-image")
        and (provider_id in {"zhipu_glm", "zai_glm"} or config.routing_mode == "relay_base_url")
        and ("vision" in capabilities or str(extra.get("capability") or "").lower() in {"vision", "text"})
    )


def _has_user_module_preference_override(session: Session, preference: ModuleModelPreference) -> bool:
    if preference.default_provider_config_id is None:
        return False
    config = session.get(ModelConfig, preference.default_provider_config_id)
    if config is None:
        return False
    if preference.module_name in {"room_board_extraction", "multi_room_board_extraction"}:
        return _is_extraction_config(config) and bool(config.api_key_encrypted)
    if config.api_key_encrypted:
        return True
    if config.routing_mode == "relay_base_url" and config.base_url:
        return True
    return False


def _is_non_release_test_config(config: ModelConfig) -> bool:
    values = [
        config.endpoint or "",
        config.base_url or "",
        config.model_name or "",
        config.provider_name or "",
        config.extra_config_json or "",
    ]
    joined = " ".join(values).lower()
    return "relay.local.test" in joined or ".local.test" in joined
