import base64
import json
import mimetypes
import ssl
from contextlib import ExitStack
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.parse import urljoin

import httpx

from backend.core.redaction import redact_secrets, redact_text, redact_url
from backend.core.image_security import validate_generated_image_payload
from backend.core.url_policy import validate_remote_asset_url


@dataclass
class OpenAIImageRequest:
    base_url: str
    api_key: str
    model_id: str
    prompt: str
    timeout_sec: int
    headers_json: dict[str, Any] | None = None
    source_files: list[Path] | None = None
    size: str = "1024x1024"
    require_source_images: bool = False


def generate_openai_image(request: OpenAIImageRequest) -> dict[str, Any]:
    if not request.base_url:
        raise ValueError("Base URL is required.")
    if not request.api_key:
        raise ValueError("API key is required.")
    if not request.model_id:
        raise ValueError("Model id is required.")
    if not request.prompt.strip():
        raise ValueError("Prompt is required.")

    base_url = _api_base_url(request.base_url)
    headers = {
        "Authorization": f"Bearer {request.api_key}",
        **_coerce_headers(request.headers_json),
    }
    source_files = [path for path in (request.source_files or []) if path.exists()]

    if source_files:
        edit_endpoint = _join_url(base_url, "/images/edits")
        edit_result = _post_image_edit(edit_endpoint, request, headers, source_files)
        if edit_result.get("ok"):
            return edit_result
        if request.require_source_images and not _can_fallback_from_edit_failure(edit_result):
            raise RuntimeError(_provider_error_message(edit_result))
        if edit_result.get("status_code") not in {400, 404, 405, 422}:
            if not _can_fallback_from_edit_failure(edit_result):
                raise RuntimeError(_provider_error_message(edit_result))

    generation_endpoint = _join_url(base_url, "/images/generations")
    generation_result = _post_image_generation(generation_endpoint, request, headers)
    if generation_result.get("ok"):
        return generation_result
    raise RuntimeError(_provider_error_message(generation_result))


def _post_image_generation(endpoint: str, request: OpenAIImageRequest, headers: dict[str, str]) -> dict[str, Any]:
    body = {
        "model": request.model_id,
        "prompt": request.prompt,
        "n": 1,
        "size": request.size,
    }
    try:
        with httpx.Client(timeout=request.timeout_sec) as client:
            response = client.post(endpoint, json=body, headers={**headers, "Content-Type": "application/json"})
        return _parse_image_response(response, endpoint, request)
    except httpx.TimeoutException:
        return {"ok": False, "endpoint_used": endpoint, "error": f"Request timed out after {request.timeout_sec}s.", "error_type": "timeout"}
    except httpx.RequestError as exc:
        return _request_error_result(endpoint, exc)


def _post_image_edit(endpoint: str, request: OpenAIImageRequest, headers: dict[str, str], source_files: list[Path]) -> dict[str, Any]:
    data = {
        "model": request.model_id,
        "prompt": request.prompt,
        "n": "1",
        "size": request.size,
    }
    file_field_name = "image[]" if len(source_files) > 1 else "image"
    try:
        with ExitStack() as stack:
            files = []
            for image_path in source_files:
                media_type = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
                file_handle = stack.enter_context(image_path.open("rb"))
                files.append((file_field_name, (image_path.name, file_handle, media_type)))
            with httpx.Client(timeout=request.timeout_sec) as client:
                response = client.post(endpoint, data=data, files=files, headers=headers)
        result = _parse_image_response(response, endpoint, request)
        if len(source_files) > 1 and not result.get("ok") and result.get("status_code") in {400, 422}:
            return _post_image_edit_repeated_image_field(endpoint, request, headers, source_files, data)
        return result
    except httpx.TimeoutException:
        return {"ok": False, "endpoint_used": endpoint, "error": f"Request timed out after {request.timeout_sec}s.", "error_type": "timeout"}
    except httpx.RequestError as exc:
        return _request_error_result(endpoint, exc)


def _post_image_edit_repeated_image_field(
    endpoint: str,
    request: OpenAIImageRequest,
    headers: dict[str, str],
    source_files: list[Path],
    data: dict[str, str],
) -> dict[str, Any]:
    try:
        with ExitStack() as stack:
            files = []
            for image_path in source_files:
                media_type = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
                file_handle = stack.enter_context(image_path.open("rb"))
                files.append(("image", (image_path.name, file_handle, media_type)))
            with httpx.Client(timeout=request.timeout_sec) as client:
                response = client.post(endpoint, data=data, files=files, headers=headers)
        return _parse_image_response(response, endpoint, request)
    except httpx.TimeoutException:
        return {"ok": False, "endpoint_used": endpoint, "error": f"Request timed out after {request.timeout_sec}s.", "error_type": "timeout"}
    except httpx.RequestError as exc:
        return _request_error_result(endpoint, exc)


