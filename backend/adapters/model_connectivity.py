import json
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse
from urllib.parse import urlencode

import httpx

from backend.core.redaction import redact_text, redact_url
from backend.core.security_context import SecurityContextError, require_security_context_allowed
from backend.core.url_policy import URLPolicyError


ERROR_MESSAGES = {
    "missing_api_key": "Missing API key or required auth field.",
    "missing_base_url": "Base URL is required for this routing mode.",
    "auth_error": "Authentication failed. Check API key.",
    "network_error": "Network error. Check host, relay URL, or local service.",
    "timeout": "Request timed out.",
    "invalid_request": "Provider rejected the request. Check model, endpoint, and payload.",
    "unsupported_model": "This model or capability is not supported by this smoke test.",
    "model_lookup_unavailable": "中转已响应，但没有提供 OpenAI 模型查询接口；当前 API Key 与 gpt-image-2 只能通过工作流中的真实出图任务确认。",
    "response_parse_error": "Response was received but could not be parsed.",
    "provider_error": "Provider returned an error.",
    "unknown_error": "Unknown provider connectivity error.",
    "unsupported_auth": "Provider auth signing is not configured for this smoke test.",
    "invalid_headers_json": "Headers JSON must be an object.",
    "skipped_cost_risk": "Skipped image model to avoid billable provider calls.",
    "not_tested_missing_credentials": "Not tested because required credentials are missing.",
    "cost_risk_skipped": "Skipped image model to avoid billable provider calls.",
    "needs_official_id_verification": "Official API model id is not confirmed; live test is disabled.",
    "unsupported_consumer_app": "Consumer app membership/token access is not an API provider.",
    "unsupported_compatibility": "This compatibility mode is not supported for the selected provider.",
    "invalid_secret_placeholder": "Credential/header contains placeholder text. Check .env.local.",
    "invalid_secret_format": "Credential/header contains non-ASCII characters. Check .env.local.",
    "invalid_header_value": "HTTP header keys and values must be ASCII strings. Check custom headers.",
    "invalid_base_url": "Base URL must start with http:// or https:// and must not contain spaces, non-ASCII characters, or placeholder text.",
    "url_policy_blocked": "URL policy blocked this endpoint.",
}


PLACEHOLDER_MARKERS = ("你的", "这里", "填", "示例", "example", "your_", "xxx", "<your", "paste")
OPENAI_DIRECT_BASE_URL = "https://api.openai.com/v1"
ZHIPU_DIRECT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4"
ZAI_DIRECT_BASE_URL = "https://api.z.ai/api/paas/v4"


@dataclass
class SmokeTestContext:
    provider_id: str
    provider_label: str
    model_id: str
    display_name: str
    capability: str
    routing_mode: str
    compatibility_mode: str
    base_url: str | None
    endpoint_path: str | None
    api_key: str | None
    access_key: str | None
    secret_key: str | None
    region: str | None
    headers_json: dict[str, Any] | None
    body_template_json: dict[str, Any] | None
    test_prompt: str
    timeout_sec: int
    include_costly: bool


