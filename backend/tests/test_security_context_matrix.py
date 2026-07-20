from pathlib import Path

from fastapi.testclient import TestClient

from backend.core.redaction import redact_text
from backend.core.security_context import (
    SecurityContextError,
    build_security_context,
    redact_for_log,
    validate_workspace_path,
)


def test_url_policy_fallback_and_data_flow_matrix():
    cases = [
        {
            "name": "official cloud confirmed",
            "kwargs": {
                "endpoint": "https://api.openai.com/v1",
                "provider_id": "openai",
                "routing_mode": "direct_api",
                "task_type": "provider_image_generation",
                "require_data_flow": True,
                "data_flow_confirmed": True,
            },
            "allowed": True,
            "endpoint_type": "official_provider",
            "risk_level": "official",
            "data_flow_state": "confirmed",
        },
        {
            "name": "relay cloud confirmed fallback disabled",
            "kwargs": {
                "endpoint": "https://relay.example.com/v1",
                "provider_id": "custom_openai",
                "routing_mode": "relay_base_url",
                "compatibility_mode": "openai_compatible",
                "task_type": "provider_image_generation",
                "require_data_flow": True,
                "data_flow_confirmed": True,
            },
            "allowed": True,
            "endpoint_type": "remote_relay",
            "risk_level": "relay_risk",
            "fallback_state": "disabled",
        },
        {
            "name": "relay missing data flow blocks fallback opt in",
            "kwargs": {
                "endpoint": "https://relay.example.com/v1",
                "provider_id": "custom_openai",
                "routing_mode": "relay_base_url",
                "compatibility_mode": "openai_compatible",
                "task_type": "provider_image_generation",
                "require_data_flow": True,
                "allow_provider_fallback": True,
            },
            "allowed": False,
            "fallback_state": "blocked_data_flow",
            "data_flow_state": "missing",
        },
    ]
    for case in cases:
        context = build_security_context(**case["kwargs"])
        assert context.allowed is case["allowed"], case["name"]
        for key in ("endpoint_type", "risk_level", "fallback_state", "data_flow_state"):
            if key in case:
                assert getattr(context, key) == case[key], case["name"]


def test_endpoint_spoof_and_url_injection_are_blocked():
    blocked = [
        build_security_context(endpoint="https://api.openai.com.evil.example/v1", provider_id="openai", routing_mode="direct_api"),
        build_security_context(endpoint="http://relay.example.com/v1", provider_id="custom_openai", routing_mode="relay_base_url", compatibility_mode="openai_compatible"),
        build_security_context(endpoint="https://relay.example.com/v1?token=secret", provider_id="custom_openai", routing_mode="relay_base_url", compatibility_mode="openai_compatible"),
        build_security_context(endpoint="https://169.254.169.254/latest", provider_id="custom_openai", routing_mode="relay_base_url", compatibility_mode="openai_compatible"),
    ]
    assert all(not context.allowed for context in blocked)
    assert all(context.url_policy_state == "blocked" for context in blocked)
    assert all(context.reason for context in blocked)


def test_log_injection_and_secret_redaction_are_sanitized():
    payload = "Authorization: Bearer sk-secret\napi_key=abc123 token=tok123 C:\\Users\\example\\client\\room.png"

    redacted = redact_for_log(payload)

    assert "\n" not in redacted
    assert "sk-secret" not in redacted
    assert "abc123" not in redacted
    assert "tok123" not in redacted
    assert "C:\\Users\\example" not in redacted
    assert "[REDACTED]" in redacted


def test_workspace_path_traversal_attempt_is_blocked(tmp_path: Path):
    try:
        validate_workspace_path("../../Windows/System32/drivers/etc/hosts", allowed_roots=[tmp_path])
    except SecurityContextError as exc:
        assert "只能访问" in exc.reason
        assert exc.context.risk_level == "blocked"
    else:
        raise AssertionError("path traversal should be blocked")


def test_security_diagnosis_api_explains_allow_and_reject(client: TestClient):
    allowed = client.get(
        "/api/security/diagnosis",
        params={
            "endpoint": "https://relay.example.com/v1",
            "provider_id": "custom_openai",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "task_type": "provider_image_generation",
            "require_data_flow": True,
            "data_flow_confirmed": True,
        },
    )
    assert allowed.status_code == 200
    allowed_payload = allowed.json()
    assert allowed_payload["allowed"] is True
    assert allowed_payload["cloud_send_allowed"] is True
    assert allowed_payload["endpoint_risk_level"] == "relay_risk"
    assert "url_policy:allowed" in allowed_payload["matched_rules"]

    rejected = client.get(
        "/api/security/diagnosis",
        params={
            "endpoint": "https://relay.example.com/v1?api_key=secret",
            "provider_id": "custom_openai",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "task_type": "provider_image_generation",
            "require_data_flow": True,
        },
    )
    assert rejected.status_code == 200
    rejected_payload = rejected.json()
    assert rejected_payload["allowed"] is False
    assert rejected_payload["url_policy_state"] == "blocked"
    assert rejected_payload["data_flow_state"] == "missing"
    assert rejected_payload["rejected_reasons"]


def test_remote_http_custom_endpoint_is_rejected_by_model_save(client: TestClient):
    response = client.post(
        "/api/models/configs",
        json={
            "provider_id": "custom_openai",
            "provider_type": "custom",
            "provider_name": "Injected Relay",
            "model_name": "gpt-image-2",
            "display_name": "Injected Relay",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "base_url": "http://relay.example.com/v1",
            "api_key": "test-key",
        },
    )

    assert response.status_code == 400
    assert "HTTPS" in response.json()["detail"]


def test_provider_image_missing_data_flow_blocks_even_with_fallback(client: TestClient):
    response = client.post(
        "/api/tasks/provider-image",
        json={
            "project_id": 1,
            "module": "space_render",
            "task_type": "provider_space_render",
            "capability": "image_to_image",
            "provider": "OpenAI-Compatible Custom",
            "model_name": "gpt-image-2",
            "payload_summary": "forced fallback without confirmation",
            "payload_json": {"prompt": "生成一张室内图"},
            "prompt_snapshot": {"resolved_prompt": "生成一张室内图"},
            "allow_provider_fallback": True,
        },
    )

    assert response.status_code == 400
    assert "必须确认数据流" in response.json()["detail"]


def test_provider_raw_error_redaction_does_not_return_secret_or_path():
    raw = (
        "provider raw body api_key=abc123 Authorization: Bearer sk-secret "
        "https://relay.example.com/v1?access_token=tok C:\\Users\\example\\workspace\\client.png"
    )

    redacted = redact_text(raw)

    assert redacted is not None
    assert "abc123" not in redacted
    assert "sk-secret" not in redacted
    assert "access_token=tok" not in redacted
    assert "access_token=[REDACTED]" in redacted
    assert "C:\\Users\\example" not in redacted


def test_asset_file_response_blocks_workspace_escape(client: TestClient, tmp_path: Path):
    from backend.core.database import SessionLocal
    from backend.db.models import Asset

    outside = tmp_path / "outside-secret.png"
    outside.write_bytes(b"not really an image")
    with SessionLocal() as db:
        asset = Asset(
            project_id=1,
            type="render_output",
            file_name="outside-secret.png",
            file_path=str(outside),
            mime_type="image/png",
            source="attack",
        )
        db.add(asset)
        db.commit()
        asset_id = asset.id

    response = client.get(f"/api/assets/{asset_id}/content")

    assert response.status_code == 404
