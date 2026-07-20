from __future__ import annotations

import os


ALLOWED_GENERATED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}


def validate_generated_image_payload(file_bytes: bytes, mime_type: str | None) -> str:
    normalized_mime = str(mime_type or "image/png").split(";", 1)[0].strip().lower()
    if normalized_mime not in ALLOWED_GENERATED_IMAGE_TYPES:
        raise ValueError(f"Provider 返回了不支持的图片 MIME：{normalized_mime or 'unknown'}。")
    limit = int(os.getenv("QIGOU_MAX_GENERATED_IMAGE_BYTES", str(50 * 1024 * 1024)))
    if not file_bytes:
        raise ValueError("Provider 返回的图片文件为空。")
    if len(file_bytes) > limit:
        raise ValueError("Provider 返回的图片超过允许的文件大小。")
    if normalized_mime == "image/png" and not file_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Provider 返回的 PNG 文件签名无效。")
    if normalized_mime == "image/jpeg" and not file_bytes.startswith(b"\xff\xd8\xff"):
        raise ValueError("Provider 返回的 JPEG 文件签名无效。")
    if normalized_mime == "image/webp" and not (
        len(file_bytes) >= 12 and file_bytes.startswith(b"RIFF") and file_bytes[8:12] == b"WEBP"
    ):
        raise ValueError("Provider 返回的 WebP 文件签名无效。")
    return normalized_mime