def run_connectivity_smoke_test(
    payload: dict[str, Any],
    transport: httpx.BaseTransport | None = None,
) -> dict[str, Any]:
    context = SmokeTestContext(
        provider_id=payload.get("provider_id") or "",
        provider_label=payload.get("provider_label") or payload.get("provider_id") or "",
        model_id=payload.get("model_id") or "",
        display_name=payload.get("display_name") or payload.get("model_label") or payload.get("model_id") or "",
        capability=payload.get("capability") or "text",
        routing_mode=payload.get("routing_mode") or "direct_api",
        compatibility_mode=payload.get("compatibility_mode") or "native",
        base_url=_clean(payload.get("base_url")),
        endpoint_path=_clean(payload.get("endpoint_path")),
        api_key=_clean(payload.get("api_key")),
        access_key=_clean(payload.get("access_key")),
        secret_key=_clean(payload.get("secret_key")),
        region=_clean(payload.get("region")),
        headers_json=_coerce_json_object(payload.get("headers_json")),
        body_template_json=_coerce_json_object(payload.get("body_template_json")),
        test_prompt=payload.get("test_prompt") or "Return the word OK.",
        timeout_sec=int(payload.get("timeout_sec") or 30),
        include_costly=bool(payload.get("include_costly")),
    )

    if context.model_id.startswith("unresolved:") or payload.get("needs_official_id_verification"):
        return _failure(context, "needs_official_id_verification")
    if context.routing_mode == "relay_base_url" and not context.base_url:
        return _failure(context, "missing_base_url")
    if payload.get("headers_json") and context.headers_json is None:
        return _failure(context, "invalid_headers_json")
    if context.base_url and (
        context.routing_mode == "relay_base_url"
        or context.provider_id in {"custom_rest", "custom_rest_provider"}
    ):
        policy_error = _validate_base_url(context)
        if policy_error:
            return _failure(context, "url_policy_blocked", error=policy_error.reason, release_status="CODE_FAILURE")
    secret_error = _validate_secret_values(context)
    if secret_error:
        return _failure(context, secret_error)
    header_error = _validate_header_json_values(context.headers_json)
    if header_error:
        return _failure(context, header_error)
    if _has_cost_risk(context.capability) and not context.include_costly and not _supports_non_costly_probe(context):
        return _failure(context, "cost_risk_skipped")

    if context.provider_id in {"openai", "zhipu_glm", "zai_glm", "custom_openai", "openai_compatible_custom"} or context.compatibility_mode == "openai_compatible":
        return _test_openai_compatible(context, transport)
    if context.provider_id == "google_gemini" or context.compatibility_mode == "gemini_compatible":
        return _test_gemini_compatible(context, transport)
    if context.provider_id == "volcengine_ark":
        return _test_volcengine_ark(context, transport)
    if context.provider_id in {"custom_rest", "custom_rest_provider"} or context.compatibility_mode == "custom_rest":
        return _test_custom_rest(context, transport)
    if context.provider_id == "jimeng_consumer_app":
        return _failure(context, "unsupported_consumer_app")
    if context.provider_id in {"jimeng_volcengine", "volcengine_jimeng"}:
        return _failure(
            context,
            "unsupported_auth",
            error="Volcengine/Jimeng AK/SK signing is not configured yet. Image smoke tests are skipped to avoid cost.",
        )

    return _failure(context, "unsupported_model")


def _test_openai_compatible(
    context: SmokeTestContext,
    transport: httpx.BaseTransport | None,
) -> dict[str, Any]:
    if context.routing_mode == "relay_base_url" and not context.base_url:
        return _failure(context, "missing_base_url")
    base_url = _openai_compatible_base_url(context)
    context.base_url = base_url
    if _has_cost_risk(context.capability) and not context.include_costly:
        if context.routing_mode == "relay_base_url":
            model_lookup = _test_openai_model_lookup(context, base_url, transport)
            if model_lookup.get("ok"):
                return model_lookup
            if model_lookup.get("error_type") == "auth_error" or model_lookup.get("status_code") in {401, 403}:
                return model_lookup
            return model_lookup
        return _test_openai_model_lookup(context, base_url, transport)
    endpoint_path = _openai_compatible_endpoint_path(context)
    endpoint, endpoint_kind = _resolve_openai_endpoint(base_url, endpoint_path)
    if not context.api_key:
        return _failure(context, "missing_api_key", endpoint_used=endpoint)
    body = _openai_smoke_body(context, endpoint_kind)
    headers = {
        "Authorization": f"Bearer {context.api_key}",
        "Content-Type": "application/json",
        **(context.headers_json or {}),
    }
    result = _post_json(context, endpoint, body, headers, _parse_openai_response, transport)
    if (
        not result.get("ok")
        and context.routing_mode == "relay_base_url"
        and (
            result.get("status_code") in {400, 404, 405}
            or result.get("error_type") in {"invalid_request", "unsupported_model"}
        )
        and context.compatibility_mode == "openai_compatible"
        and endpoint_kind == "responses"
    ):
        fallback_endpoint = _join_url(base_url, "/chat/completions")
        fallback_body = _openai_smoke_body(context, "chat_completions")
        fallback = _post_json(
            context,
            fallback_endpoint,
            fallback_body,
            headers,
            _parse_openai_response,
            transport,
            fallback_used=True,
        )
        if fallback.get("ok"):
            fallback["response_preview"] = f"Fallback /chat/completions succeeded. {fallback.get('response_preview') or ''}".strip()
        return fallback
    return result


def _openai_compatible_base_url(context: SmokeTestContext) -> str:
    if context.routing_mode == "relay_base_url":
        return context.base_url or ""
    if context.provider_id == "zhipu_glm":
        return ZHIPU_DIRECT_BASE_URL
    if context.provider_id == "zai_glm":
        return ZAI_DIRECT_BASE_URL
    return OPENAI_DIRECT_BASE_URL


def _openai_compatible_endpoint_path(context: SmokeTestContext) -> str | None:
    if context.endpoint_path:
        return context.endpoint_path
    if context.provider_id in {"zhipu_glm", "zai_glm"}:
        return "/chat/completions"
    if context.model_id.startswith("gpt-image"):
        return "/images/generations"
    return None


