import base64
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from backend.core.redaction import redact_secrets, redact_text, redact_url


@dataclass
class GLMItemExtractionRequest:
    base_url: str
    api_key: str
    model_id: str
    image_path: Path
    prompt: str
    timeout_sec: int = 120
    headers_json: dict[str, Any] | str | None = None
    transport: httpx.BaseTransport | None = None


def extract_items_with_glm_vision(request: GLMItemExtractionRequest) -> dict[str, Any]:
    if not request.base_url:
        raise ValueError("Base URL is required for item extraction.")
    if not request.api_key:
        raise ValueError("API key is required for item extraction.")
    if not request.model_id:
        raise ValueError("GLM model id is required for item extraction.")
    if not request.model_id.strip().lower().startswith("glm"):
        raise ValueError("Information extraction only accepts GLM model ids.")
    if not request.image_path.exists():
        raise ValueError("Uploaded image file does not exist.")

    base_url = _api_base_url(request.base_url)
    headers = {
        "Authorization": f"Bearer {request.api_key}",
        **_coerce_headers(request.headers_json),
    }
    image_base64 = _image_base64_payload(request.image_path)

    chat_endpoint = _join_url(base_url, "/chat/completions")
    chat_result = _post_chat_completions(chat_endpoint, request, headers, image_base64)
    if chat_result.get("ok"):
        return chat_result
    raise RuntimeError(_provider_error_message(chat_result))


def parse_extracted_items(raw_text: str) -> list[dict[str, Any]]:
    payload = _extract_json(raw_text)
    items = payload.get("items") if isinstance(payload, dict) else payload
    if not isinstance(items, list):
        raise ValueError("Model response did not contain an items array.")

    normalized: list[dict[str, Any]] = []
    for item in items[:12]:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        normalized_item = {
            "category": str(item.get("category") or "未分类").strip()[:128],
            "name": name[:255],
            "material": _optional_text(item.get("material"), 255),
            "color": _optional_text(item.get("color"), 255),
            "color_hex": _optional_color_hex(item.get("color_hex")),
            "bbox": _optional_bbox(item.get("bbox")),
            "selection_state": _selection_state(item.get("selection_state")),
            "notes": _optional_text(item.get("notes") or item.get("reason"), 500),
            "price_min": _optional_number(item.get("price_min")),
            "price_max": _optional_number(item.get("price_max")),
        }
        if (
            normalized_item["price_min"] is not None
            and normalized_item["price_max"] is not None
            and normalized_item["price_min"] > normalized_item["price_max"]
        ):
            raise ValueError(f"Extracted item {name} has price_min greater than price_max.")
        normalized.append(normalized_item)
    if not normalized:
        raise ValueError("Model response did not include usable extracted items.")
    return normalized


def _post_chat_completions(
    endpoint: str,
    request: GLMItemExtractionRequest,
    headers: dict[str, str],
    image_base64: str,
) -> dict[str, Any]:
    body = {
        "model": request.model_id,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": request.prompt},
                    {"type": "image_url", "image_url": {"url": image_base64}},
                ],
            }
        ],
        "temperature": 0.1,
        "thinking": {"type": "disabled"},
    }
    try:
        with httpx.Client(timeout=request.timeout_sec, transport=request.transport) as client:
            response = client.post(endpoint, json=body, headers={**headers, "Content-Type": "application/json"})
        return _parse_text_response(response, endpoint, "chat_completions")
    except httpx.TimeoutException:
        return {"ok": False, "endpoint_used": endpoint, "error": f"Request timed out after {request.timeout_sec}s.", "error_type": "timeout"}
    except httpx.RequestError as exc:
        return {"ok": False, "endpoint_used": redact_url(endpoint), "error": _safe_text(str(exc)), "error_type": "network_error"}


