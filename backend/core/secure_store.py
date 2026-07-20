from __future__ import annotations

import base64
import ctypes
import json
import os
import secrets
from ctypes import wintypes
from pathlib import Path

from backend.core.config import DATA_DIR


SECRET_REF_PREFIX = "dpapi://model-api-key/"
SECRET_STORE_PATH = DATA_DIR / "secrets" / "model-api-keys.json"


def is_secret_reference(value: str | None) -> bool:
    return bool(value and (value.startswith(SECRET_REF_PREFIX) or value.startswith("env://")))


def store_model_api_key(secret: str, existing_ref: str | None = None) -> str:
    secret = (secret or "").strip()
    if not secret:
        raise ValueError("API Key 不能为空。")
    if secret.startswith("env://"):
        return secret
    if os.name != "nt":
        raise RuntimeError("当前平台暂不支持本机安全存储。请使用环境变量引用，例如 env://OPENAI_API_KEY。")
    secret_id = _secret_id(existing_ref) or secrets.token_urlsafe(18)
    store = _read_store()
    store[secret_id] = _dpapi_protect(secret.encode("utf-8"))
    _write_store(store)
    return f"{SECRET_REF_PREFIX}{secret_id}"


def resolve_model_api_key(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    if value.startswith("env://"):
        return os.getenv(value.removeprefix("env://")) or None
    if not value.startswith(SECRET_REF_PREFIX):
        return value
    if os.name != "nt":
        return None
    secret_id = _secret_id(value)
    if not secret_id:
        return None
    encrypted = _read_store().get(secret_id)
    if not encrypted:
        return None
    return _dpapi_unprotect(encrypted).decode("utf-8")


def clear_model_api_key(value: str | None) -> None:
    secret_id = _secret_id(value)
    if not secret_id:
        return
    store = _read_store()
    if secret_id in store:
        store.pop(secret_id, None)
        _write_store(store)


def migrate_plain_api_key(value: str | None) -> str | None:
    if not value:
        return value
    if is_secret_reference(value):
        return value
    return store_model_api_key(value)


def import_legacy_model_api_key(value: str | None, legacy_store_path: Path) -> str | None:
    """Re-store a legacy key under the current app data directory.

    DPAPI protects the value for the Windows user, so a sibling application can
    decrypt it on the same account without copying the old secret-store file.
    """
    if not value:
        return None
    value = value.strip()
    if value.startswith("env://"):
        return value
    if not value.startswith(SECRET_REF_PREFIX):
        return store_model_api_key(value)
    if os.name != "nt" or not legacy_store_path.is_file():
        return None
    secret_id = _secret_id(value)
    if not secret_id:
        return None
    try:
        payload = json.loads(legacy_store_path.read_text(encoding="utf-8"))
        encrypted = payload.get(secret_id) if isinstance(payload, dict) else None
        if not isinstance(encrypted, str) or not encrypted:
            return None
        return store_model_api_key(_dpapi_unprotect(encrypted).decode("utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError, ValueError):
        return None


def _secret_id(value: str | None) -> str | None:
    if not value or not value.startswith(SECRET_REF_PREFIX):
        return None
    secret_id = value.removeprefix(SECRET_REF_PREFIX).strip()
    return secret_id or None


def _read_store() -> dict[str, str]:
    if not SECRET_STORE_PATH.exists():
        return {}
    try:
        payload = json.loads(SECRET_STORE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _write_store(payload: dict[str, str]) -> None:
    SECRET_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    SECRET_STORE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        SECRET_STORE_PATH.chmod(0o600)
    except OSError:
        pass


class _DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _blob_from_bytes(data: bytes) -> _DataBlob:
    buffer = ctypes.create_string_buffer(data)
    blob = _DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))
    blob._buffer = buffer  # type: ignore[attr-defined]
    return blob


def _bytes_from_blob(blob: _DataBlob) -> bytes:
    if not blob.pbData:
        return b""
    return ctypes.string_at(blob.pbData, blob.cbData)


def _dpapi_protect(data: bytes) -> str:
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    in_blob = _blob_from_bytes(data)
    out_blob = _DataBlob()
    if not crypt32.CryptProtectData(ctypes.byref(in_blob), None, None, None, None, 0, ctypes.byref(out_blob)):
        raise ctypes.WinError()
    try:
        return base64.b64encode(_bytes_from_blob(out_blob)).decode("ascii")
    finally:
        kernel32.LocalFree(out_blob.pbData)


def _dpapi_unprotect(encoded: str) -> bytes:
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    encrypted = base64.b64decode(encoded.encode("ascii"))
    in_blob = _blob_from_bytes(encrypted)
    out_blob = _DataBlob()
    if not crypt32.CryptUnprotectData(ctypes.byref(in_blob), None, None, None, None, 0, ctypes.byref(out_blob)):
        raise ctypes.WinError()
    try:
        return _bytes_from_blob(out_blob)
    finally:
        kernel32.LocalFree(out_blob.pbData)