def _test_openai_model_lookup(
    context: SmokeTestContext,
    base_url: str,
    transport: httpx.BaseTransport | None,
) -> dict[str, Any]:
    api_base_url = _openai_api_base_url(base_url)
    endpoint = _join_url(api_base_url, f"/models/{context.model_id}")
    if not context.api_key:
        return _failure(context, "missing_api_key", endpoint_used=endpoint)
    headers = {"Authorization": f"Bearer {context.api_key}", **(context.headers_json or {})}
    started = time.perf_counter()
    normalized_headers, header_error = _normalize_headers(headers)
    if header_error:
        return _failure(context, header_error, endpoint_used=endpoint)
    try:
        with httpx.Client(timeout=context.timeout_sec, transport=transport) as client:
            response = client.get(endpoint, headers=normalized_headers)
        latency_ms = int((time.perf_counter() - started) * 1000)
        if response.status_code >= 400:
            if response.status_code == 404:
                return _test_openai_model_list_lookup(context, api_base_url, normalized_headers, started, transport)
            return _http_failure(context, response, endpoint, latency_ms)
        semantic_error = _semantic_error_from_json_response(response)
        if semantic_error:
            if semantic_error["error_type"] == "unsupported_model":
                list_lookup = _test_openai_model_list_lookup(context, api_base_url, normalized_headers, started, transport)
                if list_lookup.get("ok"):
                    return list_lookup
            return _failure(
                context,
                semantic_error["error_type"],
                endpoint_used=endpoint,
                status_code=response.status_code,
                latency_ms=latency_ms,
                error=_safe_preview(semantic_error["error"]),
                raw_error_preview=_safe_preview(response.text),
                request_attempted=True,
                response_received=True,
            )
        return _success(
            context,
            endpoint,
            response.status_code,
            latency_ms,
            _safe_preview(response.text),
            (
                f"{context.model_id} is reachable without running image generation."
                if context.model_id.startswith("gpt-image")
                else f"{context.model_id} is reachable without running generation."
            ),
        )
    except httpx.TimeoutException:
        return _failure(
            context,
            "timeout",
            endpoint_used=endpoint,
            error=f"Request timed out after {context.timeout_sec}s at {_redact_url(endpoint)}. Check whether the relay host is reachable, supports /models/{context.model_id}, or needs a longer timeout.",
            request_attempted=True,
            response_received=False,
        )
    except (httpx.InvalidURL, httpx.LocalProtocolError):
        return _failure(context, "invalid_request", endpoint_used=endpoint)
    except httpx.RequestError as exc:
        return _failure(
            context,
            "network_error",
            endpoint_used=endpoint,
            raw_error_preview=_safe_preview(str(exc)),
            request_attempted=True,
            response_received=False,
        )
    except UnicodeEncodeError:
        return _failure(context, "invalid_header_value", endpoint_used=endpoint)


def _test_openai_model_list_lookup(
    context: SmokeTestContext,
    api_base_url: str,
    headers: dict[str, str],
    started: float,
    transport: httpx.BaseTransport | None,
) -> dict[str, Any]:
    list_endpoint = _join_url(api_base_url, "/models")
    try:
        with httpx.Client(timeout=context.timeout_sec, transport=transport) as client:
            list_response = client.get(list_endpoint, headers=headers)
    except httpx.TimeoutException:
        return _failure(
            context,
            "timeout",
            endpoint_used=list_endpoint,
            error=f"模型列表查询在 {context.timeout_sec} 秒后超时。",
            request_attempted=True,
            response_received=False,
        )
    except (httpx.InvalidURL, httpx.LocalProtocolError):
        return _failure(context, "invalid_request", endpoint_used=list_endpoint)
    except httpx.RequestError as exc:
        return _failure(
            context,
            "network_error",
            endpoint_used=list_endpoint,
            raw_error_preview=_safe_preview(str(exc)),
            request_attempted=True,
            response_received=False,
        )
    latency_ms = int((time.perf_counter() - started) * 1000)
    if list_response.status_code >= 400:
        if list_response.status_code in {404, 405}:
            return _failure(
                context,
                "model_lookup_unavailable",
                endpoint_used=list_endpoint,
                status_code=list_response.status_code,
                latency_ms=latency_ms,
                request_attempted=True,
                response_received=True,
                release_status="BLOCKED_LIVE_VERIFICATION",
            )
        return _http_failure(context, list_response, list_endpoint, latency_ms)
    semantic_error = _semantic_error_from_json_response(list_response)
    if semantic_error:
        return _failure(
            context,
            semantic_error["error_type"],
            endpoint_used=list_endpoint,
            status_code=list_response.status_code,
            latency_ms=latency_ms,
            error=_safe_preview(semantic_error["error"]),
            raw_error_preview=_safe_preview(list_response.text),
            request_attempted=True,
            response_received=True,
        )
    model_ids = _model_ids_from_list_response(list_response)
    if not model_ids:
        return _failure(
            context,
            "model_lookup_unavailable",
            endpoint_used=list_endpoint,
            status_code=list_response.status_code,
            latency_ms=latency_ms,
            error="中转返回了模型列表响应，但没有可核验的模型 ID；请通过工作流中的真实出图任务确认当前线路。",
            raw_error_preview=_safe_preview(list_response.text),
            request_attempted=True,
            response_received=True,
            release_status="BLOCKED_LIVE_VERIFICATION",
        )
    if context.model_id not in model_ids:
        return _failure(
            context,
            "unsupported_model",
            endpoint_used=list_endpoint,
            status_code=list_response.status_code,
            latency_ms=latency_ms,
            error=f"Model '{context.model_id}' was not present in /models.",
            raw_error_preview=_safe_preview(list_response.text),
            request_attempted=True,
            response_received=True,
        )
    return _success(
        context,
        list_endpoint,
        list_response.status_code,
        latency_ms,
        _safe_preview(list_response.text),
        f"{context.model_id} is listed by the relay. No generation was run.",
    )


