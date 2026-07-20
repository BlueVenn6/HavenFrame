from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.core.database import get_db
from backend.core.redaction import redact_text
from backend.core.platform_capabilities import current_platform_capabilities
from backend.core.upload_security import mime_type_for_safe_upload_name, validate_upload_file, validate_upload_file_count
from backend.services import asset_service


router = APIRouter(prefix="/api/assets", tags=["assets"])


@router.post("/upload")
async def upload_asset(
    project_id: int = Form(...),
    asset_type: str = Form(...),
    file: UploadFile = File(...),
    room_type: str | None = Form(default=None),
    source: str | None = Form(default="upload"),
    db: Session = Depends(get_db),
) -> dict:
    try:
        validate_upload_file_count(1)
        file_bytes = await file.read()
        safe_name = validate_upload_file(file_name=file.filename or "upload.bin", mime_type=file.content_type, file_bytes=file_bytes)
        detected_mime = mime_type_for_safe_upload_name(safe_name)
        return asset_service.create_uploaded_asset(
            db,
            project_id=project_id,
            file_name=safe_name,
            file_bytes=file_bytes,
            asset_type=asset_type,
            mime_type=detected_mime,
            room_type=room_type,
            source=source,
            metadata={"upload_kind": "binary"},
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=redact_text(str(exc))) from exc


@router.get("")
def list_assets(project_id: int | None = None, db: Session = Depends(get_db)) -> list[dict]:
    return asset_service.list_assets(db, project_id)


@router.get("/{asset_id}")
def get_asset(asset_id: int, db: Session = Depends(get_db)) -> dict:
    asset = asset_service.get_asset(db, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset


@router.get("/{asset_id}/content")
def get_asset_content(asset_id: int, db: Session = Depends(get_db)) -> FileResponse:
    resolved = asset_service.get_asset_path(db, asset_id)
    if resolved is None:
        raise HTTPException(status_code=404, detail="Asset content not found")

    file_path, media_type = resolved
    return FileResponse(
        path=file_path,
        media_type=media_type,
        filename=file_path.name,
        content_disposition_type="inline",
    )


if current_platform_capabilities().local_file_open:
    @router.post("/{asset_id}/open-folder")
    def open_asset_folder(asset_id: int, db: Session = Depends(get_db)) -> dict:
        opened = asset_service.open_asset_folder(db, asset_id)
        if opened is None:
            raise HTTPException(status_code=404, detail="Asset content not found")
        return opened


    @router.post("/{asset_id}/open-file")
    def open_asset_file(asset_id: int, db: Session = Depends(get_db)) -> dict:
        opened = asset_service.open_asset_file(db, asset_id)
        if opened is None:
            raise HTTPException(status_code=404, detail="Asset content not found")
        return opened


@router.delete("/{asset_id}")
def delete_asset(asset_id: int, db: Session = Depends(get_db)) -> dict:
    deleted = asset_service.delete_asset(db, asset_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"deleted": True}


@router.post("/{asset_id}/duplicate")
def duplicate_asset(asset_id: int, db: Session = Depends(get_db)) -> dict:
    asset = asset_service.duplicate_asset(db, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset
