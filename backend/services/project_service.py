import os
import re
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from backend.core.config import WORKSPACE_DIR
from backend.core.platform_capabilities import current_platform_capabilities
from backend.core.security_context import SecurityContextError, validate_workspace_path
from backend.core.serializers import model_to_dict
from backend.db.models import Project


def list_projects(db: Session) -> list[dict[str, Any]]:
    return [serialize_project(project) for project in db.query(Project).order_by(Project.updated_at.desc()).all()]


def create_project(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    archive_root_path = payload.get("archive_root_path") or str(WORKSPACE_DIR / "projects" / _project_folder_name(payload["name"]))
    archive_path = _resolve_workspace_path(archive_root_path)
    archive_path.mkdir(parents=True, exist_ok=True)
    project = Project(
        name=payload["name"],
        client_name=payload.get("client_name"),
        style_tags=payload.get("style_tags"),
        room_types=payload.get("room_types"),
        budget_min=payload.get("budget_min"),
        budget_max=payload.get("budget_max"),
        description=payload.get("description"),
        archive_root_path=str(archive_path),
        status=payload.get("status", "active"),
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return serialize_project(project)


def get_project(db: Session, project_id: int) -> dict[str, Any] | None:
    project = db.get(Project, project_id)
    return serialize_project(project) if project else None


def update_project(db: Session, project_id: int, payload: dict[str, Any]) -> dict[str, Any] | None:
    project = db.get(Project, project_id)
    if not project:
        return None
    next_budget_min = payload.get("budget_min", project.budget_min)
    next_budget_max = payload.get("budget_max", project.budget_max)
    if next_budget_min is not None and next_budget_max is not None and next_budget_min > next_budget_max:
        raise ValueError("最低预算不能高于最高预算。")
    if payload.get("archive_root_path"):
        payload["archive_root_path"] = str(_resolve_workspace_path(str(payload["archive_root_path"])))
    for key in ("name", "client_name", "style_tags", "room_types", "budget_min", "budget_max", "description", "archive_root_path", "status"):
        if key in payload:
            setattr(project, key, payload[key])
    db.commit()
    db.refresh(project)
    return serialize_project(project)


def delete_project(db: Session, project_id: int) -> bool:
    project = db.get(Project, project_id)
    if not project:
        return False
    db.delete(project)
    db.commit()
    return True


def open_project_folder(db: Session, project_id: int) -> dict[str, Any] | None:
    project = db.get(Project, project_id)
    if not project:
        return None
    folder = _resolve_workspace_path(project.archive_root_path)
    folder.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        os.startfile(str(folder))  # type: ignore[attr-defined]
    else:
        raise RuntimeError("Opening folders is only implemented for the Windows desktop MVP.")
    return {"opened": True, "path": str(folder)}


def _resolve_workspace_path(path_value: str) -> Path:
    path = Path(path_value)
    if not path.is_absolute():
        parts = path.parts
        if parts and parts[0].lower() == "workspace":
            parts = parts[1:]
        path = WORKSPACE_DIR.joinpath(*parts)
    try:
        return validate_workspace_path(str(path), allowed_roots=[WORKSPACE_DIR])
    except SecurityContextError as exc:
        raise ValueError(exc.reason) from exc


def serialize_project(project: Project) -> dict[str, Any]:
    data = model_to_dict(project)
    if not current_platform_capabilities().local_file_open:
        data["archive_root_path"] = None
    return data


def _project_folder_name(name: str) -> str:
    normalized = re.sub(r"[^\w\-\u4e00-\u9fff]+", "-", name.strip(), flags=re.UNICODE).strip("-._")
    return normalized[:100] or "untitled-project"
