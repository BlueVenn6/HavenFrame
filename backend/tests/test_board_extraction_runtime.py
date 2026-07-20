import json

import pytest


def test_extraction_runtime_rejects_image_generation_config(client):
    from backend.core.database import SessionLocal
    from backend.db.models import ModelConfig
    from backend.services.board_service import _resolve_extraction_runtime

    with SessionLocal() as db:
        image_config = ModelConfig(
            provider_type="built_in_official",
            provider_name="OpenAI",
            routing_mode="direct_api",
            endpoint="https://api.openai.com",
            base_url="https://api.openai.com/v1",
            model_name="gpt-image-2",
            capabilities_json=json.dumps(["text_to_image", "image_to_image"]),
            extra_config_json=json.dumps(
                {
                    "provider_id": "openai",
                    "compatibility_mode": "native",
                    "model_id": "gpt-image-2",
                    "capability": "image",
                },
                ensure_ascii=False,
            ),
            is_enabled=True,
            priority=998,
        )
        db.add(image_config)
        db.commit()

        with pytest.raises(ValueError, match="不存在、已删除或不兼容"):
            _resolve_extraction_runtime(
                db,
                {
                    "provider_config_id": image_config.id,
                    "provider_name": "OpenAI",
                    "model_name": "gemini-2.5-flash",
                },
            )
        db.delete(image_config)
        db.commit()


def test_extraction_runtime_rejects_image_relay_with_stale_vision_override(client):
    from backend.core.database import SessionLocal
    from backend.db.models import ModelConfig
    from backend.services.board_service import _resolve_extraction_runtime

    with SessionLocal() as db:
        relay_image_config = ModelConfig(
            provider_type="built_in_official",
            provider_name="OpenAI",
            routing_mode="relay_base_url",
            endpoint="https://relay.example.test/v1",
            base_url="https://relay.example.test/v1",
            model_name="gpt-image-2",
            capabilities_json=json.dumps(["text_to_image", "image_to_image"]),
            extra_config_json=json.dumps(
                {
                    "provider_id": "openai",
                    "compatibility_mode": "openai_compatible",
                    "model_id": "gpt-image-2",
                    "capability": "image",
                    "vision_model_id": "glm-4.5v",
                },
                ensure_ascii=False,
            ),
            is_enabled=True,
            priority=995,
        )
        db.add(relay_image_config)
        db.commit()

        with pytest.raises(ValueError, match="不存在、已删除或不兼容"):
            _resolve_extraction_runtime(
                db,
                {
                    "provider_config_id": relay_image_config.id,
                    "provider_name": "OpenAI",
                    "model_name": "glm-4.5v",
                },
            )
        db.delete(relay_image_config)
        db.commit()


def test_seed_repairs_extraction_preferences_bound_to_image_relay(client):
    from backend.core.database import SessionLocal
    from backend.core.seeds import seed_default_data
    from backend.db.models import ModelConfig, ModuleModelPreference

    with SessionLocal() as db:
        glm_config = next(
            config
            for config in db.query(ModelConfig).filter(ModelConfig.model_name == "glm-4.5v").all()
            if json.loads(config.extra_config_json or "{}").get("provider_id") == "zhipu_glm"
        )
        image_relay = ModelConfig(
            provider_type="openai_compatible",
            provider_name="Regression Image Relay",
            routing_mode="relay_base_url",
            endpoint="https://relay.example.test/v1",
            base_url="https://relay.example.test/v1",
            api_key_encrypted="encrypted-image-key-placeholder",
            model_name="gpt-image-2",
            capabilities_json=json.dumps(["text_to_image", "image_to_image"]),
            extra_config_json=json.dumps(
                {
                    "provider_id": "openai",
                    "compatibility_mode": "openai_compatible",
                    "model_id": "gpt-image-2",
                    "capability": "image",
                    "capabilities": ["image_generation", "image_edit"],
                    "vision_model_id": "glm-4.5v",
                }
            ),
            timeout_sec=900,
            max_concurrency=1,
            is_enabled=True,
            is_default=False,
            priority=999,
        )
        original_key = glm_config.api_key_encrypted
        glm_config.api_key_encrypted = "encrypted-glm-key-placeholder"
        db.add(image_relay)
        db.flush()
        preferences = db.query(ModuleModelPreference).filter(
            ModuleModelPreference.module_name.in_(["room_board_extraction", "multi_room_board_extraction"])
        ).all()
        original_ids = {preference.id: preference.default_provider_config_id for preference in preferences}
        for preference in preferences:
            preference.default_provider_config_id = image_relay.id
            preference.priority_order_json = json.dumps(["glm-4.5v"])
        db.commit()

        seed_default_data(db)

        for preference in preferences:
            db.refresh(preference)
            assert preference.default_provider_config_id == glm_config.id

        for preference in preferences:
            preference.default_provider_config_id = original_ids[preference.id]
        glm_config.api_key_encrypted = original_key
        db.delete(image_relay)
        db.commit()


