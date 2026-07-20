from __future__ import annotations

import ipaddress
from dataclasses import dataclass
from socket import gaierror, getaddrinfo
from urllib.parse import parse_qsl, urlsplit


SENSITIVE_QUERY_KEYS = {"key", "api_key", "apikey", "token", "access_token", "authorization", "auth", "secret"}
OPENAI_HOSTS = {"api.openai.com"}
GEMINI_HOST_SUFFIXES = ("googleapis.com",)
GEMINI_HOSTS = {"generativelanguage.googleapis.com"}
ZHIPU_HOSTS = {"open.bigmodel.cn"}
ZAI_HOSTS = {"api.z.ai"}
VOLCENGINE_HOST_SUFFIXES = ("volcengineapi.com",)
METADATA_IPS = {ipaddress.ip_address("169.254.169.254")}


class URLPolicyError(ValueError):
    def __init__(self, reason: str, *, risk_level: str = "blocked") -> None:
        super().__init__(reason)
        self.reason = reason
        self.risk_level = risk_level


@dataclass(frozen=True)
class URLPolicyResult:
    ok: bool
    category: str
    risk_level: str
    reason: str | None = None
    normalized_url: str | None = None

    def as_dict(self) -> dict[str, str | bool | None]:
        return {
            "ok": self.ok,
            "category": self.category,
            "risk_level": self.risk_level,
            "reason": self.reason,
            "normalized_url": self.normalized_url,
        }


def validate_provider_url(
    url: str | None,
    *,
    provider_id: str,
    routing_mode: str,
    compatibility_mode: str | None = None,
    provider_type: str | None = None,
) -> URLPolicyResult:
    if not url:
        return URLPolicyResult(True, "empty", "none", normalized_url=None)
    if routing_mode == "relay_base_url" or compatibility_mode in {"openai_compatible", "gemini_compatible", "custom_rest"} or provider_id in {"custom_rest", "custom_openai", "openai_compatible_custom"}:
        if routing_mode != "relay_base_url" and provider_id == "zhipu_glm":
            return validate_official_provider_url(url, "zhipu_glm")
        if routing_mode != "relay_base_url" and provider_id == "zai_glm":
            return validate_official_provider_url(url, "zai_glm")
        return validate_remote_relay_url(url)
    if provider_id == "openai":
        return validate_official_provider_url(url, "openai")
    if provider_id == "google_gemini":
        return validate_official_provider_url(url, "google_gemini")
    if provider_id == "zhipu_glm":
        return validate_official_provider_url(url, "zhipu_glm")
    if provider_id == "zai_glm":
        return validate_official_provider_url(url, "zai_glm")
    if provider_id in {"volcengine_ark", "volcengine_jimeng"}:
        return validate_official_provider_url(url, "volcengine")
    return validate_remote_relay_url(url)


def validate_official_provider_url(url: str, provider_id: str) -> URLPolicyResult:
    parts = _parse_http_url(url)
    _reject_sensitive_query(parts.query)
    if parts.scheme != "https":
        raise URLPolicyError("官方 Provider 只允许 HTTPS 官方域名。")
    host = (parts.hostname or "").lower()
    if provider_id == "openai" and host not in OPENAI_HOSTS:
        raise URLPolicyError("OpenAI 官方 Provider 只允许 api.openai.com。")
    if provider_id == "google_gemini" and not (host in GEMINI_HOSTS or _has_suffix(host, GEMINI_HOST_SUFFIXES)):
        raise URLPolicyError("Google Gemini 官方 Provider 只允许 Google/Gemini 官方域名。")
    if provider_id == "zhipu_glm" and host not in ZHIPU_HOSTS:
        raise URLPolicyError("智谱 GLM 官方 Provider 只允许 open.bigmodel.cn。")
    if provider_id == "zai_glm" and host not in ZAI_HOSTS:
        raise URLPolicyError("Z.AI 国际官方 Provider 只允许 api.z.ai。")
    if provider_id == "volcengine" and not _has_suffix(host, VOLCENGINE_HOST_SUFFIXES):
        raise URLPolicyError("Volcengine 官方 Provider 只允许官方 volcengineapi.com 域名。")
    _reject_metadata_or_private_ip(host, allow_loopback=False)
    return URLPolicyResult(True, f"official:{provider_id}", "official", normalized_url=_normalize_base(parts))


