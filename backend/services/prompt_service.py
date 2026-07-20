import json
from typing import Any

from sqlalchemy.orm import Session

from backend.core.serializers import model_to_dict
from backend.db.models import PromptTemplate


PROMPT_UPDATE_FIELDS = (
    "name",
    "module",
    "scope",
    "system_prompt",
    "user_prompt",
    "negative_prompt",
    "variables_json",
    "is_builtin",
    "is_favorite",
    "version",
)


def list_prompts(db: Session) -> list[dict[str, Any]]:
    return [model_to_dict(prompt) for prompt in db.query(PromptTemplate).order_by(PromptTemplate.updated_at.desc()).all()]


def create_prompt(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    if isinstance(payload.get("variables_json"), list):
        payload["variables_json"] = json.dumps(payload["variables_json"], ensure_ascii=False)
    prompt = PromptTemplate(**payload)
    db.add(prompt)
    db.commit()
    db.refresh(prompt)
    return model_to_dict(prompt)


def update_prompt(db: Session, prompt_id: int, payload: dict[str, Any]) -> dict[str, Any] | None:
    prompt = db.get(PromptTemplate, prompt_id)
    if not prompt:
        return None
    if isinstance(payload.get("variables_json"), list):
        payload["variables_json"] = json.dumps(payload["variables_json"], ensure_ascii=False)
    for key in PROMPT_UPDATE_FIELDS:
        if key in payload:
            setattr(prompt, key, payload[key])
    db.commit()
    db.refresh(prompt)
    return model_to_dict(prompt)


def delete_prompt(db: Session, prompt_id: int) -> bool:
    prompt = db.get(PromptTemplate, prompt_id)
    if not prompt:
        return False
    db.delete(prompt)
    db.commit()
    return True


def clone_prompt(db: Session, prompt_id: int) -> dict[str, Any] | None:
    prompt = db.get(PromptTemplate, prompt_id)
    if not prompt:
        return None
    clone = PromptTemplate(
        name=f"{prompt.name} 副本",
        module=prompt.module,
        scope=prompt.scope,
        system_prompt=prompt.system_prompt,
        user_prompt=prompt.user_prompt,
        negative_prompt=prompt.negative_prompt,
        variables_json=prompt.variables_json,
        is_builtin=False,
        is_favorite=prompt.is_favorite,
        version=prompt.version + 1,
    )
    db.add(clone)
    db.commit()
    db.refresh(clone)
    return model_to_dict(clone)
