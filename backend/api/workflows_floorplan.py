from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.core.database import get_db
from backend.services import floorplan_service


router = APIRouter(prefix="/api/workflows/floorplan", tags=["floorplan"])


@router.get("/config")
def get_floorplan_config(db: Session = Depends(get_db)) -> dict:
    return floorplan_service.get_floorplan_config(db)
