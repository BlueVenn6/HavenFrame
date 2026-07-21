import json
import os
from pathlib import Path

import httpx
from fastapi.testclient import TestClient


def test_direct_api_missing_api_key_returns_clear_error():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    result = run_connectivity_smoke_test(
        {
            "provider_id": "openai",
            "provider_label": "OpenAI",
            "model_id": "gpt-5.5",
            "routing_mode": "direct_api",
            "compatibility_mode": "native",
            "test_prompt": "Return the word OK.",
            "capability": "text",
        }
    )

    assert result["ok"] is False
    assert result["error_type"] == "missing_api_key"
    assert result["endpoint_used"] == "https://api.openai.com/v1/responses"


def test_gemini_missing_api_key_returns_endpoint_preview():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    result = run_connectivity_smoke_test(
        {
            "provider_id": "google_gemini",
            "provider_label": "Google Gemini",
            "model_id": "gemini-3-pro-image-preview",
            "routing_mode": "direct_api",
            "compatibility_mode": "native",
            "test_prompt": "Return the word OK.",
            "capability": "text",
        }
    )

    assert result["ok"] is False
    assert result["error_type"] == "missing_api_key"
    assert result["endpoint_used"] == "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent"


def test_zhipu_glm_direct_api_uses_zhipu_endpoint_not_openai():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    seen_urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_urls.append(str(request.url))
        assert str(request.url) == "https://open.bigmodel.cn/api/paas/v4/chat/completions"
        assert "api.openai.com" not in str(request.url)
        payload = json.loads(request.content.decode("utf-8"))
        assert payload["model"] == "glm-4.5v"
        assert "messages" in payload
        return httpx.Response(200, json={"choices": [{"message": {"content": "OK"}}]})

    result = run_connectivity_smoke_test(
        {
            "provider_id": "zhipu_glm",
            "provider_label": "Zhipu GLM",
            "model_id": "glm-4.5v",
            "routing_mode": "direct_api",
            "compatibility_mode": "openai_compatible",
            "base_url": "https://open.bigmodel.cn/api/paas/v4",
            "endpoint_path": "/chat/completions",
            "api_key": "zhipu-test-key",
            "capability": "vision",
            "timeout_sec": 120,
            "test_prompt": "Return OK.",
        },
        transport=httpx.MockTransport(handler),
    )

    assert seen_urls == ["https://open.bigmodel.cn/api/paas/v4/chat/completions"]
    assert result["ok"] is True
    assert result["base_url_used"] == "https://open.bigmodel.cn/api/paas/v4"
    assert result["endpoint_used"] == "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    assert result["normalized_output"] == "OK"


def test_zai_glm_direct_api_uses_international_endpoint():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://api.z.ai/api/paas/v4/chat/completions"
        assert request.headers["Authorization"] == "Bearer zai-test-key"
        payload = json.loads(request.content.decode("utf-8"))
        assert payload["model"] == "glm-4.5v"
        return httpx.Response(200, json={"choices": [{"message": {"content": "OK"}}]})

    result = run_connectivity_smoke_test(
        {
            "provider_id": "zai_glm",
            "provider_label": "Z.AI International",
            "model_id": "glm-4.5v",
            "routing_mode": "direct_api",
            "compatibility_mode": "native",
            "api_key": "zai-test-key",
            "capability": "vision",
            "timeout_sec": 120,
        },
        transport=httpx.MockTransport(handler),
    )

    assert result["ok"] is True
    assert result["base_url_used"] == "https://api.z.ai/api/paas/v4"
    assert result["endpoint_used"] == "https://api.z.ai/api/paas/v4/chat/completions"


def test_relay_base_url_missing_base_url_returns_clear_error():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    result = run_connectivity_smoke_test(
        {
            "provider_id": "custom_openai",
            "model_id": "gpt-5.5",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "api_key": "test-key",
            "capability": "text",
        }
    )

    assert result["ok"] is False
    assert result["error_type"] == "missing_base_url"


def test_removed_text_relay_preset_is_not_exposed(client: TestClient):
    response = client.get("/api/models/providers")

    assert response.status_code == 200
    assert all(item["model_id"] != "relay-text-smoke-test" for item in response.json())


def test_text_relay_preset_is_not_skipped_by_cost_risk():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"output_text": "OK"})

    result = run_connectivity_smoke_test(
        {
            "provider_id": "openai_compatible_custom",
            "model_id": "relay-text-smoke-test",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "base_url": "https://relay.local.test/v1",
            "api_key": "test-key",
            "capability": "text",
        },
        transport=httpx.MockTransport(handler),
    )

    assert result["ok"] is True
    assert result["error_type"] is None
    assert result["cost_risk"] is False


def test_relay_env_defaults_use_openai_relay_base_url_and_model(monkeypatch):
    from backend.services.model_service import _apply_env_defaults

    monkeypatch.setenv("OPENAI_RELAY_BASE_URL", "https://relay.local.test/v1")
    monkeypatch.setenv("OPENAI_RELAY_API_KEY", "relay-key")
    monkeypatch.setenv("OPENAI_RELAY_MODEL", "relay-model")

    payload = _apply_env_defaults(
        {
            "provider_id": "openai_compatible_custom",
            "model_id": "relay-text-smoke-test",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "capability": "text",
        }
    )

    assert payload["base_url"] == "https://relay.local.test/v1"
    assert payload["api_key"] == "relay-key"
    assert payload["model_id"] == "relay-model"


