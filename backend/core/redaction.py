from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlsplit, urlunsplit

from backend.core.config import DATA_DIR, WORKSPACE_DIR


REDACTED = "[REDACTED]"
SENSITIVE_QUERY_KEYS = {"key", "api_key", "apikey", "token", "access_token", "authorization", "auth", "secret"}


def redact_secrets(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, dict):
        return {str(key): _redact_mapping_value(str(key), item) for key, item in value.items()}
    if isinstance(value, list):
        return [redact_secrets(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_secrets(item) for item in value)
    if isinstance(value, Path):
        return _redact_paths(str(value))
    if isinstance(value, BaseException):
        return redact_text(str(value))
    if isinstance(value, str):
        return redact_text(value)
    return value


def redact_text(value: str | None) -> str | None:
    if value is None:
        return None
    redacted = str(value)
    redacted = _redact_urls(redacted)
    redacted = _redact_authorization(redacted)
    redacted = _redact_key_value_pairs(redacted)
    redacted = _redact_paths(redacted)
    return redacted


def redact_url(value: str | None) -> str | None:
    if not value:
        return value
    try:
        parts = urlsplit(value)
    except ValueError:
        return redact_text(value)
    if not parts.scheme or not parts.netloc:
        return redact_text(value)
    query = "&".join(
        f"{key}={REDACTED if key.lower() in SENSITIVE_QUERY_KEYS else query_value}"
        for key, query_value in parse_qsl(parts.query, keep_blank_values=True)
    )
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, ""))


def _redact_mapping_value(key: str, value: Any) -> Any:
    lowered = key.lower()
    if any(marker in lowered for marker in ("api_key", "apikey", "authorization", "token", "access_token", "secret", "password")):
        return REDACTED if value not in (None, "") else value
    return redact_secrets(value)


def _redact_urls(value: str) -> str:
    def replace(match: re.Match[str]) -> str:
        return redact_url(match.group(0)) or REDACTED

    return re.sub(r"https?://[^\s\"'<>]+", replace, value)


def _redact_authorization(value: str) -> str:
    redacted = re.sub(
        r"(?i)(authorization\s*[:=]\s*)(bearer\s+)?[A-Za-z0-9._~+/=-]{8,}",
        lambda match: f"{match.group(1)}{match.group(2) or ''}{REDACTED}",
        value,
    )
    return re.sub(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]{8,}", rf"\1{REDACTED}", redacted)


def _redact_key_value_pairs(value: str) -> str:
    pattern = r"(?i)\b(api[_-]?key|access[_-]?token|token|secret|password)\b(\s*[:=]\s*)([^\s,;\"']+)"
    return re.sub(pattern, lambda match: f"{match.group(1)}{match.group(2)}{REDACTED}", value)


def _redact_paths(value: str) -> str:
    redacted = value
    roots = [WORKSPACE_DIR, DATA_DIR]
    for root in roots:
        try:
            resolved = str(root.resolve())
        except OSError:
            resolved = str(root)
        if resolved:
            redacted = redacted.replace(resolved, f"<{root.name}>")
            redacted = redacted.replace(resolved.replace("\\", "/"), f"<{root.name}>")
    redacted = re.sub(r"(?i)C:\\Users\\[^\\\s]+", lambda _: r"C:\Users\<user>", redacted)
    redacted = re.sub(r"(?i)/Users/[^/\s]+", "/Users/<user>", redacted)
    return redacted


def redact_json_dumps(value: Any) -> str:
    return json.dumps(redact_secrets(value), ensure_ascii=False)
