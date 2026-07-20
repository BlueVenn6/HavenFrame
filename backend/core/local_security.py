from __future__ import annotations

import hmac
import os
import secrets
from pathlib import Path
from urllib.parse import urlparse

from fastapi import Request, Response, WebSocket
from starlette.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from backend.core.config import DATA_DIR
from backend.core.platform_capabilities import API_PROFILE_CLOUD, current_api_profile


LOCAL_TOKEN_COOKIE = "qigou_local_token"
LOCAL_TOKEN_HEADER = "X-Qigou-Local-Token"
LOCAL_TOKEN_QUERY = "local_token"
LOCAL_TOKEN_PATH = DATA_DIR / "local-api-token"

PUBLIC_PATHS = {"/health", "/api/security/session", "/api/platform/capabilities"}
ALLOWED_HOSTS = {"127.0.0.1", "localhost", "::1"}
ALLOWED_ORIGINS = {
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
}


def allowed_cors_origins() -> list[str]:
    extra = _split_env("QIGOU_ALLOWED_ORIGINS")
    if current_api_profile() == API_PROFILE_CLOUD:
        return sorted(set(extra))
    return sorted(ALLOWED_ORIGINS | set(extra))


def get_local_api_token() -> str:
    env_token = os.getenv("QIGOU_LOCAL_API_TOKEN")
    if env_token:
        return env_token.strip()
    token_path = _token_path()
    token_path.parent.mkdir(parents=True, exist_ok=True)
    if token_path.exists():
        token = token_path.read_text(encoding="utf-8").strip()
        if token:
            return token
    token = secrets.token_urlsafe(32)
    token_path.write_text(token, encoding="utf-8")
    try:
        token_path.chmod(0o600)
    except OSError:
        pass
    return token


def issue_local_session(response: Response) -> dict[str, str]:
    token = get_local_api_token()
    response.set_cookie(
        LOCAL_TOKEN_COOKIE,
        token,
        httponly=True,
        secure=False,
        samesite="strict",
        max_age=60 * 60 * 24 * 30,
        path="/",
    )
    return {
        "token": token,
        "token_header": LOCAL_TOKEN_HEADER,
        "service": "HavenFrame API",
    }


class LocalSecurityMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)
        self.api_profile = current_api_profile()
        configured_hosts = set(_split_env("QIGOU_ALLOWED_HOSTS"))
        configured_origins = set(_split_env("QIGOU_ALLOWED_ORIGINS"))
        self.allowed_hosts = configured_hosts if self.api_profile == API_PROFILE_CLOUD else ALLOWED_HOSTS | configured_hosts
        self.allowed_origins = configured_origins if self.api_profile == API_PROFILE_CLOUD else ALLOWED_ORIGINS | configured_origins

    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS":
            if not self._origin_allowed(request):
                return _error_response(403, "Origin is not allowed.")
            return await call_next(request)

        if self.api_profile == API_PROFILE_CLOUD:
            return await self._dispatch_cloud(request, call_next)

        if not self._host_allowed(request):
            return _error_response(403, "Host is not allowed.")
        if not self._origin_allowed(request):
            return _error_response(403, "Origin is not allowed.")
        if not self._fetch_site_allowed(request):
            return _error_response(403, "Cross-site requests are not allowed.")
        if self._requires_token(request) and not request_has_valid_token(request):
            return _error_response(401, "Missing or invalid local API token.")
        return await call_next(request)

    async def _dispatch_cloud(self, request: Request, call_next):
        if not self.allowed_hosts:
            return _error_response(503, "云端 API 未配置允许的 Host。请设置 QIGOU_ALLOWED_HOSTS。")
        if not self._host_allowed(request):
            return _error_response(403, "Cloud API host is not allowed.")
        if not self._origin_allowed(request):
            return _error_response(403, "Cloud API origin is not allowed.")

        path = request.url.path.rstrip("/") or "/"
        if path in PUBLIC_PATHS:
            return await call_next(request)
        if path.startswith("/api") and not request_has_valid_cloud_token(request):
            if not cloud_tokens_configured():
                return _error_response(503, "云端 API 认证尚未配置。请设置 QIGOU_CLOUD_BEARER_TOKENS。")
            return _error_response(401, "云端访问凭据缺失或无效。")
        return await call_next(request)

    def _host_allowed(self, request: Request) -> bool:
        host_header = request.headers.get("host") or ""
        host = _hostname_from_host_header(host_header)
        return host in self.allowed_hosts

    def _origin_allowed(self, request: Request) -> bool:
        origin = request.headers.get("origin")
        if not origin:
            return True
        if origin in self.allowed_origins:
            return True
        parsed = urlparse(origin)
        hostname = (parsed.hostname or "").lower()
        return hostname in self.allowed_hosts and parsed.scheme in {"http", "https"}

    def _fetch_site_allowed(self, request: Request) -> bool:
        fetch_site = (request.headers.get("sec-fetch-site") or "").lower()
        if fetch_site not in {"cross-site"}:
            return True
        origin = request.headers.get("origin") or ""
        if request.url.path.startswith("/api/assets/") and request.url.path.endswith("/content"):
            return self._host_allowed(request) and request_has_valid_token(request)
        return bool(origin) and origin in self.allowed_origins and self._host_allowed(request)

    def _requires_token(self, request: Request) -> bool:
        path = request.url.path.rstrip("/") or "/"
        if path in PUBLIC_PATHS:
            return False
        return path.startswith("/api") or path.startswith("/ws")


