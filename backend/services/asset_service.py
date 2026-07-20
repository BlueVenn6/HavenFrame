import json
import mimetypes
import os
import shutil
import subprocess
import struct
import sys
from pathlib import Path
from time import time
from typing import Any

from sqlalchemy.orm import Session

from backend.core.config import OUTPUTS_DIR, PROJECTS_DIR, WORKSPACE_DIR
from backend.core.image_security import validate_generated_image_payload
from backend.core.platform_capabilities import current_platform_capabilities
from backend.core.security_context import SecurityContextError, validate_workspace_path
from backend.core.serializers import model_to_dict
from backend.core.upload_security import ensure_project_capacity, ensure_upload_target_path, validate_upload_file
from backend.db.models import Asset, ExtractedItem, Project


def list_assets(db: Session, project_id: int | None = None) -> list[dict[str, Any]]:
    query = db.query(Asset)
    if project_id is not None:
        query = query.filter(Asset.project_id == project_id)
    return [serialize_asset(asset) for asset in query.order_by(Asset.created_at.desc()).all()]


def create_asset(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    if isinstance(payload.get("metadata_json"), dict):
        payload["metadata_json"] = json.dumps(payload["metadata_json"], ensure_ascii=False)
    asset = Asset(**payload)
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return serialize_asset(asset)


def get_asset(db: Session, asset_id: int) -> dict[str, Any] | None:
    asset = db.get(Asset, asset_id)
    return serialize_asset(asset) if asset else None


def get_asset_path(db: Session, asset_id: int) -> tuple[Path, str | None] | None:
    asset = db.get(Asset, asset_id)
    if asset is None:
        return None

    file_path = _resolve_asset_record_path(asset)
    if file_path is None:
        return None

    if str(file_path) != asset.file_path:
        asset.file_path = str(file_path)
        db.commit()

    media_type = asset.mime_type or mimetypes.guess_type(file_path.name)[0]
    return file_path, media_type


def open_asset_folder(db: Session, asset_id: int) -> dict[str, Any] | None:
    resolved = get_asset_path(db, asset_id)
    if resolved is None:
        return None
    file_path, _ = resolved
    folder = file_path.parent
    folder.mkdir(parents=True, exist_ok=True)
    _open_folder(folder)
    return {"opened": True, "path": str(folder)}


def open_asset_file(db: Session, asset_id: int) -> dict[str, Any] | None:
    resolved = get_asset_path(db, asset_id)
    if resolved is None:
        return None
    file_path, _ = resolved
    _open_path(file_path)
    return {"opened": True, "path": str(file_path)}


def delete_asset(db: Session, asset_id: int) -> bool:
    asset = db.get(Asset, asset_id)
    if not asset:
        return False
    db.query(ExtractedItem).filter(ExtractedItem.asset_id == asset_id).delete(synchronize_session=False)
    db.delete(asset)
    db.commit()
    return True


def duplicate_asset(db: Session, asset_id: int) -> dict[str, Any] | None:
    asset = db.get(Asset, asset_id)
    if not asset:
        return None
    clone = Asset(
        project_id=asset.project_id,
        type=asset.type,
        file_name=f"copy-{asset.file_name}",
        file_path=asset.file_path,
        mime_type=asset.mime_type,
        width=asset.width,
        height=asset.height,
        source=asset.source,
        room_type=asset.room_type,
        version_no=(asset.version_no or 1) + 1,
        parent_asset_id=asset.id,
        metadata_json=asset.metadata_json,
    )
    db.add(clone)
    db.commit()
    db.refresh(clone)
    return serialize_asset(clone)


def create_uploaded_asset(
    db: Session,
    *,
    project_id: int,
    file_name: str,
    file_bytes: bytes,
    asset_type: str,
    mime_type: str | None = None,
    room_type: str | None = None,
    source: str | None = "upload",
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    safe_name = validate_upload_file(file_name=file_name, mime_type=mime_type, file_bytes=file_bytes)
    project = db.get(Project, project_id)
    if project is None:
        raise ValueError("上传素材所属项目不存在。")
    project_root = Path(project.archive_root_path)
    try:
        project_root = validate_workspace_path(str(project_root), allowed_roots=[PROJECTS_DIR])
    except SecurityContextError as exc:
        raise ValueError(exc.reason) from exc

    asset_dir = project_root / "assets"
    asset_dir.mkdir(parents=True, exist_ok=True)
    ensure_project_capacity(current_project_bytes=_project_upload_bytes(project_root), incoming_bytes=len(file_bytes))

    target_path = asset_dir / safe_name
    stem = target_path.stem
    suffix = target_path.suffix
    index = 1
    while target_path.exists():
        target_path = asset_dir / f"{stem}-{index}{suffix}"
        index += 1

    target_path = ensure_upload_target_path(target_path, allowed_root=PROJECTS_DIR)
    target_path.write_bytes(file_bytes)

    asset = Asset(
        project_id=project_id,
        type=asset_type,
        file_name=target_path.name,
        file_path=str(target_path),
        mime_type=mime_type,
        source=source,
        room_type=room_type,
        metadata_json=json.dumps(
            {**(metadata or {}), "storage_key": workspace_storage_key(target_path)},
            ensure_ascii=False,
        ),
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return serialize_asset(asset)


def _project_upload_bytes(project_root: Path) -> int:
    asset_dir = project_root / "assets"
    if not asset_dir.exists():
        return 0
    total = 0
    for path in asset_dir.rglob("*"):
        if not path.is_file():
            continue
        try:
            total += path.stat().st_size
        except OSError:
            continue
    return total


def create_generated_output_asset(
    db: Session,
    *,
    project_id: int | None,
    module: str,
    file_bytes: bytes,
    mime_type: str,
    provider: str,
    model_name: str,
    source_asset_ids: list[int] | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not file_bytes:
        raise ValueError("Generated provider output was empty; no asset was saved.")
    mime_type = validate_generated_image_payload(file_bytes, mime_type)
    project_part = f"project-{project_id or 'unassigned'}"
    output_dir = OUTPUTS_DIR / project_part
    output_dir.mkdir(parents=True, exist_ok=True)

    timestamp = int(time() * 1000)
    safe_module = "".join(char if char.isalnum() or char in {"-", "_"} else "-" for char in module)
    extension = mimetypes.guess_extension(mime_type.split(";")[0]) or ".png"
    file_name = f"{safe_module}-provider-result-{timestamp}{extension}"
    file_path = output_dir / file_name
    file_path.write_bytes(file_bytes)
    width, height = _detect_image_dimensions(file_bytes, mime_type)

    output_type = "render_output"
    if "board" in module:
        output_type = "board_output"
    elif "floorplan" in module:
        output_type = "floorplan"

    asset = Asset(
        project_id=project_id,
        type=output_type,
        file_name=file_name,
        file_path=str(file_path),
        mime_type=mime_type,
        width=width,
        height=height,
        source="provider_generation",
        metadata_json=json.dumps(
            {
                "module": module,
                "provider": provider,
                "model_name": model_name,
                "actual_size": f"{width}x{height}" if width and height else None,
                "source_asset_ids": source_asset_ids or [],
                **(metadata or {}),
                "storage_key": workspace_storage_key(file_path),
            },
            ensure_ascii=False,
        ),
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return serialize_asset(asset)


def serialize_asset(asset: Asset) -> dict[str, Any]:
    data = model_to_dict(asset)
    content_path = f"/api/assets/{asset.id}/content"
    data["content_path"] = content_path
    if not current_platform_capabilities().local_file_open:
        data["file_path"] = content_path
    return data


def workspace_storage_key(path: Path) -> str:
    try:
        return path.resolve().relative_to(WORKSPACE_DIR.resolve()).as_posix()
    except (OSError, ValueError) as exc:
        raise ValueError("资产文件不在受控 workspace 中。") from exc


def _resolve_asset_record_path(asset: Asset) -> Path | None:
    candidates: list[Path] = []
    stored_path = Path(str(asset.file_path or ""))
    if str(stored_path):
        candidates.append(stored_path if stored_path.is_absolute() else WORKSPACE_DIR / stored_path)

    metadata = _asset_metadata(asset.metadata_json)
    storage_key = str(metadata.get("storage_key") or "").strip()
    if storage_key:
        candidates.append(WORKSPACE_DIR / Path(storage_key))
    elif stored_path.is_absolute():
        lowered_parts = [part.lower() for part in stored_path.parts]
        for root_name in ("projects", "outputs"):
            if root_name in lowered_parts:
                root_index = lowered_parts.index(root_name)
                candidates.append(WORKSPACE_DIR.joinpath(*stored_path.parts[root_index:]))
                break

    for candidate in candidates:
        try:
            resolved = validate_workspace_path(str(candidate))
        except SecurityContextError:
            continue
        if resolved.exists() and resolved.is_file():
            return resolved
    return None


def _asset_metadata(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _open_folder(folder: Path) -> None:
    _open_path(folder)


def _open_path(path: Path) -> None:
    if os.name == "nt":
        os.startfile(str(path))  # type: ignore[attr-defined]
        return
    if sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
        return
    if shutil_path := shutil.which("xdg-open"):
        subprocess.Popen([shutil_path, str(path)])
        return
    raise RuntimeError("当前系统没有可用的打开路径命令。")


def _detect_image_dimensions(file_bytes: bytes, mime_type: str | None) -> tuple[int | None, int | None]:
    if len(file_bytes) >= 24 and file_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        width, height = struct.unpack(">II", file_bytes[16:24])
        return int(width), int(height)

    if len(file_bytes) >= 10 and file_bytes[:3] == b"\xff\xd8\xff":
        index = 2
        while index + 9 < len(file_bytes):
            if file_bytes[index] != 0xFF:
                index += 1
                continue
            marker = file_bytes[index + 1]
            index += 2
            if marker in {0xD8, 0xD9}:
                continue
            if index + 2 > len(file_bytes):
                break
            segment_length = int.from_bytes(file_bytes[index : index + 2], "big")
            if segment_length < 2 or index + segment_length > len(file_bytes):
                break
            if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
                height = int.from_bytes(file_bytes[index + 3 : index + 5], "big")
                width = int.from_bytes(file_bytes[index + 5 : index + 7], "big")
                return width, height
            index += segment_length

    if mime_type and mime_type.startswith("image/"):
        return None, None
    return None, None
