from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.core.database import get_db
from backend.schemas.custom_tasks import CustomTaskTemplateCreateRequest, CustomTaskTemplateUpdateRequest
from backend.services import custom_task_service


router = APIRouter(prefix="/api/custom-tasks", tags=["custom-tasks"])


@router.post("/templates")
def create_template(payload: CustomTaskTemplateCreateRequest, db: Session = Depends(get_db)) -> dict:
    return custom_task_service.create_template(db, payload.model_dump())


@router.get("/templates")
def list_templates(db: Session = Depends(get_db)) -> list[dict]:
    return custom_task_service.list_templates(db)


@router.get("/templates/{template_id}")
def get_template(template_id: int, db: Session = Depends(get_db)) -> dict:
    template = custom_task_service.get_template(db, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.patch("/templates/{template_id}")
def update_template(template_id: int, payload: CustomTaskTemplateUpdateRequest, db: Session = Depends(get_db)) -> dict:
    template = custom_task_service.update_template(db, template_id, payload.model_dump(exclude_unset=True))
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.delete("/templates/{template_id}")
def delete_template(template_id: int, db: Session = Depends(get_db)) -> dict:
    deleted = custom_task_service.delete_template(db, template_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"deleted": True}