def test_mobile_image_route_save_keeps_provider_and_api_key(client: TestClient):
    response = client.post(
        "/api/models/mobile-image-routes",
        json={
            "provider_id": "google_gemini",
            "provider_name": "Google Gemini",
            "model_name": "gemini-2.5-flash-image",
            "display_name": "Gemini 2.5 Flash Image (Nano Banana)",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "gemini_compatible",
            "base_url": "https://relay.example.com/gemini/v1beta",
            "api_key": "relay-key",
            "api_key_name": "GEMINI_RELAY_API_KEY",
            "priority": 31,
        },
    )

    assert response.status_code == 200
    config = response.json()
    assert config["provider_id"] == "google_gemini"
    assert config["model_id"] == "gemini-2.5-flash-image"
    assert config["routing_mode"] == "relay_base_url"
    assert config["compatibility_mode"] == "gemini_compatible"
    assert config["base_url"] == "https://relay.example.com/gemini/v1beta"
    assert config["has_api_key"] is True
    assert config["api_key_name"] == "GEMINI_RELAY_API_KEY"

    routes = client.get("/api/models/mobile-image-routes").json()
    assert any(
        item["id"] == config["id"]
        and item["provider_id"] == "google_gemini"
        and item["routing_mode"] == "relay_base_url"
        for item in routes
    )

    from backend.core.database import SessionLocal
    from backend.db.models import ModelConfig
    from backend.services import model_service

    with SessionLocal() as db:
        stored = db.get(ModelConfig, config["id"])
        assert stored is not None
        assert stored.api_key_encrypted is not None
        assert stored.api_key_encrypted != "relay-key"
        assert stored.api_key_encrypted.startswith("dpapi://model-api-key/")
        runtime = model_service.resolve_runtime_model_payload(db, {"provider_config_id": config["id"]})
        assert runtime["api_key"] == "relay-key"


def test_clear_provider_api_key_removes_runtime_secret(client: TestClient):
    created = client.post(
        "/api/models/configs",
        json={
            "provider_id": "secure_clear_test",
            "provider_type": "custom",
            "provider_name": "Secure Clear Test",
            "model_name": "secure-clear-test-model",
            "display_name": "Secure Clear Test Model",
            "routing_mode": "direct_api",
            "compatibility_mode": "custom_rest",
            "base_url": "https://secure-clear.example.test/v1",
            "api_key": "secure-clear-secret-key",
            "api_key_name": "SECURE_CLEAR_TEST_API_KEY",
        },
    )
    assert created.status_code == 200
    config_id = created.json()["id"]

    cleared = client.delete(f"/api/models/providers/{config_id}/api-key")

    assert cleared.status_code == 200
    assert cleared.json()["has_api_key"] is False

    from backend.core.database import SessionLocal
    from backend.db.models import ModelConfig
    from backend.services import model_service

    with SessionLocal() as db:
        stored = db.get(ModelConfig, config_id)
        assert stored is not None
        assert stored.api_key_encrypted is None
        runtime = model_service.resolve_runtime_model_payload(db, {"provider_config_id": config_id})
        assert not runtime.get("api_key")


def test_plaintext_provider_api_key_is_migrated_to_secure_reference(test_database_url: str):
    from backend.core.database import SessionLocal
    from backend.db.models import ModelConfig
    from backend.services import model_service

    with SessionLocal() as db:
        legacy = ModelConfig(
            provider_type="custom",
            provider_name="Legacy Migration Test",
            routing_mode="direct_api",
            base_url="https://legacy.example.test/v1",
            api_key_encrypted="legacy-plain-key",
            model_name="legacy-secure-migration-model",
            capabilities_json='["text"]',
            is_enabled=True,
        )
        db.add(legacy)
        db.commit()
        config_id = legacy.id

        model_service.migrate_plain_api_keys(db)

        migrated = db.get(ModelConfig, config_id)
        assert migrated is not None
        assert migrated.api_key_encrypted is not None
        assert migrated.api_key_encrypted != "legacy-plain-key"
        assert migrated.api_key_encrypted.startswith("dpapi://model-api-key/")
        runtime = model_service.resolve_runtime_model_payload(db, {"provider_config_id": config_id})
        assert runtime["api_key"] == "legacy-plain-key"


