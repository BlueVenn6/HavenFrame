from __future__ import annotations

import json
import os
import sys
import argparse
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.core.config import OUTPUTS_DIR  # noqa: E402
from backend.core.database import SessionLocal, init_db  # noqa: E402
from backend.core.model_registry import registry_audit  # noqa: E402
from backend.core.seeds import seed_default_data  # noqa: E402
from backend.services import model_service  # noqa: E402


ENV_STATUS_NAMES = [
    "OPENAI_API_KEY",
    "ZHIPU_API_KEY",
    "GEMINI_API_KEY",
    "ARK_API_KEY",
    "OPENAI_RELAY_BASE_URL",
    "OPENAI_RELAY_API_KEY",
    "OPENAI_RELAY_MODEL",
    "GEMINI_RELAY_BASE_URL",
    "GEMINI_RELAY_API_KEY",
    "CUSTOM_REST_BASE_URL",
    "CUSTOM_REST_API_KEY",
    "VOLCENGINE_ACCESS_KEY_ID",
    "VOLCENGINE_SECRET_ACCESS_KEY",
    "VOLCENGINE_REGION",
    "LIVE_COSTLY_MODEL_TESTS",
]

PLACEHOLDER_MARKERS = ("你的", "这里", "填", "示例", "example", "your_", "xxx", "<your", "paste")


def main() -> int:
    args = _parse_args()
    print("Starting connectivity check...")
    print("Environment status:")
    for name in ENV_STATUS_NAMES:
        print(f"- {name}: {_env_status(name)}")
    init_db()
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    include_costly = os.getenv("LIVE_COSTLY_MODEL_TESTS", "0") == "1"
    with SessionLocal() as session:
        seed_default_data(session)
        configs = [
            config
            for config in model_service.list_provider_configs(session)
            if _matches_filters(config, args)
        ]
        results = []
        for config in configs:
            try:
                result = _run_config(session, config, include_costly, args.timeout)
            except Exception:
                result = _local_result(config, "LIVE_FAILED", "Connectivity check failed with an internal error. See tests/logs; secrets were not printed.")
            results.append({**_matrix_row(config, result), "raw_result": result})
            print(_progress_line(config, result))

    audit_path = OUTPUTS_DIR / "model_registry_audit.json"
    json_path = OUTPUTS_DIR / "model_connectivity_report.json"
    md_path = OUTPUTS_DIR / "model_connectivity_report.md"
    audit_path.write_text(json.dumps(registry_audit(), ensure_ascii=False, indent=2), encoding="utf-8")
    json_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    md_path.write_text(_to_markdown(results), encoding="utf-8")
    print(f"Wrote {audit_path}")
    print(f"Wrote {json_path}")
    print(f"Wrote {md_path}")
    return 0


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run safe model connectivity smoke tests.")
    parser.add_argument("--provider", help="Filter by provider_id, for example openai_compatible_custom.")
    parser.add_argument("--routing", choices=["direct_api", "relay_base_url"], help="Filter by routing mode.")
    parser.add_argument("--text-only", action="store_true", help="Only run text-capability checks.")
    parser.add_argument("--timeout", type=int, help="Per-request timeout in seconds.")
    return parser.parse_args()


def _matches_filters(config: dict[str, Any], args: argparse.Namespace) -> bool:
    if args.provider and config.get("provider_id") != args.provider:
        return False
    if args.routing and config.get("routing_mode") != args.routing:
        return False
    if args.text_only and (config.get("capability") or "") != "text":
        return False
    return True


