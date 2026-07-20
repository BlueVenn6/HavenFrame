from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.core.database import get_db
from backend.core.redaction import redact_text
from backend.core.platform_capabilities import current_platform_capabilities
from backend.schemas.projects import ProjectCreateRequest, ProjectUpdateRequest
from backend.services import project_service


router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.post("")
def create_project(payload: ProjectCreateRequest, db: Session = Depends(get_db)) -> dict:
    try:
        return project_service.create_project(db, payload.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=redact_text(str(exc))) from exc


@router.get("")
def list_projects(db: Session = Depends(get_db)) -> list[dict]:
    return project_service.list_projects(db)


@router.get("/{project_id}")
def get_project(project_id: int, db: Session = Depends(get_db)) -> dict:
    project = project_service.get_project(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


if current_platform_capabilities().local_file_open:
    @router.post("/{project_id}/open-folder")
    def open_project_folder(project_id: int, db: Session = Depends(get_db)) -> dict:
        opened = project_service.open_project_folder(db, project_id)
        if opened is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return opened


@router.patch("/{project_id}")
def update_project(project_id: int, payload: ProjectUpdateRequest, db: Session = Depends(get_db)) -> dict:
    try:
        project = project_service.update_project(db, project_id, payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=redact_text(str(exc))) from exc
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.delete("/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db)) -> dict:
    deleted = project_service.delete_project(db, project_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"deleted": True}