def test_mobile_image_route_accepts_supported_gemini_image_preview(client: TestClient):
    response = client.post(
        "/api/models/mobile-image-routes",
        json={
            "provider_id": "google_gemini",
            "provider_name": "Google Gemini",
            "model_name": "gemini-3-pro-image-preview",
            "display_name": "Gemini 3 Pro Image Preview",
            "routing_mode": "direct_api",
            "compatibility_mode": "native",
            "base_url": "https://generativelanguage.googleapis.com/v1beta",
            "api_key": "gemini-key",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["provider_id"] == "google_gemini"
    assert payload["model_id"] == "gemini-3-pro-image-preview"
    assert payload["routing_mode"] == "direct_api"
    assert payload["preview"] is True


def test_openai_compatible_adapter_normalizes_mocked_http_response():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://relay.local.test/v1/responses"
        assert request.headers["authorization"] == "Bearer test-key"
        return httpx.Response(200, json={"output_text": "OK"})

    result = run_connectivity_smoke_test(
        {
            "provider_id": "custom_openai",
            "model_id": "gpt-5.5",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "base_url": "https://relay.local.test/v1",
            "api_key": "test-key",
            "capability": "text",
        },
        transport=httpx.MockTransport(handler),
    )

    assert result["ok"] is True
    assert result["status_code"] == 200
    assert result["normalized_output"] == "OK"


def test_openai_relay_responses_success_uses_relay_url_and_parses_output():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://relay.local.test/v1/responses"
        assert "api.openai.com" not in str(request.url)
        return httpx.Response(200, json={"output_text": "OK"})

    result = run_connectivity_smoke_test(
        {
            "provider_id": "openai_compatible_custom",
            "model_id": "relay-model",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "base_url": "https://relay.local.test/v1",
            "api_key": "test-key",
            "capability": "text",
        },
        transport=httpx.MockTransport(handler),
    )

    assert result["ok"] is True
    assert result["base_url_used"] == "https://relay.local.test/v1"
    assert result["endpoint_used"] == "https://relay.local.test/v1/responses"
    assert result["model_id_used"] == "relay-model"
    assert result["fallback_used"] is False
    assert result["normalized_output"] == "OK"


def test_openai_relay_responses_404_falls_back_to_chat_completions():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    seen_urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_urls.append(str(request.url))
        if str(request.url) == "https://relay.local.test/v1/responses":
            return httpx.Response(404, json={"error": {"message": "unsupported endpoint"}})
        assert str(request.url) == "https://relay.local.test/v1/chat/completions"
        payload = json.loads(request.content.decode("utf-8"))
        assert payload["temperature"] == 0
        assert payload["max_tokens"] == 8
        return httpx.Response(200, json={"choices": [{"message": {"content": "OK"}}]})

    result = run_connectivity_smoke_test(
        {
            "provider_id": "openai_compatible_custom",
            "model_id": "relay-model",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "base_url": "https://relay.local.test/v1",
            "api_key": "test-key",
            "capability": "text",
        },
        transport=httpx.MockTransport(handler),
    )

    assert seen_urls == [
        "https://relay.local.test/v1/responses",
        "https://relay.local.test/v1/chat/completions",
    ]
    assert result["ok"] is True
    assert result["endpoint_used"] == "https://relay.local.test/v1/chat/completions"
    assert result["fallback_used"] is True
    assert result["normalized_output"] == "OK"


def test_openai_relay_chat_completions_endpoint_uses_chat_payload():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://relay.local.test/v1/chat/completions"
        payload = json.loads(request.content.decode("utf-8"))
        assert "messages" in payload
        assert "input" not in payload
        return httpx.Response(200, json={"choices": [{"message": {"content": "OK"}}]})

    result = run_connectivity_smoke_test(
        {
            "provider_id": "openai_compatible_custom",
            "model_id": "relay-model",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "base_url": "https://relay.local.test/v1",
            "endpoint_path": "/chat/completions",
            "api_key": "test-key",
            "capability": "text",
        },
        transport=httpx.MockTransport(handler),
    )

    assert result["ok"] is True
    assert result["endpoint_used"] == "https://relay.local.test/v1/chat/completions"
    assert result["fallback_used"] is False
    assert result["normalized_output"] == "OK"


def test_openai_relay_full_endpoint_in_base_url_is_not_double_joined():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://relay.local.test/v1/chat/completions"
        return httpx.Response(200, json={"choices": [{"message": {"content": "OK"}}]})

    result = run_connectivity_smoke_test(
        {
            "provider_id": "openai_compatible_custom",
            "model_id": "relay-model",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "base_url": "https://relay.local.test/v1/chat/completions",
            "api_key": "test-key",
            "capability": "text",
        },
        transport=httpx.MockTransport(handler),
    )

    assert result["ok"] is True
    assert result["endpoint_used"] == "https://relay.local.test/v1/chat/completions"
    assert result["normalized_output"] == "OK"


def test_openai_relay_missing_api_key_returns_missing_api_key():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    result = run_connectivity_smoke_test(
        {
            "provider_id": "openai_compatible_custom",
            "model_id": "relay-model",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "base_url": "https://relay.local.test/v1",
            "capability": "text",
        }
    )

    assert result["ok"] is False
    assert result["error_type"] == "missing_api_key"


def test_gemini_adapter_normalizes_mocked_http_response():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "generativelanguage.googleapis.com"
        assert request.headers["x-goog-api-key"] == "gemini-secret"
        return httpx.Response(
            200,
            json={"candidates": [{"content": {"parts": [{"text": "OK"}]}}]},
        )

    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    result = run_connectivity_smoke_test(
        {
            "provider_id": "google_gemini",
            "model_id": "gemini-1.5-flash",
            "routing_mode": "direct_api",
            "compatibility_mode": "native",
            "api_key": "gemini-secret",
            "capability": "text",
        },
        transport=httpx.MockTransport(handler),
    )

    assert result["ok"] is True
    assert result["normalized_output"] == "OK"
    assert "gemini-secret" not in (result["endpoint_used"] or "")


def test_model_test_api_does_not_expose_internal_provider_error_preview(client: TestClient, monkeypatch):
    from backend.services import model_service

    monkeypatch.setattr(
        model_service,
        "test_model_connection",
        lambda _db, _payload: {
            "ok": False,
            "error_type": "provider_error",
            "error": "Provider request failed.",
            "raw_error_preview": "Traceback: internal-secret",
        },
    )

    response = client.post(
        "/api/models/test",
        json={"provider_id": "openai", "model_id": "gpt-test"},
    )

    assert response.status_code == 200
    assert response.json()["error"] == "Provider request failed."
    assert "raw_error_preview" not in response.json()
    assert "internal-secret" not in response.text


def test_gemini_parse_error_is_structured():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{}]}}]})

    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    result = run_connectivity_smoke_test(
        {
            "provider_id": "google_gemini",
            "model_id": "gemini-1.5-flash",
            "routing_mode": "direct_api",
            "compatibility_mode": "native",
            "api_key": "gemini-secret",
            "capability": "text",
        },
        transport=httpx.MockTransport(handler),
    )

    assert result["ok"] is False
    assert result["error_type"] == "response_parse_error"


def test_custom_rest_invalid_headers_json_is_structured():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    result = run_connectivity_smoke_test(
        {
            "provider_id": "custom_rest",
            "model_id": "custom-rest-model",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "custom_rest",
            "base_url": "https://custom.local.test",
            "headers_json": "{not-json",
            "capability": "text",
        }
    )

    assert result["ok"] is False
    assert result["error_type"] == "invalid_headers_json"


def test_provider_error_is_normalized_without_exposing_secret():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": {"message": "bad key sk-secret"}})

    result = run_connectivity_smoke_test(
        {
            "provider_id": "openai",
            "model_id": "gpt-5.5",
            "routing_mode": "direct_api",
            "compatibility_mode": "native",
            "base_url": "https://api.openai.com/v1",
            "api_key": "sk-secret",
            "capability": "text",
        },
        transport=httpx.MockTransport(handler),
    )

    assert result["ok"] is False
    assert result["status_code"] == 401
    assert result["error_type"] == "auth_error"
    assert "sk-secret" not in (result["endpoint_used"] or "")
    assert "sk-secret" not in (result["raw_error_preview"] or "")