def request_has_valid_token(request: Request) -> bool:
    expected = get_local_api_token()
    provided = (
        request.headers.get(LOCAL_TOKEN_HEADER)
        or request.cookies.get(LOCAL_TOKEN_COOKIE)
        or request.query_params.get(LOCAL_TOKEN_QUERY)
        or ""
    )
    return bool(provided) and hmac.compare_digest(provided, expected)


def cloud_tokens_configured() -> bool:
    return bool(_split_env("QIGOU_CLOUD_BEARER_TOKENS"))


def request_has_valid_cloud_token(request: Request) -> bool:
    authorization = request.headers.get("authorization") or ""
    scheme, _, provided = authorization.partition(" ")
    if scheme.lower() != "bearer" or not provided:
        return False
    return any(hmac.compare_digest(provided, expected) for expected in _split_env("QIGOU_CLOUD_BEARER_TOKENS"))


def websocket_is_allowed(websocket: WebSocket) -> bool:
    if current_api_profile() == API_PROFILE_CLOUD:
        return False
    host = _hostname_from_host_header(websocket.headers.get("host") or "")
    if host not in (ALLOWED_HOSTS | set(_split_env("QIGOU_ALLOWED_HOSTS"))):
        return False
    origin = websocket.headers.get("origin")
    allowed_origins = ALLOWED_ORIGINS | set(_split_env("QIGOU_ALLOWED_ORIGINS"))
    if origin and origin not in allowed_origins:
        parsed = urlparse(origin)
        if (parsed.hostname or "").lower() not in (ALLOWED_HOSTS | set(_split_env("QIGOU_ALLOWED_HOSTS"))):
            return False
    expected = get_local_api_token()
    cookie_token = websocket.cookies.get(LOCAL_TOKEN_COOKIE)
    query_token = websocket.query_params.get(LOCAL_TOKEN_QUERY)
    provided = cookie_token or query_token or ""
    return bool(provided) and hmac.compare_digest(provided, expected)


def _hostname_from_host_header(value: str) -> str:
    if value.startswith("["):
        end = value.find("]")
        return value[1:end].lower() if end > 0 else value.lower()
    return value.split(":", 1)[0].lower()


def _split_env(name: str) -> list[str]:
    return [item.strip() for item in os.getenv(name, "").split(",") if item.strip()]


def _token_path() -> Path:
    override = os.getenv("QIGOU_LOCAL_API_TOKEN_PATH")
    return Path(override) if override else LOCAL_TOKEN_PATH


def _error_response(status_code: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=status_code)
