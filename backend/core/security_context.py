from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from backend.core.config import CACHE_DIR, DATA_DIR, OUTPUTS_DIR, PROJECTS_DIR, TEMP_DIR, WORKSPACE_DIR
from backend.core.redaction import redact_secrets, redact_text
from backend.core.url_policy import URLPolicyError, URLPolicyResult, validate_provider_url


FALLBACK_DISABLED_MESSAGE = "中转失败，未改发官方服务。"


@dataclass(frozen=True)
class SecurityContext:
    provider_id: str = ""
    routing_mode: str = "direct_api"
    compatibility_mode: str = ""
    provider_type: str = ""
    endpoint: str | None = None
    endpoint_type: str = "empty"
    provider_state: str = "unknown"
    url_policy_state: str = "not_required"
    fallback_state: str = "not_applicable"
    data_flow_state: str = "not_required"
    risk_level: str = "none"
    data_flow_confirmed: bool = False
    cloud_send_allowed: bool = False
    fallback_may_trigger: bool = False
    matched_rules: list[str] = field(default_factory=list)
    rejected_reasons: list[str] = field(default_factory=list)
    normalized_endpoint: str | None = None

    @property
    def allowed(self) -> bool:
        return not self.rejected_reasons

    @property
    def reason(self) -> str | None:
        return "；".join(self.rejected_reasons) if self.rejected_reasons else None

    def raise_if_blocked(self) -> None:
        if not self.allowed:
            raise SecurityContextError(self)

    def as_dict(self) -> dict[str, Any]:
        return {
            "allowed": self.allowed,
            "provider_state": self.provider_state,
            "url_policy_state": self.url_policy_state,
            "fallback_state": self.fallback_state,
            "data_flow_state": self.data_flow_state,
            "endpoint_type": self.endpoint_type,
            "risk_level": self.risk_level,
            "endpoint_risk_level": self.risk_level,
            "cloud_send_allowed": self.cloud_send_allowed,
            "fallback_may_trigger": self.fallback_may_trigger,
            "data_flow_confirmed": self.data_flow_confirmed,
            "matched_rules": self.matched_rules,
            "rejected_reasons": self.rejected_reasons,
            "normalized_endpoint": self.normalized_endpoint,
        }


class SecurityContextError(ValueError):
    def __init__(self, context: SecurityContext) -> None:
        super().__init__(context.reason or "安全策略拒绝了当前请求。")
        self.context = context
        self.reason = context.reason or "安全策略拒绝了当前请求。"
        self.risk_level = context.risk_level


def build_security_context(
    *,
    endpoint: str | None = None,
    provider_id: str = "",
    routing_mode: str = "direct_api",
    compatibility_mode: str | None = None,
    provider_type: str | None = None,
    task_type: str | None = None,
    data_flow_confirmed: bool | None = None,
    require_data_flow: bool = False,
    allow_provider_fallback: bool = False,
    fallback_used: bool = False,
) -> SecurityContext:
    provider_id = (provider_id or "").lower()
    routing_mode = routing_mode or "direct_api"
    compatibility_mode = compatibility_mode or ""
    provider_type = provider_type or ""
    task_type = task_type or ""
    rules: list[str] = []
    reasons: list[str] = []

    provider_state = _provider_state(provider_id, routing_mode, compatibility_mode, provider_type)
    endpoint_type = "empty"
    url_policy_state = "not_required"
    risk_level = "none"
    normalized_endpoint = None

    if endpoint:
        try:
            policy = validate_provider_url(
                endpoint,
                provider_id=provider_id,
                routing_mode=routing_mode,
                compatibility_mode=compatibility_mode,
                provider_type=provider_type,
            )
            endpoint_type = _endpoint_type(policy, provider_state)
            url_policy_state = "allowed"
            risk_level = policy.risk_level
            normalized_endpoint = policy.normalized_url
            rules.extend(_rules_for_endpoint(endpoint_type, policy))
        except URLPolicyError as exc:
            endpoint_type = _blocked_endpoint_type(provider_state)
            provider_state = "blocked"
            url_policy_state = "blocked"
            risk_level = exc.risk_level
            reasons.append(exc.reason)
            rules.append("url_policy:blocked")

    confirmed = bool(data_flow_confirmed)
    requires_data_flow = require_data_flow or _task_requires_cloud_data_flow(task_type)
    if requires_data_flow:
        rules.append("data_flow:confirmation_required")
        data_flow_state = "confirmed" if confirmed else "missing"
        if not confirmed:
            reasons.append("真实云端/中转生成前必须确认数据流。")
    else:
        data_flow_state = "not_required"

    fallback_state = _fallback_state(
        allow_provider_fallback=allow_provider_fallback,
        fallback_used=fallback_used,
        requires_data_flow=requires_data_flow,
        data_flow_confirmed=confirmed,
        provider_state=provider_state,
        endpoint_type=endpoint_type,
    )
    if allow_provider_fallback:
        rules.append("fallback:explicit_opt_in")
    else:
        rules.append("fallback:disabled_by_default")
    if fallback_state == "blocked_data_flow":
        reasons.append("fallback 不能绕过 data_flow_confirmed。")

    cloud_endpoint = endpoint_type in {"official_provider", "remote_relay", "custom_endpoint"}
    cloud_send_allowed = cloud_endpoint and not reasons and data_flow_state in {"confirmed", "not_required"}
    fallback_may_trigger = fallback_state == "allowed"

    return SecurityContext(
        provider_id=provider_id,
        routing_mode=routing_mode,
        compatibility_mode=compatibility_mode,
        provider_type=provider_type,
        endpoint=endpoint,
        endpoint_type=endpoint_type,
        provider_state=provider_state,
        url_policy_state=url_policy_state,
        fallback_state=fallback_state,
        data_flow_state=data_flow_state,
        risk_level=risk_level,
        data_flow_confirmed=confirmed,
        cloud_send_allowed=cloud_send_allowed,
        fallback_may_trigger=fallback_may_trigger,
        matched_rules=rules,
        rejected_reasons=reasons,
        normalized_endpoint=normalized_endpoint,
    )