def _resolve_openai_endpoint(base_url: str, endpoint_path: str | None) -> tuple[str, str]:
    base_kind = _openai_endpoint_kind(base_url)
    if base_kind:
        return base_url.rstrip("/"), base_kind
    path = endpoint_path or "/responses"
    path_kind = _openai_endpoint_kind(path) or "responses"
    return _join_url(base_url, path), path_kind


def _openai_api_base_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    for suffix in ("/chat/completions", "/responses", "/images/generations", "/images/edits"):
        if normalized.endswith(suffix):
            return normalized[: -len(suffix)]
    return normalized


def _openai_endpoint_kind(value: str | None) -> str | None:
    if not value:
        return None
    path = urlparse(value).path if "://" in value else value
    normalized = path.rstrip("/")
    if normalized.endswith("/chat/completions"):
        return "chat_completions"
    if normalized.endswith("/responses"):
        return "responses"
    if normalized.endswith("/images/generations"):
        return "images_generations"
    if normalized.endswith("/images/edits"):
        return "images_edits"
    return None


def _openai_smoke_body(context: SmokeTestContext, endpoint_kind: str) -> dict[str, Any]:
    if endpoint_kind in {"images_generations", "images_edits"}:
        return {
            "model": context.model_id,
            "prompt": context.test_prompt or "A simple modern interior design concept board.",
            "n": 1,
            "size": "1024x1024",
        }
    if endpoint_kind == "chat_completions":
        return {
            "model": context.model_id,
            "messages": [{"role": "user", "content": context.test_prompt}],
            "temperature": 0,
            "max_tokens": 8,
        }
    return {"model": context.model_id, "input": context.test_prompt}


def _test_gemini_compatible(
    context: SmokeTestContext,
    transport: httpx.BaseTransport | None,
) -> dict[str, Any]:
    if context.routing_mode == "relay_base_url" and not context.base_url:
        return _failure(context, "missing_base_url")
    base_url = context.base_url if context.routing_mode == "relay_base_url" else "https://generativelanguage.googleapis.com/v1beta"
    context.base_url = base_url
    endpoint_path = context.endpoint_path or f"/models/{context.model_id}:generateContent"
    endpoint = _join_url(base_url, endpoint_path)
    if _has_cost_risk(context.capability) and not context.include_costly:
        return _test_gemini_model_lookup(context, base_url, transport)
    if not context.api_key:
        return _failure(context, "missing_api_key", endpoint_used=endpoint)
    body = {"contents": [{"parts": [{"text": context.test_prompt}]}]}
    headers = {"Content-Type": "application/json", "x-goog-api-key": context.api_key, **(context.headers_json or {})}
    return _post_json(context, endpoint, body, headers, _parse_gemini_response, transport)


def _test_gemini_model_lookup(
    context: SmokeTestContext,
    base_url: str,
    transport: httpx.BaseTransport | None,
) -> dict[str, Any]:
    endpoint = _join_url(_gemini_api_base_url(base_url), f"/models/{context.model_id}")
    if not context.api_key:
        return _failure(context, "missing_api_key", endpoint_used=endpoint)
    headers = {"x-goog-api-key": context.api_key, **(context.headers_json or {})}
    result = _get_json(context, endpoint, headers, _parse_gemini_model_lookup_response, transport)
    if result.get("ok"):
        result["normalized_output"] = f"{context.model_id} is reachable without running image generation."
    return result