def test_extraction_runtime_rejects_non_glm_compatible_relay_config(client):
    from backend.core.database import SessionLocal
    from backend.db.models import ModelConfig
    from backend.services.board_service import _resolve_extraction_runtime

    with SessionLocal() as db:
        relay_config = ModelConfig(
            provider_type="openai_compatible",
            provider_name="OpenAI-Compatible Relay",
            routing_mode="relay_base_url",
            endpoint="https://relay.example.test/v1",
            base_url="https://relay.example.test/v1",
            model_name="relay-text-smoke-test",
            capabilities_json=json.dumps(["text", "vision"]),
            extra_config_json=json.dumps(
                {
                    "provider_id": "openai_compatible_custom",
                    "compatibility_mode": "openai_compatible",
                    "model_id": "relay-text-smoke-test",
                    "capability": "text",
                },
                ensure_ascii=False,
            ),
            is_enabled=True,
            priority=997,
        )
        db.add(relay_config)
        db.commit()

        with pytest.raises(ValueError, match="不存在、已删除或不兼容"):
            _resolve_extraction_runtime(
                db,
                {
                    "provider_config_id": relay_config.id,
                    "provider_name": "OpenAI-Compatible Relay",
                    "model_name": "gemini-2.5-flash",
                },
            )
        db.delete(relay_config)
        db.commit()


def test_extraction_runtime_accepts_zhipu_glm_direct_config(client, monkeypatch):
    from backend.core.database import SessionLocal
    from backend.db.models import ModelConfig
    from backend.services.board_service import _resolve_extraction_runtime

    monkeypatch.setenv("ZHIPU_API_KEY", "zhipu-test-key")
    with SessionLocal() as db:
        glm_config = ModelConfig(
            provider_type="built_in_official",
            provider_name="Zhipu GLM",
            routing_mode="direct_api",
            endpoint="https://open.bigmodel.cn/api/paas/v4",
            base_url="https://open.bigmodel.cn/api/paas/v4",
            model_name="glm-4.5v",
            capabilities_json=json.dumps(["text", "vision"]),
            extra_config_json=json.dumps(
                {
                    "provider_id": "zhipu_glm",
                    "compatibility_mode": "openai_compatible",
                    "model_id": "glm-4.5v",
                    "capability": "text",
                    "api_key_name": "ZHIPU_API_KEY",
                },
                ensure_ascii=False,
            ),
            is_enabled=True,
            priority=994,
        )
        db.add(glm_config)
        db.commit()

        runtime = _resolve_extraction_runtime(
            db,
            {
                "provider_config_id": glm_config.id,
                "provider_name": "Zhipu GLM",
                "model_name": "glm-4.5v",
            },
        )
        db.delete(glm_config)
        db.commit()

    assert runtime["provider_config_id"] == glm_config.id
    assert runtime["provider_id"] == "zhipu_glm"
    assert runtime["routing_mode"] == "direct_api"
    assert runtime["base_url"] == "https://open.bigmodel.cn/api/paas/v4"
    assert runtime["model_id"] == "glm-4.5v"
    assert runtime["api_key"] == "zhipu-test-key"


def test_extraction_runtime_rejects_placeholder_relay_without_base_url(client):
    from backend.core.database import SessionLocal
    from backend.db.models import ModelConfig
    from backend.services.board_service import _resolve_extraction_runtime

    with SessionLocal() as db:
        placeholder_config = ModelConfig(
            provider_type="openai_compatible",
            provider_name="OpenAI-Compatible Relay",
            routing_mode="relay_base_url",
            endpoint="",
            base_url="",
            model_name="relay-text-smoke-test",
            capabilities_json=json.dumps(["text"]),
            extra_config_json=json.dumps(
                {
                    "provider_id": "openai_compatible_custom",
                    "compatibility_mode": "openai_compatible",
                    "model_id": "relay-text-smoke-test",
                    "capability": "text",
                },
                ensure_ascii=False,
            ),
            is_enabled=True,
            priority=996,
        )
        db.add(placeholder_config)
        db.commit()

        with pytest.raises(ValueError, match="不存在、已删除或不兼容"):
            _resolve_extraction_runtime(
                db,
                {
                    "provider_config_id": placeholder_config.id,
                    "provider_name": "OpenAI-Compatible Relay",
                    "model_name": "relay-text-smoke-test",
                },
            )
        db.delete(placeholder_config)
        db.commit()
