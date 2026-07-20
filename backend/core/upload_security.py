from __future__ import annotations

import os
import re
import uuid
from dataclasses import dataclass
from pathlib import Path

from backend.core.security_context import SecurityContextError, validate_workspace_path


ALLOWED_UPLOAD_MIME_TYPES = {
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/heic",
    "image/heif",
    "application/pdf",
}
ALLOWED_UPLOAD_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".pdf"}
DANGEROUS_EXTENSIONS = {
    ".app",
    ".bat",
    ".cmd",
    ".com",
    ".dll",
    ".dmg",
    ".exe",
    ".gadget",
    ".hta",
    ".jar",
    ".js",
    ".jse",
    ".lnk",
    ".msi",
    ".ps1",
    ".scr",
    ".sh",
    ".vbe",
    ".vbs",
    ".wsf",
    ".zip",
    ".rar",
    ".7z",
    ".gz",
    ".tar",
    ".tgz",
}
MIME_TO_EXTENSION = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "application/pdf": ".pdf",
}


@dataclass(frozen=True)
class UploadPolicy:
    max_file_bytes: int
    max_project_bytes: int
    max_files_per_request: int


def current_upload_policy() -> UploadPolicy:
    return UploadPolicy(
        max_file_bytes=_env_int("QIGOU_MAX_UPLOAD_BYTES", 25 * 1024 * 1024),
        max_project_bytes=_env_int("QIGOU_MAX_PROJECT_UPLOAD_BYTES", 500 * 1024 * 1024),
        max_files_per_request=_env_int("QIGOU_MAX_UPLOAD_FILES_PER_REQUEST", 1),
    )


def validate_upload_file_count(count: int) -> None:
    limit = current_upload_policy().max_files_per_request
    if count < 1:
        raise ValueError("必须上传至少 1 个文件。")
    if count > limit:
        raise ValueError(f"单次最多允许上传 {limit} 个文件。")


def validate_upload_file(*, file_name: str, mime_type: str | None, file_bytes: bytes) -> str:
    policy = current_upload_policy()
    if not file_bytes:
        raise ValueError("上传文件不能为空。")
    if len(file_bytes) > policy.max_file_bytes:
        raise ValueError(f"单文件大小超过上限 {policy.max_file_bytes} bytes。")

    clean_name = (file_name or "").strip()
    _reject_path_like_filename(clean_name)
    suffix = Path(clean_name).suffix.lower()
    normalized_mime = _normalize_mime(mime_type)
    if suffix in DANGEROUS_EXTENSIONS:
        raise ValueError("不允许上传可执行文件、脚本文件或压缩包。")
    if suffix not in ALLOWED_UPLOAD_EXTENSIONS:
        raise ValueError("文件扩展名不在上传白名单内。")
    if normalized_mime not in ALLOWED_UPLOAD_MIME_TYPES:
        raise ValueError("文件 MIME 类型不在上传白名单内。")
    if _looks_like_executable_or_archive(file_bytes):
        raise ValueError("文件内容疑似可执行文件或压缩包，已拒绝上传。")
    detected_mime = detect_upload_mime(file_bytes)
    if detected_mime is None:
        raise ValueError("文件内容签名与声明的 MIME 类型不匹配。")
    return generate_safe_upload_name(detected_mime)


def detect_upload_mime(file_bytes: bytes) -> str | None:
    for mime_type in ALLOWED_UPLOAD_MIME_TYPES:
        if _content_matches_mime(file_bytes, mime_type):
            return mime_type
    return None


def mime_type_for_safe_upload_name(file_name: str) -> str:
    suffix = Path(file_name).suffix.lower()
    for mime_type, extension in MIME_TO_EXTENSION.items():
        if suffix == extension:
            return mime_type
    raise ValueError("安全文件名没有对应的 MIME 类型。")


def ensure_project_capacity(*, current_project_bytes: int, incoming_bytes: int) -> None:
    limit = current_upload_policy().max_project_bytes
    if current_project_bytes + incoming_bytes > limit:
        raise ValueError(f"项目上传容量超过上限 {limit} bytes。")


def generate_safe_upload_name(mime_type: str) -> str:
    suffix = MIME_TO_EXTENSION.get(_normalize_mime(mime_type))
    if not suffix:
        raise ValueError("文件 MIME 类型不在上传白名单内。")
    return f"upload-{uuid.uuid4().hex}{suffix}"


def ensure_upload_target_path(path: Path, *, allowed_root: Path) -> Path:
    try:
        return validate_workspace_path(str(path), allowed_roots=[allowed_root])
    except SecurityContextError as exc:
        raise ValueError(exc.reason) from exc


def _normalize_mime(mime_type: str | None) -> str:
    return str(mime_type or "").split(";", 1)[0].strip().lower()


def _reject_path_like_filename(file_name: str) -> None:
    if not file_name:
        raise ValueError("文件名不能为空。")
    if "/" in file_name or "\\" in file_name:
        raise ValueError("文件名不能包含路径。")
    if ".." in Path(file_name).parts:
        raise ValueError("文件名不能包含路径穿越片段。")
    if re.search(r"[\x00-\x1f]", file_name):
        raise ValueError("文件名包含非法控制字符。")


def _looks_like_executable_or_archive(file_bytes: bytes) -> bool:
    signatures = (
        b"MZ",
        b"PK\x03\x04",
        b"PK\x05\x06",
        b"PK\x07\x08",
        b"7z\xbc\xaf\x27\x1c",
        b"Rar!\x1a\x07\x00",
        b"\x1f\x8b",
    )
    return any(file_bytes.startswith(signature) for signature in signatures)


def _content_matches_mime(file_bytes: bytes, mime_type: str) -> bool:
    if mime_type == "image/png":
        return file_bytes.startswith(b"\x89PNG\r\n\x1a\n")
    if mime_type == "image/jpeg":
        return file_bytes.startswith(b"\xff\xd8\xff")
    if mime_type == "image/webp":
        return len(file_bytes) >= 12 and file_bytes.startswith(b"RIFF") and file_bytes[8:12] == b"WEBP"
    if mime_type == "application/pdf":
        return file_bytes.startswith(b"%PDF-")
    if mime_type in {"image/heic", "image/heif"}:
        return len(file_bytes) >= 12 and file_bytes[4:8] == b"ftyp" and file_bytes[8:12] in {
            b"heic",
            b"heix",
            b"hevc",
            b"hevx",
            b"mif1",
            b"msf1",
        }
    return False


def _env_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, ""))
    except ValueError:
        return default
    return value if value > 0 else default