def test_placeholder_api_key_is_structured_without_exposing_secret():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    result = run_connectivity_smoke_test(
        {
            "provider_id": "openai",
            "model_id": "gpt-5.5",
            "routing_mode": "direct_api",
            "compatibility_mode": "native",
            "api_key": "sk-示例",
            "capability": "text",
        }
    )

    assert result["ok"] is False
    assert result["error_type"] == "invalid_secret_placeholder"
    assert "sk-示例" not in (result["error"] or "")
    assert "sk-示例" not in (result["raw_error_preview"] or "")


def test_non_ascii_api_key_is_structured_without_exposing_secret():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    result = run_connectivity_smoke_test(
        {
            "provider_id": "openai",
            "model_id": "gpt-5.5",
            "routing_mode": "direct_api",
            "compatibility_mode": "native",
            "api_key": "sk-密钥",
            "capability": "text",
        }
    )

    assert result["ok"] is False
    assert result["error_type"] == "invalid_secret_format"
    assert "sk-密钥" not in (result["error"] or "")
    assert "sk-密钥" not in (result["raw_error_preview"] or "")


def test_non_ascii_header_value_is_structured_without_httpx_crash():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    result = run_connectivity_smoke_test(
        {
            "provider_id": "custom_rest",
            "model_id": "custom-rest-model",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "custom_rest",
            "base_url": "https://custom.local.test",
            "headers_json": {"X-Test": "值"},
            "capability": "text",
        }
    )

    assert result["ok"] is False
    assert result["error_type"] == "invalid_header_value"


def test_placeholder_relay_base_url_is_structured_invalid_base_url():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    result = run_connectivity_smoke_test(
        {
            "provider_id": "custom_openai",
            "model_id": "gpt-5.5",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "base_url": "https://你的-relay.example.com/v1",
            "api_key": "test-key",
            "capability": "text",
        }
    )

    assert result["ok"] is False
    assert result["error_type"] in {"invalid_base_url", "url_policy_blocked"}


def test_httpx_unicode_encode_error_is_structured():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    def handler(_: httpx.Request) -> httpx.Response:
        raise UnicodeEncodeError("ascii", "值", 0, 1, "test")

    result = run_connectivity_smoke_test(
        {
            "provider_id": "openai",
            "model_id": "gpt-5.5",
            "routing_mode": "direct_api",
            "compatibility_mode": "native",
            "api_key": "test-key",
            "capability": "text",
        },
        transport=httpx.MockTransport(handler),
    )

    assert result["ok"] is False
    assert result["error_type"] == "invalid_header_value"


def test_test_all_skips_costly_models_and_returns_missing_credentials(client: TestClient):
    from backend.core.database import SessionLocal
    from backend.db.models import ModelConfig

    # This assertion requires an unconfigured registry. Earlier tests in this
    # session save temporary keys, so reset only the isolated test database.
    with SessionLocal() as db:
        db.query(ModelConfig).update({ModelConfig.api_key_encrypted: None}, synchronize_session=False)
        cost_only_config = ModelConfig(
            provider_type="custom_rest",
            provider_name="Test Cost-Only Provider",
            routing_mode="direct_api",
            base_url="https://cost-only.invalid/v1",
            model_name="test-cost-only-image",
            capabilities_json=json.dumps(["image"]),
            is_enabled=True,
            priority=999,
            extra_config_json=json.dumps(
                {
                    "provider_id": "test_cost_only",
                    "model_id": "test-cost-only-image",
                    "capability": "image",
                    "compatibility_mode": "custom_rest",
                    "default_endpoint_path": "/images/generations",
                }
            ),
        )
        db.add(cost_only_config)
        db.commit()
        cost_only_config_id = cost_only_config.id

    response = client.post(
        "/api/models/test-all",
        json={"include_costly": False, "routing_modes": ["direct_api", "relay_base_url"]},
    )

    assert response.status_code == 200
    results = response.json()
    assert results
    error_types = {item["error_type"] for item in results if item["error_type"]}
    assert "skipped_cost_risk" in error_types
    assert "missing_api_key" in error_types or "unsupported_auth" in error_types or "missing_base_url" in error_types

    with SessionLocal() as db:
        stored = db.get(ModelConfig, cost_only_config_id)
        if stored is not None:
            db.delete(stored)
            db.commit()


def test_test_all_runs_safe_probe_for_openai_image_model(monkeypatch):
    from backend.core.database import SessionLocal
    from backend.services import model_service

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    seen_urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_urls.append(str(request.url))
        assert str(request.url) != "https://api.openai.com/v1/images/generations"
        return httpx.Response(200, json={"id": "gpt-image-2", "object": "model"})

    with SessionLocal() as db:
        results = model_service.test_all_configured_models(
            db,
            {"include_costly": False, "routing_modes": ["direct_api"], "capabilities": ["image"]},
            transport=httpx.MockTransport(handler),
        )

    gpt_image_2 = next(item for item in results if item["model_id"] == "gpt-image-2")
    assert "https://api.openai.com/v1/models/gpt-image-2" in seen_urls
    assert gpt_image_2["ok"] is True
    assert gpt_image_2["endpoint_used"] == "https://api.openai.com/v1/models/gpt-image-2"


def test_unimplemented_jimeng_provider_is_not_exposed_in_bulk_routes(client: TestClient):
    response = client.post(
        "/api/models/test-all",
        json={"include_costly": False, "routing_modes": ["direct_api"]},
    )

    assert response.status_code == 200
    jimeng_results = [item for item in response.json() if item["provider_id"] == "volcengine_jimeng"]
    assert jimeng_results == []


