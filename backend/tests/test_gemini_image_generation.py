import base64
import json
from pathlib import Path

import httpx

from backend.adapters.gemini_image_generation import GeminiImageRequest, generate_gemini_image


VALID_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def test_gemini_image_generation_posts_generate_content_and_parses_inline_image(tmp_path: Path):
    source = tmp_path / "room.png"
    source.write_bytes(b"input-image")
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["api_key"] = request.headers.get("x-goog-api-key")
        body = json.loads(request.content.decode("utf-8"))
        seen["body"] = body
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "inlineData": {
                                        "mimeType": "image/png",
                                        "data": base64.b64encode(VALID_PNG).decode("ascii"),
                                    }
                                }
                            ]
                        }
                    }
                ]
            },
        )

    result = generate_gemini_image(
        GeminiImageRequest(
            base_url="https://generativelanguage.googleapis.com/v1beta",
            api_key="gemini-key",
            model_id="gemini-2.5-flash-image",
            prompt="生成真实感室内效果图",
            timeout_sec=30,
            source_files=[source],
            transport=httpx.MockTransport(handler),
        )
    )

    assert seen["url"] == "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent"
    assert seen["api_key"] == "gemini-key"
    body = seen["body"]
    assert isinstance(body, dict)
    parts = body["contents"][0]["parts"]
    assert parts[0]["inlineData"]["mimeType"] == "image/png"
    assert parts[-1]["text"] == "生成真实感室内效果图"
    assert body["generationConfig"]["responseModalities"] == ["IMAGE", "TEXT"]
    assert result["ok"] is True
    assert result["image_bytes"] == VALID_PNG
    assert result["mime_type"] == "image/png"


def test_gemini_relay_generation_posts_relay_generate_content_endpoint():
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["api_key"] = request.headers.get("x-goog-api-key")
        body = json.loads(request.content.decode("utf-8"))
        seen["body"] = body
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "inlineData": {
                                        "mimeType": "image/png",
                                        "data": base64.b64encode(VALID_PNG).decode("ascii"),
                                    }
                                }
                            ]
                        }
                    }
                ]
            },
        )

    result = generate_gemini_image(
        GeminiImageRequest(
            base_url="https://relay.example.com/gemini/v1beta",
            api_key="relay-gemini-key",
            model_id="gemini-2.5-flash-image",
            prompt="生成真实感室内效果图",
            timeout_sec=30,
            transport=httpx.MockTransport(handler),
        )
    )

    assert seen["url"] == "https://relay.example.com/gemini/v1beta/models/gemini-2.5-flash-image:generateContent"
    assert "generativelanguage.googleapis.com" not in str(seen["url"])
    assert seen["api_key"] == "relay-gemini-key"
    assert result["ok"] is True
    assert result["image_bytes"] == VALID_PNG


def test_gemini_image_generation_reports_text_only_response():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"candidates": [{"content": {"parts": [{"text": "需要更多信息"}]}}]},
        )

    try:
        generate_gemini_image(
            GeminiImageRequest(
                base_url="https://relay.example.com/gemini/v1beta",
                api_key="gemini-key",
                model_id="gemini-2.5-flash-image",
                prompt="生成真实感室内效果图",
                timeout_sec=30,
                transport=httpx.MockTransport(handler),
            )
        )
    except RuntimeError as exc:
        assert "did not contain image data" in str(exc)
        assert "需要更多信息" in str(exc)
    else:
        raise AssertionError("Expected text-only Gemini response to fail.")