def _gemini_api_base_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    path = urlparse(normalized).path.rstrip("/")
    if path.endswith(":generateContent"):
        model_path = f"/models/{path.rsplit('/models/', 1)[-1]}"
        return normalized[: -len(model_path)]
    if path.endswith(f"/models"):
        return normalized[: -len("/models")]
    if "/models/" in path:
        parsed = urlparse(normalized)
        before_models = path.split("/models/", 1)[0]
        return f"{parsed.scheme}://{parsed.netloc}{before_models}"
    return normalized


def _get_json(
    context: SmokeTestContext,
    endpoint: str,
    headers: dict[str, str],
    parser: Any,
    transport: httpx.BaseTransport | None,
) -> dict[str, Any]:
    started = time.perf_counter()
    normalized_headers, header_error = _normalize_headers(headers)
    if header_error:
        return _failure(context, header_error, endpoint_used=endpoint)
    try:
        with httpx.Client(timeout=context.timeout_sec, transport=transport) as client:
            response = client.get(endpoint, headers=normalized_headers)
        latency_ms = int((time.perf_counter() - started) * 1000)
        if response.status_code >= 400:
            return _http_failure(context, response, endpoint, latency_ms)
        try:
            data = response.json()
            normalized = parser(data)
        except Exception as exc:
            return _failure(
                context,
                "response_parse_error",
                endpoint_used=endpoint,
                status_code=response.status_code,
                latency_ms=latency_ms,
                raw_error_preview=_safe_preview(f"{exc}: {response.text}"),
                request_attempted=True,
                response_received=True,
                release_status="CODE_FAILURE",
            )
        return _success(context, endpoint, response.status_code, latency_ms, _safe_preview(response.text), normalized)
    except httpx.TimeoutException:
        return _failure(
            context,
            "timeout",
            endpoint_used=endpoint,
            error=f"Request timed out after {context.timeout_sec}s at {_redact_url(endpoint)}. Check whether Google Gemini API is reachable or increase the timeout.",
            request_attempted=True,
            response_received=False,
        )
    except (httpx.InvalidURL, httpx.LocalProtocolError):
        return _failure(context, "invalid_request", endpoint_used=endpoint)
    except httpx.RequestError as exc:
        return _failure(
            context,
            "network_error",
            endpoint_used=endpoint,
            raw_error_preview=_safe_preview(str(exc)),
            request_attempted=True,
            response_received=False,
        )
    except UnicodeEncodeError:
        return _failure(context, "invalid_header_value", endpoint_used=endpoint)


def _test_volcengine_ark(
    context: SmokeTestContext,
    transport: httpx.BaseTransport | None,
) -> dict[str, Any]:
    if context.routing_mode == "relay_base_url":
        if not context.base_url:
            return _failure(context, "missing_base_url")
        if context.compatibility_mode not in {"openai_compatible", "custom_rest"}:
            return _failure(context, "unsupported_compatibility")
        return _test_openai_compatible(context, transport)
    context.base_url = "https://ark.volcengineapi.com/api/v3"
    endpoint = _join_url(context.base_url, context.endpoint_path or "/images/generations")
    if not context.api_key:
        return _failure(context, "missing_api_key", endpoint_used=endpoint)
    return _failure(
        context,
        "cost_risk_skipped",
        endpoint_used=endpoint,
        error="Volcengine Ark image smoke tests are skipped unless include_costly=true and a non-generating validate endpoint is available.",
    )


def _supports_non_costly_probe(context: SmokeTestContext) -> bool:
    if context.provider_id in {"openai", "custom_openai", "openai_compatible_custom"}:
        return True
    if context.provider_id == "google_gemini" or context.compatibility_mode == "gemini_compatible":
        return True
    if context.provider_id == "volcengine_ark":
        return False
    return False


def _test_custom_rest(
    context: SmokeTestContext,
    transport: httpx.BaseTransport | None,
) -> dict[str, Any]:
    if not context.base_url:
        return _failure(context, "missing_base_url")
    endpoint = _join_url(context.base_url, context.endpoint_path or "")
    body = _render_template(context.body_template_json or {"prompt": "{{prompt}}"}, context)
    headers = {"Content-Type": "application/json", **(context.headers_json or {})}
    if context.api_key and "Authorization" not in headers:
        headers["Authorization"] = f"Bearer {context.api_key}"
    return _post_json(context, endpoint, body, headers, _parse_custom_rest_response, transport)