def _parse_text_response(response: httpx.Response, endpoint: str, surface: str) -> dict[str, Any]:
    if response.status_code >= 400:
        return {
            "ok": False,
            "endpoint_used": redact_url(endpoint),
            "status_code": response.status_code,
            "error_type": "auth_error" if response.status_code in {401, 403} else "provider_error",
            "error": _extract_error(response),
            "raw_error_preview": _safe_text(response.text),
        }
    try:
        data = response.json()
    except json.JSONDecodeError:
        return {
            "ok": False,
            "endpoint_used": redact_url(endpoint),
            "status_code": response.status_code,
            "error_type": "invalid_response",
            "error": "Provider returned an invalid JSON response.",
            "raw_error_preview": _safe_text(response.text),
        }
    raw_text = _extract_text(data)
    if not raw_text.strip():
        raise RuntimeError("Provider response did not contain extraction text.")
    return {
        "ok": True,
        "endpoint_used": redact_url(endpoint),
        "status_code": response.status_code,
        "surface": surface,
        "raw_text": raw_text,
        "provider_response": _safe_preview(data),
    }


def _extract_text(data: dict[str, Any]) -> str:
    output_text = data.get("output_text")
    if isinstance(output_text, str):
        return output_text

    output = data.get("output")
    if isinstance(output, list):
        parts: list[str] = []
        for item in output:
            if not isinstance(item, dict):
                continue
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for part in content:
                if isinstance(part, dict) and isinstance(part.get("text"), str):
                    parts.append(part["text"])
        if parts:
            return "\n".join(parts)

    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        message = choices[0].get("message") if isinstance(choices[0], dict) else None
        content = message.get("content") if isinstance(message, dict) else None
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return "\n".join(str(part.get("text") or "") for part in content if isinstance(part, dict))
    return ""


def _extract_json(raw_text: str) -> Any:
    text = raw_text.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE)
    if fenced:
        text = fenced.group(1).strip()
    try:
        parsed = json.loads(text)
        return _select_items_payload(parsed)
    except json.JSONDecodeError:
        decoder = json.JSONDecoder()
        candidates: list[Any] = []
        for index, char in enumerate(text):
            if char not in "{[":
                continue
            try:
                parsed, _ = decoder.raw_decode(text[index:])
            except json.JSONDecodeError:
                continue
            candidates.append(parsed)
        for candidate in candidates:
            selected = _select_items_payload(candidate)
            if selected is not None:
                return selected
        raise


def _select_items_payload(value: Any) -> Any:
    if isinstance(value, dict) and isinstance(value.get("items"), list):
        return value
    if isinstance(value, list):
        if all(isinstance(item, dict) and item.get("name") for item in value):
            return value
        for item in value:
            selected = _select_items_payload(item)
            if selected is not None:
                return selected
    if isinstance(value, dict):
        for item in value.values():
            selected = _select_items_payload(item)
            if selected is not None:
                return selected
    return None


def _image_base64_payload(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


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
    text = json.dumps(preview, ensure_ascii=False)
    if len(text) <= 2000:
        return preview
    return {"preview": text[:2000]}


def _safe_text(value: str | None, limit: int = 800) -> str:
    redacted = redact_text(value or "") or ""
    return redacted[:limit]


def _api_base_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    for suffix in ("/chat/completions", "/images/generations", "/images/edits"):
        if normalized.endswith(suffix):
            return normalized[: -len(suffix)]
    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Base URL must start with http:// or https://.")
    return normalized


def _join_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def _optional_text(value: Any, limit: int) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text[:limit] if text else None


def _optional_number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        return None
    try:
        normalized = str(value).strip().replace(",", "").replace("￥", "").replace("¥", "").removesuffix("元")
        number = float(normalized)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def _optional_color_hex(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip().upper()
    if re.fullmatch(r"#[0-9A-F]{6}", normalized):
        return normalized
    if re.fullmatch(r"[0-9A-F]{6}", normalized):
        return f"#{normalized}"
    return None


def _optional_bbox(value: Any) -> dict[str, float] | None:
    if not isinstance(value, dict):
        return None
    try:
        bbox = {key: float(value[key]) for key in ("x", "y", "width", "height")}
    except (KeyError, TypeError, ValueError):
        return None
    if not all(0 <= bbox[key] <= 1 for key in bbox):
        return None
    if bbox["width"] <= 0 or bbox["height"] <= 0:
        return None
    if bbox["x"] + bbox["width"] > 1.001 or bbox["y"] + bbox["height"] > 1.001:
        return None
    return bbox


def _selection_state(value: Any) -> str:
    raw = str(value or "undecided").lower().strip()
    return raw if raw in {"keep", "replace", "undecided"} else "undecided"
