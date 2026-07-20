from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.core.database import get_db
from backend.services import space_render_service


router = APIRouter(prefix="/api/workflows/space-render", tags=["space-render"])


@router.get("/config")
def get_space_render_config(db: Session = Depends(get_db)) -> dict:
    return space_render_service.get_space_render_config(db)