def _run_config(session: Any, config: dict[str, Any], include_costly: bool, timeout_sec: int | None = None) -> dict[str, Any]:
    capability = config.get("capability") or "text"
    provider_id = config.get("provider_id")
    routing_mode = config.get("routing_mode")
    if config.get("needs_official_id_verification"):
        return _local_result(config, "NEEDS_OFFICIAL_ID_VERIFICATION", "Official API model id is not confirmed.")
    if provider_id == "jimeng_consumer_app":
        return _local_result(config, "UNSUPPORTED_CONSUMER_APP", "Jimeng Consumer App is not an API provider.")
    if provider_id == "volcengine_jimeng":
        return _local_result(config, "UNSUPPORTED_AUTH", "Volcengine Jimeng AK/SK signing is not implemented yet.")
    if routing_mode == "relay_base_url" and not (config.get("base_url") or _relay_env_base_url(config.get("compatibility_mode"))):
        payload = _test_payload(config, capability, routing_mode, timeout_sec)
        result = model_service.test_model_connection(session, payload)
        return _with_status_label(result)
    if _has_cost_risk(capability) and not include_costly:
        return _local_result(config, "SKIPPED_COST_RISK", "Skipped to avoid billable image provider calls.")

    payload = _test_payload(config, capability, routing_mode, timeout_sec)
    result = model_service.test_model_connection(session, payload)
    return _with_status_label(result)


def _test_payload(config: dict[str, Any], capability: str, routing_mode: str | None, timeout_sec: int | None = None) -> dict[str, Any]:
    resolved_timeout = timeout_sec or int(os.getenv("MODEL_CONNECTIVITY_TIMEOUT_SEC", "10") or "10")
    return {
        "provider_config_id": config["id"],
        "provider_id": config.get("provider_id"),
        "provider_label": config.get("provider_label"),
        "model_id": config.get("model_id"),
        "display_name": config.get("display_name"),
        "model_label": config.get("model_label"),
        "capability": capability,
        "routing_mode": routing_mode,
        "compatibility_mode": config.get("compatibility_mode"),
        "base_url": config.get("base_url"),
        "endpoint_path": config.get("default_endpoint_path"),
        "headers_json": config.get("headers_json"),
        "body_template_json": config.get("payload_template_json"),
        "test_prompt": "Return only OK.",
        "timeout_sec": min(config.get("timeout_sec") or resolved_timeout, resolved_timeout),
    }


def _with_status_label(result: dict[str, Any]) -> dict[str, Any]:
    if result.get("routing_mode") == "relay_base_url":
        relay_labels = {
            "missing_base_url": "RELAY_MISSING_BASE_URL",
            "missing_api_key": "RELAY_MISSING_API_KEY",
            "timeout": "RELAY_TIMEOUT",
            "auth_error": "RELAY_AUTH_ERROR",
            "provider_error": "RELAY_PROVIDER_ERROR",
            "response_parse_error": "RELAY_RESPONSE_PARSE_ERROR",
        }
        if result.get("ok"):
            return {**result, "status_label": "RELAY_CONFIRMED_LIVE"}
        if result.get("error_type") in relay_labels:
            return {**result, "status_label": relay_labels[result["error_type"]]}
    if result.get("error_type") == "missing_api_key":
        return {**result, "status_label": "NOT_TESTED_MISSING_CREDENTIALS"}
    if result.get("error_type") == "missing_base_url":
        return {**result, "status_label": "NOT_TESTED_MISSING_BASE_URL"}
    if result.get("error_type") == "unsupported_auth":
        return {**result, "status_label": "UNSUPPORTED_AUTH"}
    if result.get("error_type") in {
        "invalid_secret_placeholder",
        "invalid_secret_format",
        "invalid_header_value",
        "invalid_base_url",
    }:
        return {**result, "status_label": str(result.get("error_type")).upper()}
    if result.get("error_type") == "cost_risk_skipped":
        return {**result, "status_label": "SKIPPED_COST_RISK"}
    return {**result, "status_label": "LIVE_OK" if result.get("ok") else "LIVE_FAILED"}