def _parse_image_response(response: httpx.Response, endpoint: str, request: OpenAIImageRequest) -> dict[str, Any]:
    if response.status_code >= 400:
        return {
            "ok": False,
            "endpoint_used": endpoint,
            "status_code": response.status_code,
            "error_type": "auth_error" if response.status_code in {401, 403} else "provider_error",
            "error": _extract_error(response),
            "raw_error_preview": _safe_text(response.text),
        }

    data = response.json()
    items = data.get("data") if isinstance(data, dict) else None
    if not isinstance(items, list) or not items:
        raise RuntimeError("Provider response did not contain image data.")

    first = items[0]
    if isinstance(first, dict) and isinstance(first.get("b64_json"), str) and first.get("b64_json"):
        try:
            image_bytes = base64.b64decode(first["b64_json"], validate=True)
        except (ValueError, TypeError) as exc:
            raise RuntimeError("Provider response contained invalid base64 image data.") from exc
        mime_type = validate_generated_image_payload(image_bytes, "image/png")
        return {
            "ok": True,
            "endpoint_used": endpoint,
            "status_code": response.status_code,
            "image_bytes": image_bytes,
            "mime_type": mime_type,
            "provider_response": _safe_preview(data),
        }
    if isinstance(first, dict) and isinstance(first.get("url"), str):
        image_url = first["url"]
        image_bytes, mime_type = _download_provider_image(image_url, min(request.timeout_sec, 120))
        return {
            "ok": True,
            "endpoint_used": endpoint,
            "status_code": response.status_code,
            "image_bytes": image_bytes,
            "mime_type": mime_type,
            "provider_response": _safe_preview(data),
        }

    raise RuntimeError("Provider response did not contain b64_json or url.")


def _download_provider_image(image_url: str, timeout_sec: int) -> tuple[bytes, str]:
    current_url = image_url
    with httpx.Client(timeout=timeout_sec, follow_redirects=False) as client:
        for _ in range(4):
            validate_remote_asset_url(current_url)
            response = client.get(current_url)
            if response.status_code in {301, 302, 303, 307, 308}:
                location = response.headers.get("location")
                if not location:
                    raise RuntimeError("Provider image redirect did not include a location.")
                current_url = urljoin(current_url, location)
                continue
            response.raise_for_status()
            mime_type = validate_generated_image_payload(
                response.content,
                response.headers.get("content-type"),
            )
            return response.content, mime_type
    raise RuntimeError("Provider image URL exceeded the redirect limit.")


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


def _provider_error_message(result: dict[str, Any]) -> str:
    endpoint = result.get("endpoint_used") or "provider endpoint"
    status = result.get("status_code")
    error = result.get("error") or result.get("raw_error_preview") or "Provider request failed."
    status_text = f"HTTP {status}: " if status else ""
    return _safe_text(f"{status_text}{error} Endpoint: {redact_url(endpoint)}")


def _request_error_result(endpoint: str, exc: httpx.RequestError) -> dict[str, Any]:
    raw_error = _safe_text(str(exc))
    if _is_tls_record_error(exc, raw_error):
        return {
            "ok": False,
            "endpoint_used": endpoint,
            "error": (
                "远端中转在 HTTPS/TLS 上传阶段断开连接。"
                "本地前端 5173 和后端 8000 端口通常不是原因；请检查 Base URL 是否必须使用 HTTPS、"
                "中转是否支持当前图片端点和 multipart 图片上传，或稍后重试。"
                f" 原始错误：{raw_error}"
            ),
            "error_type": "tls_record_error",
        }
    return {"ok": False, "endpoint_used": endpoint, "error": raw_error, "error_type": "network_error"}


def _is_tls_record_error(exc: httpx.RequestError, raw_error: str) -> bool:
    text = raw_error.lower()
    if "bad_record_mac" in text or "sslv3_alert_bad_record_mac" in text:
        return True
    current: BaseException | None = exc
    while current:
        if isinstance(current, ssl.SSLError):
            return True
        current = current.__cause__ or current.__context__
    return False


def _can_fallback_from_edit_failure(result: dict[str, Any]) -> bool:
    return result.get("error_type") in {"tls_record_error", "network_error", "timeout"}


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


def _safe_preview(data: dict[str, Any]) -> dict[str, Any]:
    preview = redact_secrets(dict(data))
    if isinstance(preview.get("data"), list):
        preview["data"] = [
            {
                key: ("<base64 image omitted>" if key == "b64_json" else value)
                for key, value in item.items()
            }
            for item in preview["data"]
            if isinstance(item, dict)
        ]
    return preview


def _safe_text(value: str | None, limit: int = 800) -> str:
    redacted = redact_text(value or "") or ""
    return redacted[:limit]


def _api_base_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    for suffix in ("/chat/completions", "/responses", "/images/generations", "/images/edits"):
        if normalized.endswith(suffix):
            return normalized[: -len(suffix)]
    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Base URL must start with http:// or https://.")
    return normalized


def _join_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"