def test_registry_provider_auth_and_visibility(client: TestClient):
    response = client.get("/api/models/providers")

    assert response.status_code == 200
    providers = response.json()
    by_model = {item["model_id"]: item for item in providers}
    assert "gpt-image-1" not in by_model
    assert "gpt-image-1-mini" not in by_model
    assert "gemini-2.5-flash-image-preview" not in by_model
    assert "gpt-5.2" not in by_model
    assert not {"gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"}.intersection(by_model)
    assert by_model["gpt-image-2"]["display_name"] == "GPT Image 2"
    assert by_model["gpt-image-2"]["needs_official_id_verification"] is False
    assert by_model["gpt-image-2"]["direct_api_supported"] is True
    assert by_model["gpt-image-2"]["relay_supported"] is True
    assert by_model["gpt-image-2"]["provider_id"] == "openai"
    assert by_model["gpt-image-2"]["routing_mode"] == "direct_api"
    assert by_model["gpt-image-2"]["compatibility_mode"] == "native"
    assert by_model["gpt-image-2"]["base_url"] == "https://api.openai.com/v1"
    assert "gemini-3-pro-preview" not in by_model
    assert by_model["gemini-3.1-flash-image-preview"]["display_name"] == "Gemini 3.1 Flash Image Preview (Nano Banana 2)"
    assert by_model["gemini-3-pro-image-preview"]["preview"] is True
    assert by_model["gemini-3-pro-image-preview"]["api_key_name"] == "GEMINI_API_KEY"
    assert "gpt-image-1.5" not in by_model
    assert "doubao-seedream-5-0-260128" not in by_model
    assert "relay-text-smoke-test" not in by_model
    assert "studio-custom-image" not in by_model
    assert "custom-rest-model" not in by_model


def test_mobile_route_save_never_echoes_plain_api_key(client: TestClient):
    secret = "sk-mobile-secret-value"
    response = client.post(
        "/api/models/mobile-image-routes",
        json={
            "provider_id": "openai",
            "provider_name": "OpenAI",
            "model_name": "gpt-image-2",
            "display_name": "GPT Image 2 Mobile",
            "routing_mode": "direct_api",
            "compatibility_mode": "native",
            "base_url": "https://api.openai.com/v1",
            "api_key": secret,
            "api_key_name": "OPENAI_API_KEY",
            "capabilities_json": ["image"],
            "extra_config_json": {"capability": "image", "mobile_route": True},
            "priority": 20,
            "is_enabled": True,
        },
    )

    assert response.status_code == 200
    saved = response.json()
    assert saved["has_api_key"] is True
    assert secret not in str(saved)
    assert "api_key_encrypted" not in saved

    providers = client.get("/api/models/providers").json()
    matching = [
        item for item in providers
        if item["provider_id"] == "openai" and item["model_id"] == "gpt-image-2"
    ]
    assert matching
    assert all(secret not in str(item) for item in matching)
    assert all("api_key_encrypted" not in item for item in matching)


def test_gpt_image_2_connection_uses_safe_model_lookup():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://api.openai.com/v1/models/gpt-image-2"
        return httpx.Response(200, json={"id": "gpt-image-2", "object": "model"})

    result = run_connectivity_smoke_test(
        {
            "provider_id": "openai",
            "model_id": "gpt-image-2",
            "routing_mode": "direct_api",
            "compatibility_mode": "native",
            "api_key": "test-key",
            "capability": "image",
        },
        transport=httpx.MockTransport(handler),
    )

    assert result["ok"] is True
    assert result["endpoint_used"] == "https://api.openai.com/v1/models/gpt-image-2"
    assert result["normalized_output"] == "gpt-image-2 is reachable without running image generation."
    assert result["request_attempted"] is True
    assert result["response_received"] is True
    assert result["release_status"] == "PASS"


def test_gpt_image_2_default_connection_does_not_call_generation_endpoint():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    seen_urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_urls.append(str(request.url))
        assert str(request.url) != "https://api.openai.com/v1/images/generations"
        return httpx.Response(200, json={"id": "gpt-image-2", "object": "model"})

    result = run_connectivity_smoke_test(
        {
            "provider_id": "openai",
            "model_id": "gpt-image-2",
            "routing_mode": "direct_api",
            "compatibility_mode": "native",
            "api_key": "test-key",
            "capability": "image",
            "include_costly": False,
        },
        transport=httpx.MockTransport(handler),
    )

    assert seen_urls == ["https://api.openai.com/v1/models/gpt-image-2"]
    assert result["ok"] is True
    assert result["release_status"] == "PASS"


def test_provider_error_records_attempted_request_and_response():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"error": {"message": "No available channel"}})

    result = run_connectivity_smoke_test(
        {
            "provider_id": "openai_compatible_custom",
            "model_id": "gpt-4o-mini",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "base_url": "https://relay.test/v1",
            "api_key": "test-key",
            "capability": "text",
        },
        transport=httpx.MockTransport(handler),
    )

    assert result["ok"] is False
    assert result["error_type"] == "provider_error"
    assert result["request_attempted"] is True
    assert result["response_received"] is True
    assert result["live_tested"] is True
    assert result["release_status"] == "BLOCKED_PROVIDER"


def test_openai_relay_gpt_image_2_uses_safe_model_lookup():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://relay.local.test/v1/models/gpt-image-2"
        return httpx.Response(200, json={"id": "gpt-image-2", "object": "model"})

    result = run_connectivity_smoke_test(
        {
            "provider_id": "openai",
            "model_id": "gpt-image-2",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "base_url": "https://relay.local.test/v1",
            "api_key": "test-key",
            "capability": "image",
        },
        transport=httpx.MockTransport(handler),
    )

    assert result["ok"] is True
    assert result["base_url_used"] == "https://relay.local.test/v1"
    assert result["endpoint_used"] == "https://relay.local.test/v1/models/gpt-image-2"
    assert result["normalized_output"] == "gpt-image-2 is reachable without running image generation."
    assert result["cost_risk"] is True


def test_openai_relay_gpt_image_2_auth_error_is_not_marked_skipped_cost():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://relay.local.test/v1/models/gpt-image-2"
        return httpx.Response(401, json={"error": {"message": "invalid api key"}})

    result = run_connectivity_smoke_test(
        {
            "provider_id": "openai",
            "model_id": "gpt-image-2",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "base_url": "https://relay.local.test/v1",
            "api_key": "bad-key",
            "capability": "image",
            "include_costly": False,
        },
        transport=httpx.MockTransport(handler),
    )

    assert result["ok"] is False
    assert result["error_type"] == "auth_error"
    assert result["release_status"] == "BLOCKED_PROVIDER"
    assert result["request_attempted"] is True
    assert result["response_received"] is True