def _release_status_from_label(label: str | None) -> str:
    if not label:
        return "NOT_TESTED"
    normalized = label.upper()
    if normalized in {"LIVE_OK"}:
        return "PASS"
    if normalized in {"RELAY_CONFIRMED_LIVE"}:
        return "PASS"
    if normalized in {"NOT_TESTED_MISSING_CREDENTIALS", "NOT_TESTED_MISSING_BASE_URL"}:
        return "BLOCKED_CREDENTIAL"
    if normalized in {"RELAY_MISSING_BASE_URL", "RELAY_MISSING_API_KEY"}:
        return "BLOCKED_CREDENTIAL"
    if normalized in {"UNSUPPORTED_AUTH", "UNSUPPORTED_CONSUMER_APP", "UNSUPPORTED_COMPATIBILITY"}:
        return "BLOCKED_UNSUPPORTED"
    if normalized in {"SKIPPED_COST_RISK"}:
        return "SKIPPED_COST"
    if normalized in {"INVALID_SECRET_PLACEHOLDER", "INVALID_SECRET_FORMAT", "INVALID_HEADER_VALUE", "INVALID_BASE_URL"}:
        return "CODE_FAILURE"
    if normalized in {"RELAY_AUTH_ERROR"}:
        return "BLOCKED_CREDENTIAL"
    if normalized in {"RELAY_TIMEOUT"}:
        return "BLOCKED_NETWORK"
    if normalized in {"LIVE_FAILED", "RELAY_PROVIDER_ERROR", "RELAY_RESPONSE_PARSE_ERROR"}:
        return "BLOCKED_PROVIDER"
    return "BLOCKED_NETWORK" if "TIMEOUT" in normalized else "BLOCKED_PROVIDER"


def _relay_env_base_url(compatibility_mode: str | None) -> str | None:
    if compatibility_mode == "gemini_compatible":
        return os.getenv("GEMINI_RELAY_BASE_URL")
    if compatibility_mode == "openai_compatible":
        return os.getenv("OPENAI_RELAY_BASE_URL")
    if compatibility_mode == "custom_rest":
        return os.getenv("CUSTOM_REST_BASE_URL")
    return None


def _local_result(config: dict[str, Any], label: str, reason: str) -> dict[str, Any]:
    endpoint_used = _preview_endpoint(config)
    return {
        "ok": False,
        "provider_id": config.get("provider_id"),
        "provider_label": config.get("provider_label"),
        "model_id": config.get("model_id"),
        "display_name": config.get("display_name"),
        "capability": config.get("capability"),
        "routing_mode": config.get("routing_mode"),
        "compatibility_mode": config.get("compatibility_mode"),
        "base_url_used": _preview_base_url(config),
        "endpoint_used": endpoint_used,
        "status_code": None,
        "latency_ms": None,
        "response_preview": None,
        "normalized_output": None,
        "error_type": label.lower(),
        "error": reason,
        "raw_error_preview": None,
        "cost_risk": bool(config.get("costly")),
        "live_tested": False,
        "request_attempted": False,
        "response_received": False,
        "release_status": _release_status_from_label(label),
        "status_label": label,
    }


def _preview_endpoint(config: dict[str, Any]) -> str | None:
    base_url = _preview_base_url(config)
    endpoint_path = config.get("default_endpoint_path")
    if base_url and endpoint_path:
        return f"{str(base_url).rstrip('/')}/{str(endpoint_path).lstrip('/')}"
    return endpoint_path or base_url or config.get("endpoint")


def _preview_base_url(config: dict[str, Any]) -> str | None:
    provider_id = config.get("provider_id")
    if config.get("routing_mode") == "direct_api":
        if provider_id == "google_gemini":
            return "https://generativelanguage.googleapis.com/v1beta"
        if provider_id == "openai":
            return "https://api.openai.com/v1"
        if provider_id == "volcengine_ark":
            return "https://ark.volcengineapi.com/api/v3"
        if provider_id == "volcengine_jimeng":
            return "https://visual.volcengineapi.com"
    return config.get("base_url")


