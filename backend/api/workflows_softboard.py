from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.core.redaction import redact_text
from backend.core.database import get_db
from backend.schemas.boards import (
    ExtractItemsRequest,
    ExtractedItemUpdateRequest,
    MultiRoomBoardRequest,
    QuoteGenerationRequest,
    SingleRoomBoardRequest,
)
from backend.services import board_service


router = APIRouter(prefix="/api/workflows/softboard", tags=["softboard"])


@router.post("/single-room")
def generate_single_room_board(payload: SingleRoomBoardRequest, db: Session = Depends(get_db)) -> dict:
    try:
        return board_service.generate_single_room_board(db, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=redact_text(str(exc))) from exc


@router.post("/extract-items")
def extract_items(payload: ExtractItemsRequest, db: Session = Depends(get_db)) -> dict:
    try:
        return board_service.extract_single_room_items(db, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=redact_text(str(exc))) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=redact_text(str(exc))) from exc


@router.get("/extracted-items")
def list_extracted_items(
    project_id: int | None = None,
    asset_id: int | None = None,
    db: Session = Depends(get_db),
) -> list[dict]:
    return board_service.list_extracted_items(db, project_id=project_id, asset_id=asset_id)


@router.patch("/extracted-items/{item_id}")
def update_extracted_item(
    item_id: int,
    payload: ExtractedItemUpdateRequest,
    db: Session = Depends(get_db),
) -> dict:
    try:
        item = board_service.update_extracted_item(db, item_id, payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=redact_text(str(exc))) from exc
    if item is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Extracted item not found")
    return item


@router.post("/generate-quote")
def generate_quote(payload: QuoteGenerationRequest, db: Session = Depends(get_db)) -> dict:
    try:
        return board_service.generate_quote_card(db, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=redact_text(str(exc))) from exc


@router.post("/multi-room")
def generate_multi_room_board(payload: MultiRoomBoardRequest, db: Session = Depends(get_db)) -> dict:
    try:
        return board_service.generate_multi_room_board(db, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=redact_text(str(exc))) from exc


@router.get("/documents")
def list_board_documents(project_id: int | None = None, db: Session = Depends(get_db)) -> list[dict]:
    return board_service.list_board_documents(db, project_id)