def _post_json(
    context: SmokeTestContext,
    endpoint: str,
    body: dict[str, Any],
    headers: dict[str, str],
    parser: Any,
    transport: httpx.BaseTransport | None,
    fallback_used: bool = False,
) -> dict[str, Any]:
    started = time.perf_counter()
    normalized_headers, header_error = _normalize_headers(headers)
    if header_error:
        return _failure(context, header_error, endpoint_used=endpoint)
    try:
        with httpx.Client(timeout=context.timeout_sec, transport=transport) as client:
            response = client.post(endpoint, json=body, headers=normalized_headers)
        latency_ms = int((time.perf_counter() - started) * 1000)
        if response.status_code >= 400:
            return _http_failure(context, response, endpoint, latency_ms, fallback_used=fallback_used)
        try:
            data = response.json()
            normalized = parser(data)
        except Exception as exc:
            return _failure(
                context,
                "response_parse_error",
                endpoint_used=endpoint,
                status_code=response.status_code,
                latency_ms=latency_ms,
                raw_error_preview=_safe_preview(f"{exc}: {response.text}"),
                fallback_used=fallback_used,
                request_attempted=True,
                response_received=True,
                release_status="CODE_FAILURE",
            )
        return _success(context, endpoint, response.status_code, latency_ms, _safe_preview(response.text), normalized, fallback_used=fallback_used)
    except httpx.TimeoutException:
        return _failure(
            context,
            "timeout",
            endpoint_used=endpoint,
            fallback_used=fallback_used,
            error=f"Request timed out after {context.timeout_sec}s at {_redact_url(endpoint)}. Check relay routing, provider endpoint support, or increase the timeout.",
            request_attempted=True,
            response_received=False,
        )
    except (httpx.InvalidURL, httpx.LocalProtocolError):
        return _failure(context, "invalid_request", endpoint_used=endpoint, fallback_used=fallback_used)
    except httpx.RequestError as exc:
        return _failure(
            context,
            "network_error",
            endpoint_used=endpoint,
            raw_error_preview=_safe_preview(str(exc)),
            fallback_used=fallback_used,
            request_attempted=True,
            response_received=False,
        )
    except UnicodeEncodeError:
        return _failure(context, "invalid_header_value", endpoint_used=endpoint, fallback_used=fallback_used)


def _parse_openai_response(data: dict[str, Any]) -> str:
    image_items = data.get("data")
    if isinstance(image_items, list) and image_items:
        first = image_items[0]
        if isinstance(first, dict) and (first.get("b64_json") or first.get("url")):
            return "Image generation endpoint returned an image result."
    if isinstance(data.get("output_text"), str):
        return data["output_text"]
    for output in data.get("output", []):
        for content in output.get("content", []):
            if isinstance(content.get("text"), str):
                return content["text"]
    choices = data.get("choices") or []
    if choices:
        message = choices[0].get("message", {})
        if isinstance(message.get("content"), str):
            return message["content"]
    raise ValueError("No text output found")


def _parse_gemini_response(data: dict[str, Any]) -> str:
    candidates = data.get("candidates") or []
    for candidate in candidates:
        content = candidate.get("content") or {}
        for part in content.get("parts") or []:
            if isinstance(part.get("text"), str):
                return part["text"]
    raise ValueError("No candidate text found")


def _parse_gemini_model_lookup_response(data: dict[str, Any]) -> str:
    name = data.get("name")
    if isinstance(name, str) and name:
        return name
    raise ValueError("No model name found")


def _parse_custom_rest_response(data: dict[str, Any]) -> str:
    for key in ("output", "result", "text", "message"):
        if isinstance(data.get(key), str):
            return data[key]
    return _preview(json.dumps(data, ensure_ascii=False))


def _http_failure(
    context: SmokeTestContext,
    response: httpx.Response,
    endpoint: str,
    latency_ms: int,
    fallback_used: bool = False,
) -> dict[str, Any]:
    error_type = "provider_error"
    if response.status_code in {401, 403}:
        error_type = "auth_error"
    elif response.status_code == 404:
        error_type = "unsupported_model"
    elif 400 <= response.status_code < 500:
        error_type = "invalid_request"
    provider_error = _extract_provider_error(response)
    return _failure(
        context,
        error_type,
        endpoint_used=endpoint,
        status_code=response.status_code,
        latency_ms=latency_ms,
        error=provider_error,
        raw_error_preview=_safe_preview(response.text),
        fallback_used=fallback_used,
        request_attempted=True,
        response_received=True,
    )