def require_security_context_allowed(**kwargs: Any) -> SecurityContext:
    context = build_security_context(**kwargs)
    context.raise_if_blocked()
    return context


def redact_for_security(value: Any) -> Any:
    return redact_secrets(value)


def redact_for_log(value: str | None) -> str:
    redacted = redact_text(value or "") or ""
    return redacted.replace("\r", "\\r").replace("\n", "\\n")


def validate_workspace_path(path_value: str, *, allowed_roots: list[Path] | None = None) -> Path:
    if not path_value:
        context = SecurityContext(
            provider_state="local",
            url_policy_state="not_required",
            risk_level="blocked",
            matched_rules=["path:workspace_root_required"],
            rejected_reasons=["路径不能为空。"],
        )
        raise SecurityContextError(context)
    path = Path(path_value)
    if not path.is_absolute():
        path = WORKSPACE_DIR / path
    try:
        resolved = path.resolve()
    except OSError as exc:
        context = SecurityContext(
            provider_state="local",
            url_policy_state="not_required",
            risk_level="blocked",
            matched_rules=["path:resolve"],
            rejected_reasons=[redact_for_log(str(exc))],
        )
        raise SecurityContextError(context) from exc
    roots = [root.resolve() for root in (allowed_roots or default_safe_roots())]
    if not any(resolved == root or root in resolved.parents for root in roots):
        context = SecurityContext(
            provider_state="local",
            url_policy_state="not_required",
            risk_level="blocked",
            matched_rules=["path:safe_root_required"],
            rejected_reasons=["只能访问工作区、归档区、输出区、日志区和本地缓存区。"],
        )
        raise SecurityContextError(context)
    return resolved


def default_safe_roots() -> list[Path]:
    return [
        WORKSPACE_DIR,
        PROJECTS_DIR,
        OUTPUTS_DIR,
        WORKSPACE_DIR / "logs",
        DATA_DIR,
        CACHE_DIR,
        TEMP_DIR,
    ]


def _provider_state(provider_id: str, routing_mode: str, compatibility_mode: str, provider_type: str) -> str:
    if routing_mode == "relay_base_url" or compatibility_mode in {"gemini_compatible", "custom_rest"}:
        return "relay"
    if provider_id in {"openai", "google_gemini", "zhipu_glm", "zai_glm", "volcengine_ark", "volcengine_jimeng"}:
        return "official"
    if compatibility_mode == "openai_compatible":
        return "relay"
    if provider_id:
        return "custom"
    return "unknown"


def _endpoint_type(policy: URLPolicyResult, provider_state: str) -> str:
    if policy.category.startswith("official:"):
        return "official_provider"
    if policy.category == "relay":
        return "custom_endpoint" if provider_state == "custom" else "remote_relay"
    if policy.category == "empty":
        return "empty"
    return policy.category


def _blocked_endpoint_type(provider_state: str) -> str:
    if provider_state == "relay":
        return "remote_relay"
    if provider_state == "official":
        return "official_provider"
    return "invalid"


def _rules_for_endpoint(endpoint_type: str, policy: URLPolicyResult) -> list[str]:
    rules = ["url_policy:allowed", "url_policy:no_sensitive_query"]
    if endpoint_type == "official_provider":
        rules.append("url_policy:official_domain_only")
    elif endpoint_type in {"remote_relay", "custom_endpoint"}:
        rules.extend(["url_policy:https_remote_only", "url_policy:no_private_or_metadata_ip"])
    if policy.risk_level == "relay_risk":
        rules.append("risk:remote_relay_receives_assets")
    return rules


def _task_requires_cloud_data_flow(task_type: str) -> bool:
    lowered = task_type.lower()
    return lowered.startswith("provider") or "provider_image" in lowered or "image_generation" in lowered


def _fallback_state(
    *,
    allow_provider_fallback: bool,
    fallback_used: bool,
    requires_data_flow: bool,
    data_flow_confirmed: bool,
    provider_state: str,
    endpoint_type: str,
) -> str:
    if fallback_used:
        return "fallback_used"
    if not allow_provider_fallback:
        return "disabled"
    if requires_data_flow and not data_flow_confirmed:
        return "blocked_data_flow"
    if provider_state in {"relay", "custom"} or endpoint_type in {"remote_relay", "custom_endpoint"}:
        return "allowed"
    return "not_applicable"