def test_openai_relay_image_lookup_404_is_not_marked_reachable_or_skipped():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) in {
            "https://relay.local.test/models/gpt-image-2",
            "https://relay.local.test/models",
        }
        return httpx.Response(404, json={"error": {"message": "unsupported endpoint"}})

    result = run_connectivity_smoke_test(
        {
            "provider_id": "custom_openai",
            "model_id": "gpt-image-2",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "base_url": "https://relay.local.test",
            "api_key": "test-key",
            "capability": "image",
            "include_costly": False,
        },
        transport=httpx.MockTransport(handler),
    )

    assert result["ok"] is False
    assert result["status_code"] == 404
    assert result["error_type"] == "model_lookup_unavailable"
    assert result["release_status"] == "BLOCKED_LIVE_VERIFICATION"
    assert "真实出图任务" in result["error"]


def test_openai_relay_model_list_can_verify_image_after_detail_404():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    seen_urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_urls.append(str(request.url))
        if str(request.url).endswith("/models/gpt-image-2"):
            return httpx.Response(404, json={"error": {"message": "unsupported endpoint"}})
        return httpx.Response(200, json={"data": [{"id": "gpt-image-2"}]})

    result = run_connectivity_smoke_test(
        {
            "provider_id": "custom_openai",
            "model_id": "gpt-image-2",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "base_url": "https://relay.local.test/v1",
            "api_key": "test-key",
            "capability": "image",
            "include_costly": False,
        },
        transport=httpx.MockTransport(handler),
    )

    assert seen_urls == [
        "https://relay.local.test/v1/models/gpt-image-2",
        "https://relay.local.test/v1/models",
    ]
    assert result["ok"] is True
    assert result["release_status"] == "PASS"
    assert result["endpoint_used"] == "https://relay.local.test/v1/models"


def test_saved_successful_image_task_is_real_connectivity_evidence(monkeypatch, tmp_path: Path):
    from backend.core.database import SessionLocal
    from backend.db.models import Asset, ModelConfig, Task
    from backend.services import model_service

    image_path = tmp_path / "verified-output.png"
    image_path.write_bytes(b"\x89PNG\r\n\x1a\nverified")
    with SessionLocal() as db:
        config = ModelConfig(
            provider_type="openai_compatible",
            provider_name="OpenAI-Compatible Relay",
            routing_mode="relay_base_url",
            base_url="https://relay.local.test/v1",
            model_name="gpt-image-2",
            capabilities_json=json.dumps(["image"]),
            is_enabled=True,
            priority=90,
            extra_config_json=json.dumps(
                {
                    "provider_id": "openai",
                    "model_id": "gpt-image-2",
                    "capability": "image",
                    "compatibility_mode": "openai_compatible",
                    "default_endpoint_path": "/images/generations",
                }
            ),
        )
        db.add(config)
        db.flush()
        asset = Asset(
            type="render_output",
            file_name=image_path.name,
            file_path=str(image_path),
            mime_type="image/png",
            source="floorplan",
        )
        db.add(asset)
        db.flush()
        task = Task(
            module="floorplan",
            task_type="provider_floorplan_render",
            provider="OpenAI-Compatible Relay",
            model_name="gpt-image-2",
            provider_config_id=config.id,
            status="success",
            progress=100,
            output_payload_json=json.dumps(
                {
                    "assets": [{"id": asset.id}],
                    "endpoint_used": "https://relay.local.test/v1/images/edits",
                }
            ),
        )
        db.add(task)
        db.commit()

        monkeypatch.setattr(
            model_service,
            "run_connectivity_smoke_test",
            lambda *_args, **_kwargs: {
                "ok": False,
                "provider_id": "openai",
                "model_id": "gpt-image-2",
                "routing_mode": "relay_base_url",
                "compatibility_mode": "openai_compatible",
                "error_type": "model_lookup_unavailable",
                "error": "lookup unavailable",
                "status_code": 404,
                "request_attempted": True,
                "response_received": True,
                "release_status": "BLOCKED_LIVE_VERIFICATION",
            },
        )
        result = model_service.test_model_connection(
            db,
            {"provider_config_id": config.id},
        )

        assert result["ok"] is True
        assert result["release_status"] == "PASS"
        assert result["verification_source"] == "successful_task_history"
        assert result["verified_task_id"] == task.id
        assert result["endpoint_used"] == "https://relay.local.test/v1/images/edits"
        assert "真实出图和落盘文件" in result["normalized_output"]


def test_gpt_image_2_costly_probe_reports_probe_endpoint_not_generation_endpoint():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://relay.local.test/v1/models/gpt-image-2"
        return httpx.Response(200, json={"id": "gpt-image-2", "object": "model"})

    result = run_connectivity_smoke_test(
        {
            "provider_id": "custom_openai",
            "model_id": "gpt-image-2",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "base_url": "https://relay.local.test/v1",
            "api_key": "test-key",
            "capability": "image",
            "include_costly": False,
        },
        transport=httpx.MockTransport(handler),
    )

    assert result["ok"] is True
    assert result["endpoint_used"] == "https://relay.local.test/v1/models/gpt-image-2"
    assert result["response_received"] is True
    assert result["fallback_used"] is False
    assert result["normalized_output"] == "gpt-image-2 is reachable without running image generation."