def _extract_provider_error(response: httpx.Response) -> str | None:
    try:
        data = response.json()
    except json.JSONDecodeError:
        return _safe_preview(response.text) or None
    if not isinstance(data, dict):
        return None
    error = data.get("error")
    if isinstance(error, dict):
        message = error.get("message")
        if isinstance(message, str) and message:
            return _safe_preview(message)
        return _safe_preview(json.dumps(error, ensure_ascii=False))
    if isinstance(error, str) and error:
        return _safe_preview(error)
    return None


def _semantic_error_from_json_response(response: httpx.Response) -> dict[str, str] | None:
    try:
        data = response.json()
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    error = data.get("error")
    if not error:
        return None
    message = ""
    code = ""
    if isinstance(error, dict):
        message = _safe_preview(str(error.get("message") or error))
        code = str(error.get("code") or error.get("type") or "")
    elif isinstance(error, str):
        message = _safe_preview(error)
    lowered = f"{code} {message}".lower()
    error_type = "provider_error"
    if "model_not_found" in lowered or "does not exist" in lowered or "not found" in lowered:
        error_type = "unsupported_model"
    elif "auth" in lowered or "api key" in lowered or "unauthorized" in lowered:
        error_type = "auth_error"
    elif "invalid" in lowered or "bad request" in lowered:
        error_type = "invalid_request"
    return {"error_type": error_type, "error": message or "Provider returned an error payload."}


def _model_ids_from_list_response(response: httpx.Response) -> set[str]:
    try:
        data = response.json()
    except json.JSONDecodeError:
        return set()
    if not isinstance(data, dict):
        return set()
    items = data.get("data")
    if not isinstance(items, list):
        return set()
    model_ids: set[str] = set()
    for item in items:
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            model_ids.add(item["id"])
    return model_ids


def _success(
    context: SmokeTestContext,
    endpoint: str,
    status_code: int,
    latency_ms: int,
    response_preview: str,
    normalized_output: str,
    fallback_used: bool = False,
) -> dict[str, Any]:
    return {
        "ok": True,
        "provider_id": context.provider_id,
        "model_id": context.model_id,
        "model_id_used": context.model_id,
        "display_name": context.display_name,
        "capability": context.capability,
        "routing_mode": context.routing_mode,
        "compatibility_mode": context.compatibility_mode,
        "base_url_used": context.base_url,
        "endpoint_used": _redact_url(endpoint),
        "timeout_sec": context.timeout_sec,
        "status_code": status_code,
        "latency_ms": latency_ms,
        "response_preview": _redact_secret_text(response_preview, context),
        "normalized_output": _preview(normalized_output),
        "error_type": None,
        "error": None,
        "raw_error_preview": None,
        "cost_risk": _has_cost_risk(context.capability),
        "live_tested": True,
        "request_attempted": True,
        "response_received": True,
        "release_status": "PASS",
        "fallback_used": fallback_used,
    }


def _failure(
    context: SmokeTestContext,
    error_type: str,
    *,
    error: str | None = None,
    endpoint_used: str | None = None,
    status_code: int | None = None,
    latency_ms: int | None = None,
    raw_error_preview: str | None = None,
    fallback_used: bool = False,
    request_attempted: bool = False,
    response_received: bool = False,
    release_status: str | None = None,
) -> dict[str, Any]:
    final_release_status = release_status or _release_status_for_failure(error_type, request_attempted, response_received)
    return {
        "ok": False,
        "provider_id": context.provider_id,
        "model_id": context.model_id,
        "model_id_used": context.model_id,
        "display_name": context.display_name,
        "capability": context.capability,
        "routing_mode": context.routing_mode,
        "compatibility_mode": context.compatibility_mode,
        "base_url_used": context.base_url,
        "endpoint_used": _redact_url(endpoint_used),
        "timeout_sec": context.timeout_sec,
        "status_code": status_code,
        "latency_ms": latency_ms,
        "response_preview": None,
        "normalized_output": None,
        "error_type": error_type,
        "error": error or ERROR_MESSAGES.get(error_type, ERROR_MESSAGES["unknown_error"]),
        "raw_error_preview": _redact_secret_text(raw_error_preview, context),
        "cost_risk": _has_cost_risk(context.capability),
        "live_tested": request_attempted,
        "request_attempted": request_attempted,
        "response_received": response_received,
        "release_status": final_release_status,
        "fallback_used": fallback_used,
    }


def _coerce_json_object(value: Any) -> dict[str, Any] | None:
    if value is None or value == "":
        return None
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


