from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.core.database import get_db
from backend.schemas.review import ProjectVersionCreate
from backend.services import review_service


router = APIRouter(tags=["review"])


@router.get("/api/projects/{project_id}/review")
def get_project_review(project_id: int, db: Session = Depends(get_db)) -> dict:
    review = review_service.get_project_review(db, project_id)
    if review is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return review


@router.get("/api/projects/{project_id}/versions")
def list_versions(project_id: int, db: Session = Depends(get_db)) -> list[dict]:
    return review_service.list_versions(db, project_id)


@router.post("/api/projects/{project_id}/versions")
def create_version(project_id: int, payload: ProjectVersionCreate, db: Session = Depends(get_db)) -> dict:
    return review_service.create_version(db, project_id, payload.model_dump())


@router.get("/api/projects/{project_id}/replay/{task_id}")
def get_replay(project_id: int, task_id: int, db: Session = Depends(get_db)) -> dict:
    replay = review_service.get_replay(db, project_id, task_id)
    if replay is None:
        raise HTTPException(status_code=404, detail="Replay target not found")
    return replay