def test_gemini_image_uses_safe_model_lookup_without_generation_call():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    seen_urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_urls.append(str(request.url))
        assert "generateContent" not in str(request.url)
        assert request.headers["x-goog-api-key"] == "gemini-key"
        return httpx.Response(200, json={"name": "models/gemini-2.5-flash-image"})

    result = run_connectivity_smoke_test(
        {
            "provider_id": "google_gemini",
            "model_id": "gemini-2.5-flash-image",
            "routing_mode": "direct_api",
            "compatibility_mode": "native",
            "api_key": "gemini-key",
            "capability": "image",
            "include_costly": False,
        },
        transport=httpx.MockTransport(handler),
    )

    assert seen_urls == ["https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image"]
    assert result["ok"] is True
    assert result["endpoint_used"] == "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image"
    assert result["normalized_output"] == "gemini-2.5-flash-image is reachable without running image generation."
    assert result["cost_risk"] is True


def test_gemini_relay_image_uses_relay_model_lookup_without_generation_call():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://relay.local.test/gemini/v1beta/models/gemini-2.5-flash-image"
        assert "generateContent" not in str(request.url)
        return httpx.Response(200, json={"name": "models/gemini-2.5-flash-image"})

    result = run_connectivity_smoke_test(
        {
            "provider_id": "google_gemini",
            "model_id": "gemini-2.5-flash-image",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "gemini_compatible",
            "base_url": "https://relay.local.test/gemini/v1beta",
            "api_key": "gemini-key",
            "capability": "image",
            "include_costly": False,
        },
        transport=httpx.MockTransport(handler),
    )

    assert result["ok"] is True
    assert result["base_url_used"] == "https://relay.local.test/gemini/v1beta"
    assert result["endpoint_used"] == "https://relay.local.test/gemini/v1beta/models/gemini-2.5-flash-image"
    assert result["normalized_output"] == "gemini-2.5-flash-image is reachable without running image generation."


def test_gemini_direct_and_relay_probe_paths_are_independent():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    seen_urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_urls.append(str(request.url))
        return httpx.Response(200, json={"name": "models/gemini-2.5-flash-image"})

    direct_result = run_connectivity_smoke_test(
        {
            "provider_id": "google_gemini",
            "model_id": "gemini-2.5-flash-image",
            "routing_mode": "direct_api",
            "compatibility_mode": "native",
            "api_key": "gemini-key",
            "capability": "image",
            "include_costly": False,
        },
        transport=httpx.MockTransport(handler),
    )
    relay_result = run_connectivity_smoke_test(
        {
            "provider_id": "google_gemini",
            "model_id": "gemini-2.5-flash-image",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "gemini_compatible",
            "base_url": "https://relay.local.test/gemini/v1beta",
            "api_key": "relay-key",
            "capability": "image",
            "include_costly": False,
        },
        transport=httpx.MockTransport(handler),
    )

    assert direct_result["ok"] is True
    assert relay_result["ok"] is True
    assert seen_urls == [
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image",
        "https://relay.local.test/gemini/v1beta/models/gemini-2.5-flash-image",
    ]


def test_openai_relay_gpt_image_2_timeout_includes_endpoint_and_timeout():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("slow relay")

    result = run_connectivity_smoke_test(
        {
            "provider_id": "openai",
            "model_id": "gpt-image-2",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "base_url": "https://relay.local.test/v1",
            "api_key": "test-key",
            "capability": "image",
            "timeout_sec": 60,
        },
        transport=httpx.MockTransport(handler),
    )

    assert result["ok"] is False
    assert result["error_type"] == "timeout"
    assert result["endpoint_used"] == "https://relay.local.test/v1/models/gpt-image-2"
    assert result["timeout_sec"] == 60
    assert "after 60s" in result["error"]


def test_relay_uses_user_base_url_and_not_official_endpoint():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://relay.local.test/v1/responses"
        assert "api.openai.com" not in str(request.url)
        return httpx.Response(200, json={"output_text": "OK"})

    result = run_connectivity_smoke_test(
        {
            "provider_id": "openai",
            "model_id": "gpt-5.5",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "base_url": "https://relay.local.test/v1",
            "api_key": "test-key",
            "capability": "text",
        },
        transport=httpx.MockTransport(handler),
    )

    assert result["ok"] is True
    assert result["base_url_used"] == "https://relay.local.test/v1"


def test_direct_api_ignores_relay_base_url():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    result = run_connectivity_smoke_test(
        {
            "provider_id": "openai",
            "model_id": "gpt-5.5",
            "routing_mode": "direct_api",
            "compatibility_mode": "native",
            "base_url": "https://relay.local.test/v1",
            "capability": "text",
        }
    )

    assert result["ok"] is False
    assert result["error_type"] == "missing_api_key"
    assert result["endpoint_used"] == "https://api.openai.com/v1/responses"


def test_jimeng_consumer_app_is_unsupported():
    from backend.adapters.model_connectivity import run_connectivity_smoke_test

    result = run_connectivity_smoke_test(
        {
            "provider_id": "jimeng_consumer_app",
            "model_id": "jimeng-consumer-app",
            "routing_mode": "direct_api",
            "compatibility_mode": "native",
            "capability": "text",
        }
    )

    assert result["ok"] is False
    assert result["error_type"] == "unsupported_consumer_app"


def test_local_env_loader_reads_root_and_backend_env_without_overwriting(tmp_path, monkeypatch):
    from backend.core.env import load_local_env

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ARK_API_KEY", raising=False)
    monkeypatch.delenv("VOLCENGINE_REGION", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "already-set")
    backend_dir = tmp_path / "backend"
    backend_dir.mkdir()
    (tmp_path / ".env.local").write_text(
        "OPENAI_API_KEY=root-placeholder\nGEMINI_API_KEY=root-gemini\n",
        encoding="utf-8",
    )
    (backend_dir / ".env.local").write_text(
        "ARK_API_KEY=ark-placeholder\nVOLCENGINE_REGION=cn-north-1\n",
        encoding="utf-8",
    )

    load_local_env(tmp_path)

    assert os.environ["OPENAI_API_KEY"] == "root-placeholder"
    assert os.environ["GEMINI_API_KEY"] == "already-set"
    assert os.environ["ARK_API_KEY"] == "ark-placeholder"
    assert os.environ["VOLCENGINE_REGION"] == "cn-north-1"


