from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.core.database import get_db
from backend.core.redaction import redact_text
from backend.core.platform_capabilities import current_platform_capabilities
from backend.schemas.exports import ExportImageRequest, ExportReportImageRequest, ExportTableRequest
from backend.services import export_service


router = APIRouter(prefix="/api/exports", tags=["exports"])


@router.post("/image")
def export_image(payload: ExportImageRequest, db: Session = Depends(get_db)) -> dict:
    try:
        return export_service.export_image_file(db, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=redact_text(str(exc))) from exc


@router.post("/report-image")
def export_report_image(payload: ExportReportImageRequest, db: Session = Depends(get_db)) -> dict:
    try:
        return export_service.export_report_image(db, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=redact_text(str(exc))) from exc


@router.post("/table")
def export_table(payload: ExportTableRequest, db: Session = Depends(get_db)) -> dict:
    try:
        return export_service.export_extracted_items_table(db, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=redact_text(str(exc))) from exc


@router.get("")
def list_exports(project_id: int | None = None, db: Session = Depends(get_db)) -> list[dict]:
    return export_service.list_exports(db, project_id)


@router.get("/{export_id}/content")
def get_export_content(export_id: int, db: Session = Depends(get_db)) -> FileResponse:
    resolved = export_service.get_export_path(db, export_id)
    if resolved is None:
        raise HTTPException(status_code=404, detail="Export file not found")
    file_path, media_type = resolved
    return FileResponse(file_path, media_type=media_type, filename=file_path.name, content_disposition_type="inline")


if current_platform_capabilities().local_file_open:
    @router.post("/{export_id}/open-file")
    def open_export_file(export_id: int, db: Session = Depends(get_db)) -> dict:
        opened = export_service.open_export_file(db, export_id)
        if opened is None:
            raise HTTPException(status_code=404, detail="Export file not found")
        return opened


    @router.post("/{export_id}/open-folder")
    def open_export_folder(export_id: int, db: Session = Depends(get_db)) -> dict:
        opened = export_service.open_export_folder(db, export_id)
        if opened is None:
            raise HTTPException(status_code=404, detail="Export file not found")
        return opened