def validate_remote_relay_url(url: str) -> URLPolicyResult:
    parts = _parse_http_url(url)
    _reject_sensitive_query(parts.query)
    if parts.scheme != "https":
        raise URLPolicyError("远程中转 / Custom Endpoint 必须使用 HTTPS，默认禁止远程 HTTP。")
    host = (parts.hostname or "").lower()
    _reject_metadata_or_private_ip(host, allow_loopback=False)
    return URLPolicyResult(True, "relay", "relay_risk", reason="远程中转会接收用户图片、提示词或项目数据，请确认服务可信。", normalized_url=_normalize_base(parts))


def validate_remote_asset_url(url: str) -> URLPolicyResult:
    parts = _parse_http_url(url)
    if parts.scheme != "https":
        raise URLPolicyError("Provider 返回的图片地址必须使用 HTTPS。")
    host = (parts.hostname or "").lower()
    _reject_metadata_or_private_ip(host, allow_loopback=False)
    return URLPolicyResult(True, "provider_asset", "remote_asset", normalized_url=url)


def require_url_allowed(
    url: str | None,
    *,
    provider_id: str,
    routing_mode: str,
    compatibility_mode: str | None = None,
    provider_type: str | None = None,
) -> URLPolicyResult:
    from backend.core.security_context import build_security_context

    context = build_security_context(
        endpoint=url,
        provider_id=provider_id,
        routing_mode=routing_mode,
        compatibility_mode=compatibility_mode,
        provider_type=provider_type,
    )
    if not context.allowed:
        raise URLPolicyError(context.reason or "URL Policy blocked this endpoint.", risk_level=context.risk_level)
    return URLPolicyResult(
        True,
        _policy_category_from_context(context.endpoint_type, provider_id),
        context.risk_level,
        normalized_url=context.normalized_endpoint,
    )


def _policy_category_from_context(endpoint_type: str, provider_id: str) -> str:
    if endpoint_type == "local_service":
        return "local"
    if endpoint_type == "official_provider":
        return f"official:{provider_id or 'provider'}"
    if endpoint_type in {"remote_relay", "custom_endpoint"}:
        return "relay"
    return endpoint_type


def _parse_http_url(url: str):
    try:
        parts = urlsplit(url.strip())
    except ValueError as exc:
        raise URLPolicyError("URL 格式无效。") from exc
    if parts.scheme not in {"http", "https"} or not parts.netloc or not parts.hostname:
        raise URLPolicyError("只允许 http:// 或 https:// URL。")
    if any(char.isspace() for char in url):
        raise URLPolicyError("URL 不能包含空白字符。")
    if parts.username or parts.password:
        raise URLPolicyError("URL 不能包含用户名或密码。")
    return parts


def _reject_sensitive_query(query: str) -> None:
    for key, _ in parse_qsl(query, keep_blank_values=True):
        if key.lower() in SENSITIVE_QUERY_KEYS:
            raise URLPolicyError("URL query 中不能包含 key、api_key、token、access_token、authorization 等敏感参数。")


def _reject_metadata_or_private_ip(host: str, *, allow_loopback: bool) -> None:
    addresses = _host_addresses(host)
    for address in addresses:
        if address in METADATA_IPS or address.is_link_local:
            raise URLPolicyError("禁止访问元数据地址或 link-local 地址。")
        if address.is_private and not (allow_loopback and address.is_loopback):
            raise URLPolicyError("默认禁止私网地址。")
        if address.is_loopback and not allow_loopback:
            raise URLPolicyError("远程中转 / 官方 Provider 不能指向 loopback 地址。")


def _host_addresses(host: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        return [ipaddress.ip_address(host.strip("[]"))]
    except ValueError:
        pass
    try:
        resolved = getaddrinfo(host, None)
    except gaierror:
        return []
    addresses = []
    for item in resolved:
        sockaddr = item[4]
        try:
            addresses.append(ipaddress.ip_address(str(sockaddr[0])))
        except ValueError:
            continue
    return addresses


def _has_suffix(host: str, suffixes: tuple[str, ...]) -> bool:
    return any(host == suffix or host.endswith(f".{suffix}") for suffix in suffixes)


def _normalize_base(parts) -> str:
    path = parts.path.rstrip("/")
    return f"{parts.scheme}://{parts.netloc}{path}"