def _matrix_row(config: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    return {
        "provider_id": config.get("provider_id"),
        "provider_label": config.get("provider_label"),
        "model_id": config.get("model_id"),
        "display_name": config.get("display_name"),
        "capability": config.get("capability"),
        "deprecated": bool(config.get("deprecated")),
        "preview": bool(config.get("preview")),
        "routing_mode": config.get("routing_mode"),
        "compatibility_mode": config.get("compatibility_mode"),
        "required_credential": ", ".join(config.get("required_auth_fields") or []),
        "endpoint_or_base_url": result.get("endpoint_used") or result.get("base_url_used") or config.get("base_url") or "n/a",
        "model_id_used": result.get("model_id_used") or result.get("model_id") or config.get("model_id"),
        "fallback_used": bool(result.get("fallback_used")),
        "status_code": result.get("status_code"),
        "latency_ms": result.get("latency_ms"),
        "live_tested": bool(result.get("live_tested")),
        "request_attempted": bool(result.get("request_attempted")),
        "response_received": bool(result.get("response_received")),
        "release_status": result.get("release_status") or _release_status_from_label(result.get("status_label")),
        "result": result.get("status_label") or ("LIVE_OK" if result.get("ok") else "LIVE_FAILED"),
        "reason": result.get("error") or result.get("normalized_output") or "",
    }


def _to_markdown(rows: list[dict[str, Any]]) -> str:
    headers = [
        "provider_id",
        "provider_label",
        "model_id",
        "display_name",
        "capability",
        "deprecated",
        "preview",
        "routing_mode",
        "compatibility_mode",
        "required_credential",
        "endpoint_or_base_url",
        "model_id_used",
        "fallback_used",
        "status_code",
        "latency_ms",
        "live_tested",
        "request_attempted",
        "response_received",
        "release_status",
        "result",
        "reason",
    ]
    lines = [
        "# Model Connectivity Report",
        "",
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(_cell(row.get(header)) for header in headers) + " |")
    lines.append("")
    return "\n".join(lines)


def _cell(value: Any) -> str:
    text = str(value if value is not None else "")
    return text.replace("|", "\\|").replace("\n", " ")[:500]


def _progress_line(config: dict[str, Any], result: dict[str, Any]) -> str:
    provider_id = config.get("provider_id") or "unknown_provider"
    display_name = config.get("display_name") or config.get("model_id") or "unknown_model"
    routing_mode = config.get("routing_mode") or "unknown_routing"
    status = result.get("status_label") or result.get("error_type") or ("ok" if result.get("ok") else "failed")
    prefix = "relay" if routing_mode == "relay_base_url" else provider_id
    details = ""
    if routing_mode == "relay_base_url":
        endpoint_path = _safe_endpoint_path(result.get("endpoint_used"))
        if endpoint_path:
            details = f" endpoint_used={endpoint_path} status={result.get('status_code') or 'n/a'} ok={str(bool(result.get('ok'))).lower()} fallback={str(bool(result.get('fallback_used'))).lower()}"
    return f"[{prefix}] {display_name} {routing_mode} -> {str(status).lower()}{details}"


def _safe_endpoint_path(endpoint: str | None) -> str:
    if not endpoint:
        return ""
    parsed = urlparse(endpoint)
    return parsed.path or endpoint


def _has_cost_risk(capability: str) -> bool:
    return capability in {
        "image",
        "text_to_image",
        "image_to_image",
        "image_generation",
        "image_edit",
    }


def _env_status(name: str) -> str:
    value = os.getenv(name)
    if value is None:
        return "missing"
    if value == "":
        return "empty"
    if _contains_placeholder(value):
        return "invalid_placeholder"
    if not _is_ascii(value):
        return "invalid_non_ascii"
    return "set"


def _contains_placeholder(value: str) -> bool:
    lowered = value.lower()
    return any(marker in lowered for marker in PLACEHOLDER_MARKERS)


def _is_ascii(value: str) -> bool:
    try:
        value.encode("ascii")
    except UnicodeEncodeError:
        return False
    return True


if __name__ == "__main__":
    raise SystemExit(main())
