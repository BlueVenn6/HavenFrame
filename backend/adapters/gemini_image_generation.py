import base64
import json
import mimetypes
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from backend.core.redaction import redact_secrets, redact_text, redact_url
from backend.core.image_security import validate_generated_image_payload


@dataclass
class GeminiImageRequest:
    base_url: str
    api_key: str
    model_id: str
    prompt: str
    timeout_sec: int
    headers_json: dict[str, Any] | None = None
    source_files: list[Path] | None = None
    transport: httpx.BaseTransport | None = None


def generate_gemini_image(request: GeminiImageRequest) -> dict[str, Any]:
    if not request.base_url:
        raise ValueError("Base URL is required.")
    if not request.api_key:
        raise ValueError("API key is required.")
    if not request.model_id:
        raise ValueError("Model id is required.")
    if not request.prompt.strip():
        raise ValueError("Prompt is required.")

    endpoint = _gemini_generate_content_endpoint(request.base_url, request.model_id)
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": request.api_key,
        **_coerce_headers(request.headers_json),
    }
    body = _gemini_body(request)
    try:
        with httpx.Client(timeout=request.timeout_sec, transport=request.transport) as client:
            response = client.post(endpoint, json=body, headers=headers)
        return _parse_gemini_image_response(response, endpoint)
    except httpx.TimeoutException:
        raise RuntimeError(redact_text(f"Gemini image request timed out after {request.timeout_sec}s. Endpoint: {redact_url(endpoint)}"))
    except httpx.RequestError as exc:
        raise RuntimeError(redact_text(f"{exc} Endpoint: {redact_url(endpoint)}")) from exc


def _gemini_body(request: GeminiImageRequest) -> dict[str, Any]:
    parts: list[dict[str, Any]] = []
    for path in request.source_files or []:
        if not path.exists():
            continue
        mime_type = mimetypes.guess_type(path.name)[0] or "image/png"
        if not mime_type.startswith("image/"):
            continue
        parts.append(
            {
                "inlineData": {
                    "mimeType": mime_type,
                    "data": base64.b64encode(path.read_bytes()).decode("ascii"),
                }
            }
        )
    parts.append({"text": request.prompt})
    return {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"responseModalities": ["IMAGE", "TEXT"]},
    }


def _parse_gemini_image_response(response: httpx.Response, endpoint: str) -> dict[str, Any]:
    if response.status_code >= 400:
        raise RuntimeError(redact_text(f"HTTP {response.status_code}: {_extract_error(response)} Endpoint: {redact_url(endpoint)}"))
    try:
        data = response.json()
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Gemini response was not valid JSON. Endpoint: {redact_url(endpoint)}") from exc
    image = _first_inline_image(data)
    if image is None:
        text = _first_text(data)
        suffix = f" Provider text response: {text}" if text else ""
        raise RuntimeError(redact_text(f"Gemini response did not contain image data.{suffix} Endpoint: {redact_url(endpoint)}"))
    try:
        image_bytes = base64.b64decode(image["data"], validate=True)
    except (ValueError, TypeError) as exc:
        raise RuntimeError("Gemini response contained invalid base64 image data.") from exc
    mime_type = validate_generated_image_payload(image_bytes, image.get("mime_type") or "image/png")
    return {
        "ok": True,
        "endpoint_used": endpoint,
        "status_code": response.status_code,
        "image_bytes": image_bytes,
        "mime_type": mime_type,
        "provider_response": _safe_preview(data),
    }


def _first_inline_image(data: dict[str, Any]) -> dict[str, str] | None:
    candidates = data.get("candidates")
    if not isinstance(candidates, list):
        return None
    for candidate in candidates:
        content = candidate.get("content") if isinstance(candidate, dict) else None
        parts = content.get("parts") if isinstance(content, dict) else None
        if not isinstance(parts, list):
            continue
        for part in parts:
            if not isinstance(part, dict):
                continue
            inline = part.get("inline_data") or part.get("inlineData")
            if not isinstance(inline, dict):
                continue
            data_value = inline.get("data")
            mime_type = inline.get("mime_type") or inline.get("mimeType") or "image/png"
            if isinstance(data_value, str) and data_value:
                return {"data": data_value, "mime_type": str(mime_type)}
    return None


def _first_text(data: dict[str, Any]) -> str | None:
    candidates = data.get("candidates")
    if not isinstance(candidates, list):
        return None
    for candidate in candidates:
        content = candidate.get("content") if isinstance(candidate, dict) else None
        parts = content.get("parts") if isinstance(content, dict) else None
        if not isinstance(parts, list):
            continue
        for part in parts:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                return part["text"][:500]
    return None


def _extract_error(response: httpx.Response) -> str:
    try:
        data = response.json()
    except json.JSONDecodeError:
        return _safe_text(response.text) or f"Provider returned HTTP {response.status_code}."
    error = data.get("error") if isinstance(data, dict) else None
    if isinstance(error, dict):
        return _safe_text(str(error.get("message") or error))
    if isinstance(error, str):
        return _safe_text(error)
    return _safe_text(json.dumps(data, ensure_ascii=False))


def _safe_preview(data: dict[str, Any]) -> dict[str, Any]:
    preview = redact_secrets(json.loads(json.dumps(data, ensure_ascii=False)))
    for candidate in preview.get("candidates", []) if isinstance(preview, dict) else []:
        parts = ((candidate.get("content") or {}).get("parts") or []) if isinstance(candidate, dict) else []
        for part in parts:
            inline = part.get("inline_data") or part.get("inlineData") if isinstance(part, dict) else None
            if isinstance(inline, dict) and "data" in inline:
                inline["data"] = "<base64 image omitted>"
    return preview


def _safe_text(value: str | None, limit: int = 800) -> str:
    redacted = redact_text(value or "") or ""
    return redacted[:limit]


def _gemini_generate_content_endpoint(base_url: str, model_id: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.endswith(":generateContent"):
        return normalized
    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Base URL must start with http:// or https://.")
    return f"{normalized}/models/{model_id}:generateContent"


def _coerce_headers(headers_json: dict[str, Any] | str | None) -> dict[str, str]:
    if not headers_json:
        return {}
    if isinstance(headers_json, str):
        try:
            parsed = json.loads(headers_json)
        except json.JSONDecodeError:
            return {}
        headers_json = parsed if isinstance(parsed, dict) else {}
    return {str(key): str(value) for key, value in headers_json.items()}