def test_saved_provider_config_keeps_runtime_api_key(client: TestClient):
    response = client.post(
        "/api/models/configs",
        json={
            "provider_type": "openai_compatible",
            "provider_name": "OpenAI-Compatible Relay",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "base_url": "https://relay.local.test/v1",
            "api_key_encrypted": "relay-secret",
            "model_name": "gpt-image-2",
            "capabilities_json": ["image", "image_to_image"],
            "timeout_sec": 120,
            "is_enabled": True,
            "priority": 1,
            "extra_config_json": {
                "provider_id": "custom_openai",
                "model_id": "gpt-image-2",
                "capability": "image",
            },
        },
    )

    assert response.status_code == 200
    config = response.json()
    assert config["has_api_key"] is True
    assert "api_key_encrypted" not in config

    from backend.core.database import SessionLocal
    from backend.services.model_service import resolve_runtime_model_payload

    with SessionLocal() as db:
        runtime = resolve_runtime_model_payload(
            db,
            {
                "provider_config_id": config["id"],
                "provider_id": "custom_openai",
                "model_id": "gpt-image-2",
                "routing_mode": "relay_base_url",
                "compatibility_mode": "openai_compatible",
            },
        )

    assert runtime["base_url"] == "https://relay.local.test/v1"
    assert runtime["api_key"] == "relay-secret"
    assert runtime["model_id"] == "gpt-image-2"


def test_relay_config_cannot_be_saved_without_persisted_base_url(client: TestClient):
    response = client.post(
        "/api/models/configs",
        json={
            "provider_type": "openai_compatible",
            "provider_name": "OpenAI-Compatible Relay",
            "provider_id": "openai",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "base_url": "",
            "api_key": "relay-secret",
            "model_name": "gpt-image-2",
            "capabilities_json": ["image", "image_to_image"],
        },
    )

    assert response.status_code == 400
    assert "中转 Base URL 不能为空" in response.json()["detail"]


def test_mobile_relay_config_cannot_be_saved_without_persisted_base_url(client: TestClient):
    response = client.post(
        "/api/models/mobile-routes",
        json={
            "provider_id": "openai",
            "provider_name": "OpenAI",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "base_url": "",
            "api_key": "relay-secret",
            "model_name": "gpt-image-2",
            "capabilities_json": ["image"],
        },
    )

    assert response.status_code == 400
    assert "中转 Base URL 不能为空" in response.json()["detail"]


def test_partial_provider_update_preserves_route_and_api_key(client: TestClient):
    created = client.post(
        "/api/models/configs",
        json={
            "provider_type": "openai_compatible",
            "provider_name": "OpenAI-Compatible Relay",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "base_url": "https://relay.local.test",
            "api_key": "relay-secret",
            "model_name": "gpt-image-2",
            "capabilities_json": ["image", "image_to_image"],
            "timeout_sec": 360,
            "extra_config_json": {
                "provider_id": "custom_openai",
                "model_id": "gpt-image-2",
                "capability": "image",
                "default_endpoint_path": "/images/generations",
            },
        },
    )
    assert created.status_code == 200
    config_id = created.json()["id"]

    updated = client.patch(
        f"/api/models/providers/{config_id}",
        json={"base_url": "https://relay.local.test/v1"},
    )

    assert updated.status_code == 200
    payload = updated.json()
    assert payload["base_url"] == "https://relay.local.test/v1"
    assert payload["routing_mode"] == "relay_base_url"
    assert payload["compatibility_mode"] == "openai_compatible"
    assert payload["default_endpoint_path"] == "/images/generations"
    assert payload["has_api_key"] is True

    from backend.core.database import SessionLocal
    from backend.services.model_service import resolve_runtime_model_payload

    with SessionLocal() as db:
        runtime = resolve_runtime_model_payload(db, {"provider_config_id": config_id})

    assert runtime["api_key"] == "relay-secret"
    assert runtime["compatibility_mode"] == "openai_compatible"
    assert runtime["endpoint_path"] == "/images/generations"
    assert runtime["timeout_sec"] == 900


def test_seed_preserves_user_provider_preferences_with_saved_keys(client: TestClient):
    created = client.post(
        "/api/models/configs",
        json={
            "provider_type": "zhipu_glm",
            "provider_name": "智谱 GLM",
            "provider_id": "zhipu_glm",
            "routing_mode": "direct_api",
            "compatibility_mode": "native",
            "base_url": "https://open.bigmodel.cn/api/paas/v4",
            "api_key": "glm-secret",
            "model_name": "glm-4.5v",
            "model_id": "glm-4.5v",
            "capabilities_json": ["vision", "structured_extraction"],
        },
    )
    assert created.status_code == 200
    config_id = created.json()["id"]
    updated = client.patch(
        "/api/models/module-preferences/room_board_extraction",
        json={"priority_order_json": ["glm-4.5v"], "default_provider_config_id": config_id},
    )
    assert updated.status_code == 200

    from backend.core.database import SessionLocal
    from backend.core.seeds import seed_default_data
    from backend.db.models import ModuleModelPreference

    with SessionLocal() as db:
        seed_default_data(db)
        preference = (
            db.query(ModuleModelPreference)
            .filter(ModuleModelPreference.module_name == "room_board_extraction")
            .one()
        )
        assert preference.default_provider_config_id == config_id


def test_zhipu_direct_runtime_uses_official_zhipu_base_url():
    from backend.core.database import SessionLocal
    from backend.services.model_service import resolve_runtime_model_payload

    with SessionLocal() as db:
        runtime = resolve_runtime_model_payload(
            db,
            {
                "provider_id": "zhipu_glm",
                "model_id": "glm-4.5v",
                "routing_mode": "direct_api",
                "compatibility_mode": "native",
                "capability": "vision",
            },
        )

    assert runtime["provider_id"] == "zhipu_glm"
    assert runtime["base_url"] == "https://open.bigmodel.cn/api/paas/v4"
    assert runtime["endpoint_path"] == "/chat/completions"
