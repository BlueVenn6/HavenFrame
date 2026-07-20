from __future__ import annotations

import json
import logging
import os
import sqlite3
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from backend.core.config import DATA_DIR
from backend.core.secure_store import import_legacy_model_api_key
from backend.db.models import ModelConfig, ModuleModelPreference


logger = logging.getLogger(__name__)

MIGRATION_NAME = "legacy-qigou-model-routes-v1"
IMAGE_MODEL_IDS = {
    "gpt-image-2",
    "gemini-2.5-flash-image",
    "gemini-3-pro-image-preview",
    "gemini-3.1-flash-image-preview",
}
GENERATION_MODULES = {
    "boards",
    "fast_draft",
    "floorplan",
    "image_editing",
    "space_render",
}
EXTRACTION_MODULES = {"room_board_extraction", "multi_room_board_extraction"}


def migrate_legacy_model_routes(
    session: Session,
    legacy_app_data_dir: Path | None = None,
    marker_path: Path | None = None,
) -> dict[str, int | str]:
    legacy_root = legacy_app_data_dir or _legacy_root_from_env()
    marker = marker_path or DATA_DIR / "migrations" / f"{MIGRATION_NAME}.json"
    if legacy_root is None or marker.exists():
        return {"status": "skipped", "imported": 0, "preferences": 0}

    legacy_db = legacy_root / "data" / "interior_ai_studio.db"
    legacy_secrets = legacy_root / "data" / "secrets" / "model-api-keys.json"
    if not legacy_db.is_file():
        return {"status": "not_found", "imported": 0, "preferences": 0}

    try:
        with sqlite3.connect(f"file:{legacy_db.as_posix()}?mode=ro", uri=True) as connection:
            connection.row_factory = sqlite3.Row
            routes = connection.execute("SELECT * FROM model_configs ORDER BY id").fetchall()
            preferences = connection.execute(
                "SELECT module_name, default_provider_config_id FROM module_model_preferences"
            ).fetchall()
    except sqlite3.Error as error:
        logger.warning("Legacy model-route migration could not read the legacy database: %s", error)
        return {"status": "read_failed", "imported": 0, "preferences": 0}

    imported_by_legacy_id: dict[int, tuple[ModelConfig, str]] = {}
    imported = 0
    for row in routes:
        identity = _supported_route_identity(row)
        if identity is None:
            continue
        provider_id, model_id, routing_mode, compatibility_mode, target = identity
        secret_ref = import_legacy_model_api_key(row["api_key_encrypted"], legacy_secrets)
        if not secret_ref:
            continue
        if routing_mode == "relay_base_url" and not str(row["base_url"] or "").strip():
            continue

        existing = _find_route(session, provider_id, model_id, routing_mode, compatibility_mode)
        if existing is None:
            existing = ModelConfig(**_copy_supported_route(row, secret_ref, target))
            session.add(existing)
            session.flush()
            imported += 1
        else:
            changed = False
            if not existing.api_key_encrypted:
                existing.api_key_encrypted = secret_ref
                changed = True
            if routing_mode == "relay_base_url" and not (existing.base_url or "").strip():
                existing.base_url = str(row["base_url"] or "").strip()
                existing.endpoint = str(row["endpoint"] or row["base_url"] or "").strip()
                changed = True
            required_timeout = 900 if target == "image" else int(row["timeout_sec"] or 120)
            if existing.timeout_sec < required_timeout:
                existing.timeout_sec = required_timeout
                changed = True
            if changed:
                imported += 1
            session.flush()
        imported_by_legacy_id[int(row["id"])] = (existing, target)

    preference_updates = 0
    for row in preferences:
        module_name = str(row["module_name"] or "")
        mapped = imported_by_legacy_id.get(int(row["default_provider_config_id"] or 0))
        if mapped is None:
            continue
        config, target = mapped
        if module_name in GENERATION_MODULES and target != "image":
            continue
        if module_name in EXTRACTION_MODULES and target != "extraction":
            continue
        preference = (
            session.query(ModuleModelPreference)
            .filter(ModuleModelPreference.module_name == module_name)
            .one_or_none()
        )
        if preference is not None and preference.default_provider_config_id != config.id:
            preference.default_provider_config_id = config.id
            preference_updates += 1

    session.commit()
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(
        json.dumps(
            {
                "migration": MIGRATION_NAME,
                "status": "complete",
                "imported_routes": imported,
                "updated_preferences": preference_updates,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return {"status": "complete", "imported": imported, "preferences": preference_updates}


def _legacy_root_from_env() -> Path | None:
    value = os.getenv("QIGOU_LEGACY_APP_DATA_DIR", "").strip()
    return Path(value).expanduser().resolve() if value else None


def _loads_extra(value: Any) -> dict[str, Any]:
    try:
        parsed = json.loads(value or "{}")
    except (TypeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _supported_route_identity(row: sqlite3.Row) -> tuple[str, str, str, str, str] | None:
    extra = _loads_extra(row["extra_config_json"])
    provider_id = str(extra.get("provider_id") or row["provider_name"] or "").strip().lower()
    model_id = str(extra.get("model_id") or row["model_name"] or "").strip()
    routing_mode = str(row["routing_mode"] or "direct_api").strip()
    compatibility_mode = str(extra.get("compatibility_mode") or "native").strip()

    if provider_id == "openai" and model_id == "gpt-image-2" and routing_mode in {"direct_api", "relay_base_url"}:
        expected = "openai_compatible" if routing_mode == "relay_base_url" else "native"
        return provider_id, model_id, routing_mode, expected, "image"
    if provider_id == "google_gemini" and model_id in IMAGE_MODEL_IDS and routing_mode == "direct_api":
        return provider_id, model_id, routing_mode, "native", "image"
    if provider_id == "zhipu_glm" and model_id == "glm-4.5v" and routing_mode == "direct_api":
        return provider_id, model_id, routing_mode, "native", "extraction"
    return None


def _find_route(
    session: Session,
    provider_id: str,
    model_id: str,
    routing_mode: str,
    compatibility_mode: str,
) -> ModelConfig | None:
    for config in session.query(ModelConfig).all():
        extra = _loads_extra(config.extra_config_json)
        current_provider = str(extra.get("provider_id") or config.provider_name or "").strip().lower()
        current_model = str(extra.get("model_id") or config.model_name or "").strip()
        current_compatibility = str(extra.get("compatibility_mode") or "native").strip()
        if (
            current_provider == provider_id
            and current_model == model_id
            and config.routing_mode == routing_mode
            and current_compatibility == compatibility_mode
        ):
            return config
    return None


def _copy_supported_route(row: sqlite3.Row, secret_ref: str, target: str) -> dict[str, Any]:
    extra = _loads_extra(row["extra_config_json"])
    timeout = max(int(row["timeout_sec"] or 120), 900) if target == "image" else int(row["timeout_sec"] or 120)
    return {
        "provider_type": row["provider_type"],
        "provider_name": row["provider_name"],
        "routing_mode": row["routing_mode"],
        "endpoint": row["endpoint"],
        "base_url": row["base_url"],
        "api_key_encrypted": secret_ref,
        "model_name": row["model_name"],
        "capabilities_json": row["capabilities_json"],
        "timeout_sec": timeout,
        "max_concurrency": row["max_concurrency"],
        "headers_json": row["headers_json"],
        "query_params_json": row["query_params_json"],
        "payload_template_json": row["payload_template_json"],
        "response_mapping_json": row["response_mapping_json"],
        "is_default": bool(row["is_default"]),
        "is_enabled": True,
        "priority": row["priority"],
        "tags_json": row["tags_json"],
        "extra_config_json": json.dumps(extra, ensure_ascii=False),
    }
