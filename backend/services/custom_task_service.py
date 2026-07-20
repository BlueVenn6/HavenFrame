import json
from typing import Any

from sqlalchemy.orm import Session

from backend.core.serializers import model_to_dict
from backend.db.models import CustomTaskTemplate


JSON_FIELDS = (
    "module_chain_json",
    "input_schema_json",
    "output_schema_json",
    "export_rules_json",
)


def create_template(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    template = CustomTaskTemplate(**_encode_json_fields(payload))
    db.add(template)
    db.commit()
    db.refresh(template)
    return model_to_dict(template)


def list_templates(db: Session) -> list[dict[str, Any]]:
    templates = db.query(CustomTaskTemplate).order_by(CustomTaskTemplate.updated_at.desc()).all()
    return [model_to_dict(item) for item in templates]


def get_template(db: Session, template_id: int) -> dict[str, Any] | None:
    template = db.get(CustomTaskTemplate, template_id)
    return model_to_dict(template) if template else None


def update_template(db: Session, template_id: int, payload: dict[str, Any]) -> dict[str, Any] | None:
    template = db.get(CustomTaskTemplate, template_id)
    if template is None:
        return None
    encoded = _encode_json_fields(payload)
    for key in (
        "name",
        "description",
        "module_chain_json",
        "input_schema_json",
        "output_schema_json",
        "default_provider",
        "default_model",
        "default_prompt_template_id",
        "export_rules_json",
        "is_team_visible",
        "version",
    ):
        if key in encoded:
            setattr(template, key, encoded[key])
    db.commit()
    db.refresh(template)
    return model_to_dict(template)


def delete_template(db: Session, template_id: int) -> bool:
    template = db.get(CustomTaskTemplate, template_id)
    if template is None:
        return False
    db.delete(template)
    db.commit()
    return True


def _encode_json_fields(payload: dict[str, Any]) -> dict[str, Any]:
    encoded = dict(payload)
    for field in JSON_FIELDS:
        if isinstance(encoded.get(field), (dict, list)):
            encoded[field] = json.dumps(encoded[field], ensure_ascii=False)
    return encoded
