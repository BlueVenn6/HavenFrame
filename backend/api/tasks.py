from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.core.database import get_db
from backend.core.redaction import redact_text
from backend.schemas.tasks import ProviderImageTaskRequest
from backend.services import task_service


router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("")
def list_tasks(project_id: int | None = None, db: Session = Depends(get_db)) -> list[dict]:
    return task_service.list_tasks(db, project_id)


@router.post("/provider-image")
def queue_provider_image_task(payload: ProviderImageTaskRequest, db: Session = Depends(get_db)) -> dict:
    try:
        return task_service.queue_provider_image_task(db, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=redact_text(str(exc))) from exc


@router.get("/{task_id}")
def get_task(task_id: int, db: Session = Depends(get_db)) -> dict:
    task = task_service.get_task(db, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("/{task_id}/cancel")
def cancel_task(task_id: int, db: Session = Depends(get_db)) -> dict:
    task = task_service.cancel_task(db, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("/{task_id}/retry")
def retry_task(task_id: int, db: Session = Depends(get_db)) -> dict:
    try:
        task = task_service.retry_task(db, task_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=redact_text(str(exc))) from exc
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.get("/{task_id}/result")
def get_result(task_id: int, db: Session = Depends(get_db)) -> dict:
    result = task_service.get_task_result(db, task_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return result
