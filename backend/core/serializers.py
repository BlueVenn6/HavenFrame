import json
from datetime import datetime
from decimal import Decimal
from typing import Any


def _normalize_value(key: str, value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if key.endswith("_json") and isinstance(value, str) and value:
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def model_to_dict(instance: Any) -> dict[str, Any]:
    return {
        column.name: _normalize_value(column.name, getattr(instance, column.name))
        for column in instance.__table__.columns
    }
