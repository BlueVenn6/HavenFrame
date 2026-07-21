import base64
from pathlib import Path

from backend.adapters.openai_image_generation import OpenAIImageRequest, generate_openai_image
from backend.services.task_service import (
    _generate_openai_image_with_relay_fallback,
    _generate_provider_image,
    _should_fallback_to_official_openai,
)


VALID_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)
VALID_PNG_BASE64 = base64.b64encode(VALID_PNG).decode("ascii")


def test_image_edit_tls_error_falls_back_to_generation(monkeypatch, tmp_path: Path):
    source = tmp_path / "room.png"
    source.write_bytes(b"fake image")
    calls: list[str] = []

    def fake_edit(endpoint, request, headers, source_files):
        calls.append(endpoint)
        return {
            "ok": False,
            "endpoint_used": endpoint,
            "error_type": "tls_record_error",
            "error": "远端中转在 HTTPS/TLS 上传阶段断开连接。",
        }

    def fake_generation(endpoint, request, headers):
        calls.append(endpoint)
        return {
            "ok": True,
            "endpoint_used": endpoint,
            "status_code": 200,
            "image_bytes": b"png",
            "mime_type": "image/png",
        }

    monkeypatch.setattr("backend.adapters.openai_image_generation._post_image_edit", fake_edit)
    monkeypatch.setattr("backend.adapters.openai_image_generation._post_image_generation", fake_generation)

    result = generate_openai_image(
        OpenAIImageRequest(
            base_url="https://relay.example.test/v1",
            api_key="test-key",
            model_id="gpt-image-2",
            prompt="生成空间渲染图",
            timeout_sec=120,
            source_files=[source],
            require_source_images=True,
        ),
    )

    assert result["ok"] is True
    assert calls == [
        "https://relay.example.test/v1/images/edits",
        "https://relay.example.test/v1/images/generations",
    ]


def test_openai_direct_image_generation_posts_official_images_endpoint(monkeypatch):
    seen: list[tuple[str, dict]] = []

    class FakeResponse:
        status_code = 200
        headers = {"content-type": "image/png"}
        text = "valid image response"

        def json(self):
            return {"data": [{"b64_json": VALID_PNG_BASE64}]}

    class FakeClient:
        def __init__(self, timeout):
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, endpoint, json=None, headers=None, data=None, files=None):
            seen.append((endpoint, json or {}))
            return FakeResponse()

    monkeypatch.setattr("backend.adapters.openai_image_generation.httpx.Client", FakeClient)

    result = generate_openai_image(
        OpenAIImageRequest(
            base_url="https://api.openai.com/v1",
            api_key="test-key",
            model_id="gpt-image-2",
            prompt="生成真实感室内效果图",
            timeout_sec=120,
        ),
    )

    assert result["ok"] is True
    assert seen == [
        (
            "https://api.openai.com/v1/images/generations",
            {
                "model": "gpt-image-2",
                "prompt": "生成真实感室内效果图",
                "n": 1,
                "size": "1024x1024",
            },
        )
    ]


def test_openai_relay_image_generation_posts_relay_images_endpoint(monkeypatch):
    seen: list[str] = []

    class FakeResponse:
        status_code = 200
        headers = {"content-type": "image/png"}
        text = "valid image response"

        def json(self):
            return {"data": [{"b64_json": VALID_PNG_BASE64}]}

    class FakeClient:
        def __init__(self, timeout):
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, endpoint, json=None, headers=None, data=None, files=None):
            seen.append(endpoint)
            return FakeResponse()

    monkeypatch.setattr("backend.adapters.openai_image_generation.httpx.Client", FakeClient)

    result = generate_openai_image(
        OpenAIImageRequest(
            base_url="https://relay.example.com/v1",
            api_key="relay-key",
            model_id="gpt-image-2",
            prompt="生成真实感室内效果图",
            timeout_sec=120,
        ),
    )

    assert result["ok"] is True
    assert seen == ["https://relay.example.com/v1/images/generations"]
    assert all("api.openai.com" not in endpoint for endpoint in seen)