def _render_template(template: dict[str, Any], context: SmokeTestContext) -> dict[str, Any]:
    raw = json.dumps(template, ensure_ascii=False)
    raw = raw.replace("{{prompt}}", context.test_prompt)
    raw = raw.replace("{{model}}", context.model_id)
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {"prompt": context.test_prompt, "model": context.model_id}
    return parsed if isinstance(parsed, dict) else {"prompt": context.test_prompt, "model": context.model_id}


def _normalize_headers(headers: dict[str, Any]) -> tuple[dict[str, str], str | None]:
    normalized: dict[str, str] = {}
    for key, value in headers.items():
        if value is None:
            continue
        key_text = str(key)
        value_text = str(value)
        if _contains_placeholder(key_text) or _contains_placeholder(value_text):
            return {}, "invalid_secret_placeholder"
        try:
            key_text.encode("ascii")
            value_text.encode("ascii")
        except UnicodeEncodeError:
            return {}, "invalid_header_value"
        normalized[key_text] = value_text
    return normalized, None


def _validate_secret_values(context: SmokeTestContext) -> str | None:
    for value in (context.api_key, context.access_key, context.secret_key):
        if not value:
            continue
        if _contains_placeholder(value):
            return "invalid_secret_placeholder"
        if not _is_ascii(value):
            return "invalid_secret_format"
    return None


def _validate_header_json_values(headers_json: dict[str, Any] | None) -> str | None:
    if not headers_json:
        return None
    for key, value in headers_json.items():
        key_text = str(key)
        value_text = str(value)
        if _contains_placeholder(key_text) or _contains_placeholder(value_text):
            return "invalid_secret_placeholder"
        if not _is_ascii(key_text) or not _is_ascii(value_text):
            return "invalid_header_value"
    return None


def _validate_base_url(context: SmokeTestContext) -> URLPolicyError | None:
    base_url = context.base_url or ""
    if _contains_placeholder(base_url) or not _is_ascii(base_url) or any(char.isspace() for char in base_url):
        return URLPolicyError(ERROR_MESSAGES["invalid_base_url"], risk_level="blocked")
    try:
        require_security_context_allowed(
            endpoint=base_url,
            provider_id=context.provider_id,
            routing_mode=context.routing_mode,
            compatibility_mode=context.compatibility_mode,
        )
    except SecurityContextError as exc:
        return URLPolicyError(exc.reason, risk_level=exc.risk_level)
    return None


def _contains_placeholder(value: str) -> bool:
    lowered = value.lower()
    return any(marker in lowered for marker in PLACEHOLDER_MARKERS)


def _is_ascii(value: str) -> bool:
    try:
        value.encode("ascii")
    except UnicodeEncodeError:
        return False
    return True


def _join_url(base_url: str, path: str) -> str:
    if not path:
        return base_url.rstrip("/")
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def _preview(value: str, limit: int = 500) -> str:
    return value[:limit] if len(value) > limit else value


def _safe_preview(value: str | None, limit: int = 500) -> str:
    if not value:
        return ""
    redacted = redact_text(value) or ""
    return _preview(redacted, limit)


def _redact_url(value: str | None) -> str | None:
    return redact_url(value)


def _redact_secret_text(value: str | None, context: SmokeTestContext) -> str | None:
    if value is None:
        return None
    redacted = redact_text(value) or ""
    for secret in (context.api_key, context.access_key, context.secret_key):
        if secret:
            redacted = redacted.replace(secret, "***")
    return redacted


def _has_cost_risk(capability: str) -> bool:
    return capability in {
        "image",
        "text_to_image",
        "image_to_image",
        "image_generation",
        "image_edit",
    }


def _release_status_for_failure(error_type: str, request_attempted: bool, response_received: bool) -> str:
    if error_type in {"missing_api_key", "missing_base_url", "not_tested_missing_credentials"}:
        return "BLOCKED_CREDENTIAL"
    if error_type in {"skipped_cost_risk", "cost_risk_skipped"}:
        return "SKIPPED_COST"
    if error_type in {
        "unsupported_auth",
        "unsupported_consumer_app",
        "unsupported_compatibility",
        "needs_official_id_verification",
    }:
        return "BLOCKED_UNSUPPORTED"
    if error_type in {
        "invalid_headers_json",
        "invalid_secret_placeholder",
        "invalid_secret_format",
        "invalid_header_value",
        "invalid_base_url",
    }:
        return "CODE_FAILURE"
    if error_type in {"response_parse_error"}:
        return "CODE_FAILURE"
    if request_attempted and response_received:
        return "BLOCKED_PROVIDER"
    if request_attempted:
        return "BLOCKED_NETWORK"
    return "NOT_TESTED"


def _clean(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
