from __future__ import annotations

import json
import sqlite3

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.core.seeds import seed_default_data
from backend.db.models import Base, ModelConfig, ModuleModelPreference


def test_legacy_migration_restores_configured_relay_without_crossing_extraction(monkeypatch, tmp_path):
    legacy_root = tmp_path / "com.qigou.desktop"
    legacy_data = legacy_root / "data"
    legacy_data.mkdir(parents=True)
    legacy_db = legacy_data / "interior_ai_studio.db"
    with sqlite3.connect(legacy_db) as connection:
        connection.executescript(
            """
            CREATE TABLE model_configs (
              id INTEGER PRIMARY KEY, provider_type TEXT, provider_name TEXT, routing_mode TEXT,
              endpoint TEXT, base_url TEXT, api_key_encrypted TEXT, model_name TEXT,
              capabilities_json TEXT, timeout_sec INTEGER, max_concurrency INTEGER,
              headers_json TEXT, query_params_json TEXT, payload_template_json TEXT,
              response_mapping_json TEXT, is_default INTEGER, is_enabled INTEGER,
              priority INTEGER, tags_json TEXT, extra_config_json TEXT
            );
            CREATE TABLE module_model_preferences (
              module_name TEXT, default_provider_config_id INTEGER
            );
            """
        )
        connection.execute(
            "INSERT INTO model_configs VALUES (18,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                "openai_compatible", "OpenAI-Compatible Relay", "relay_base_url",
                "https://relay.example/v1", "https://relay.example/v1", "dpapi://model-api-key/relay",
                "gpt-image-2", '["image_generation"]', 900, 1, None, None, None, None,
                0, 1, 20, '["interior_workflow"]',
                json.dumps({"provider_id": "openai", "model_id": "gpt-image-2", "compatibility_mode": "openai_compatible"}),
            ),
        )
        for module in ("floorplan", "boards", "space_render", "room_board_extraction"):
            connection.execute("INSERT INTO module_model_preferences VALUES (?,18)", (module,))
        connection.commit()

    engine = create_engine(f"sqlite:///{(tmp_path / 'current.db').as_posix()}")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    monkeypatch.setattr(
        "backend.core.legacy_model_migration.import_legacy_model_api_key",
        lambda value, path: "dpapi://model-api-key/imported" if value else None,
    )

    from backend.core.legacy_model_migration import migrate_legacy_model_routes

    with Session() as session:
        seed_default_data(session)
        result = migrate_legacy_model_routes(
            session,
            legacy_app_data_dir=legacy_root,
            marker_path=tmp_path / "migration.json",
        )
        relay = (
            session.query(ModelConfig)
            .filter(ModelConfig.routing_mode == "relay_base_url", ModelConfig.model_name == "gpt-image-2")
            .one()
        )
        assert relay.base_url == "https://relay.example/v1"
        assert relay.api_key_encrypted == "dpapi://model-api-key/imported"
        assert relay.timeout_sec == 900
        for module in ("floorplan", "boards", "space_render"):
            preference = session.query(ModuleModelPreference).filter_by(module_name=module).one()
            assert preference.default_provider_config_id == relay.id
        extraction = session.query(ModuleModelPreference).filter_by(module_name="room_board_extraction").one()
        assert extraction.default_provider_config_id != relay.id

    assert result["status"] == "complete"
    assert result["imported"] == 1


def test_legacy_migration_does_not_import_unconfigured_placeholder(monkeypatch, tmp_path):
    legacy_root = tmp_path / "com.qigou.desktop"
    legacy_data = legacy_root / "data"
    legacy_data.mkdir(parents=True)
    with sqlite3.connect(legacy_data / "interior_ai_studio.db") as connection:
        connection.executescript(
            """
            CREATE TABLE model_configs (
              id INTEGER PRIMARY KEY, provider_type TEXT, provider_name TEXT, routing_mode TEXT,
              endpoint TEXT, base_url TEXT, api_key_encrypted TEXT, model_name TEXT,
              capabilities_json TEXT, timeout_sec INTEGER, max_concurrency INTEGER,
              headers_json TEXT, query_params_json TEXT, payload_template_json TEXT,
              response_mapping_json TEXT, is_default INTEGER, is_enabled INTEGER,
              priority INTEGER, tags_json TEXT, extra_config_json TEXT
            );
            CREATE TABLE module_model_preferences (module_name TEXT, default_provider_config_id INTEGER);
            INSERT INTO model_configs VALUES (
              1, 'openai_compatible', 'Placeholder', 'relay_base_url', NULL, NULL, NULL,
              'gpt-image-2', '["image"]', 120, 1, NULL, NULL, NULL, NULL, 0, 1, 20, '[]',
              '{"provider_id":"openai","model_id":"gpt-image-2","compatibility_mode":"openai_compatible"}'
            );
            """
        )

    engine = create_engine(f"sqlite:///{(tmp_path / 'current.db').as_posix()}")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    monkeypatch.setattr("backend.core.legacy_model_migration.import_legacy_model_api_key", lambda value, path: None)

    from backend.core.legacy_model_migration import migrate_legacy_model_routes

    with Session() as session:
        seed_default_data(session)
        result = migrate_legacy_model_routes(
            session,
            legacy_app_data_dir=legacy_root,
            marker_path=tmp_path / "migration.json",
        )
        assert session.query(ModelConfig).filter(ModelConfig.routing_mode == "relay_base_url").count() == 0
    assert result["imported"] == 0


def test_official_glm_registry_route_is_native_but_keeps_chat_completions_protocol():
    from backend.core.model_registry import MODEL_REGISTRY

    glm = next(entry for entry in MODEL_REGISTRY if entry.provider_id == "zhipu_glm" and entry.model_id == "glm-4.5v")
    assert glm.default_routing_mode == "direct_api"
    assert glm.default_compatibility_mode == "native"
    assert glm.api_surface == "openai_compatible"
    assert glm.default_endpoint_path == "/chat/completions"