def test_relay_channel_error_does_not_fallback_by_default(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "official-key")
    calls: list[tuple[str, str]] = []

    def fake_generate(request: OpenAIImageRequest):
        calls.append((request.base_url, request.api_key))
        if request.base_url == "https://relay.example.com/v1":
            raise RuntimeError("HTTP 503: 分组 sora 下模型 gpt-image-2 无可用渠道（distributor）")
        return {
            "ok": True,
            "endpoint_used": "https://api.openai.com/v1/images/generations",
            "status_code": 200,
            "image_bytes": b"png",
            "mime_type": "image/png",
        }

    monkeypatch.setattr("backend.services.task_service.generate_openai_image", fake_generate)

    try:
        _generate_openai_image_with_relay_fallback(
            {"routing_mode": "relay_base_url", "compatibility_mode": "openai_compatible"},
            OpenAIImageRequest(
                base_url="https://relay.example.com/v1",
                api_key="relay-key",
                model_id="gpt-image-2",
                prompt="生成空间渲染图",
                timeout_sec=120,
            ),
        )
    except RuntimeError as exc:
        assert "中转失败，未改发官方服务" in str(exc)
        assert "fallback_disabled" in str(exc)
    else:
        raise AssertionError("Expected fallback-disabled relay failure.")

    assert calls == [("https://relay.example.com/v1", "relay-key")]


def test_relay_channel_error_falls_back_only_when_explicitly_allowed(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "official-key")
    calls: list[tuple[str, str]] = []

    def fake_generate(request: OpenAIImageRequest):
        calls.append((request.base_url, request.api_key))
        if request.base_url == "https://relay.example.com/v1":
            raise RuntimeError("HTTP 503: 分组 sora 下模型 gpt-image-2 无可用渠道（distributor）")
        return {
            "ok": True,
            "endpoint_used": "https://api.openai.com/v1/images/generations",
            "status_code": 200,
            "image_bytes": b"png",
            "mime_type": "image/png",
        }

    monkeypatch.setattr("backend.services.task_service.generate_openai_image", fake_generate)

    result = _generate_openai_image_with_relay_fallback(
        {
            "provider_id": "custom_openai",
            "routing_mode": "relay_base_url",
            "compatibility_mode": "openai_compatible",
            "allow_provider_fallback": True,
            "data_flow_confirmed": True,
        },
        OpenAIImageRequest(
            base_url="https://relay.example.com/v1",
            api_key="relay-key",
            model_id="gpt-image-2",
            prompt="生成空间渲染图",
            timeout_sec=120,
        ),
    )

    assert result["ok"] is True
    assert result["fallback_used"] is True
    assert result["fallback_status"] == "fallback_used"
    assert calls == [
        ("https://relay.example.com/v1", "relay-key"),
        ("https://api.openai.com/v1", "official-key"),
    ]


def test_openai_hostname_check_does_not_trust_a_suffix_spoof(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "official-key")
    runtime = {
        "routing_mode": "relay_base_url",
        "compatibility_mode": "openai_compatible",
    }
    request = OpenAIImageRequest(
        base_url="https://api.openai.com.evil.example/v1",
        api_key="relay-key",
        model_id="gpt-image-2",
        prompt="test",
        timeout_sec=120,
    )

    assert _should_fallback_to_official_openai(
        runtime,
        request,
        "HTTP 503: no available channel",
    ) is True


def test_provider_image_dispatches_to_gemini_adapter(monkeypatch):
    calls = []

    def fake_generate(request):
        calls.append(request)
        return {
            "ok": True,
            "endpoint_used": "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
            "status_code": 200,
            "image_bytes": b"png",
            "mime_type": "image/png",
        }

    monkeypatch.setattr("backend.services.task_service.generate_gemini_image", fake_generate)

    result = _generate_provider_image(
        {
            "provider_id": "google_gemini",
            "provider_label": "Google Gemini",
            "model_id": "gemini-2.5-flash-image",
            "base_url": "https://generativelanguage.googleapis.com/v1beta",
            "api_key": "gemini-key",
            "timeout_sec": 120,
            "routing_mode": "direct_api",
            "compatibility_mode": "native",
            "data_flow_confirmed": True,
        },
        {"model_name": "gemini-2.5-flash-image"},
        {},
        "生成真实感室内效果图",
        [],
        {"requested_size": "1024x1024"},
    )

    assert result["ok"] is True
    assert result["fallback_used"] is False
    assert len(calls) == 1
    assert calls[0].api_key == "gemini-key"
    assert calls[0].model_id == "gemini-2.5-flash-image"
    assert calls[0].prompt == "生成真实感室内效果图"
