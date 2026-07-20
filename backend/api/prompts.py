from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.core.database import get_db
from backend.schemas.prompts import PromptTemplateCreate, PromptTemplateUpdate
from backend.services import prompt_service


router = APIRouter(prefix="/api/prompts", tags=["prompts"])


@router.get("")
def list_prompts(db: Session = Depends(get_db)) -> list[dict]:
    return prompt_service.list_prompts(db)


@router.post("")
def create_prompt(payload: PromptTemplateCreate, db: Session = Depends(get_db)) -> dict:
    return prompt_service.create_prompt(db, payload.model_dump())


@router.patch("/{prompt_id}")
def update_prompt(prompt_id: int, payload: PromptTemplateUpdate, db: Session = Depends(get_db)) -> dict:
    prompt = prompt_service.update_prompt(db, prompt_id, payload.model_dump(exclude_unset=True))
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return prompt


@router.delete("/{prompt_id}")
def delete_prompt(prompt_id: int, db: Session = Depends(get_db)) -> dict:
    deleted = prompt_service.delete_prompt(db, prompt_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return {"deleted": True}


@router.post("/{prompt_id}/clone")
def clone_prompt(prompt_id: int, db: Session = Depends(get_db)) -> dict:
    prompt = prompt_service.clone_prompt(db, prompt_id)
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return prompt
