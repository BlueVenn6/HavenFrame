import json

from sqlalchemy.orm import Session

from backend.core.serializers import model_to_dict
from backend.db.models import Asset, BoardDocument, ExportRecord, ExtractedItem, Project, ProjectVersion, Task
from backend.services import asset_service, board_service, export_service, project_service


def get_project_review(db: Session, project_id: int) -> dict | None:
    project = db.get(Project, project_id)
    if not project:
        return None
    tasks = db.query(Task).filter(Task.project_id == project_id).all()
    assets = db.query(Asset).filter(Asset.project_id == project_id).all()
    exports = db.query(ExportRecord).filter(ExportRecord.project_id == project_id).all()
    versions = db.query(ProjectVersion).filter(ProjectVersion.project_id == project_id).all()
    board_documents = db.query(BoardDocument).filter(BoardDocument.project_id == project_id).all()
    extracted_items = db.query(ExtractedItem).filter(ExtractedItem.project_id == project_id).all()
    task_history = [model_to_dict(task) for task in tasks]
    replay_entries = [
        {
            "task_id": task["id"],
            "module": task["module"],
            "task_type": task["task_type"],
            "provider": task["provider"],
            "model_name": task["model_name"],
            "status": task["status"],
            "prompt": (task.get("prompt_snapshot_json") or {}).get("resolved_prompt"),
            "params": task.get("params_snapshot_json") or {},
            "created_at": task["created_at"],
        }
        for task in task_history
    ]
    return {
        "project": project_service.serialize_project(project),
        "task_history": task_history,
        "assets": [asset_service.serialize_asset(asset) for asset in assets],
        "exports": [export_service.serialize_export(item) for item in exports],
        "versions": [model_to_dict(item) for item in versions],
        "board_documents": [model_to_dict(item) for item in board_documents],
        "extracted_items": board_service.list_extracted_items(db, project_id=project_id),
        "replay_entries": replay_entries,
        "summary": {
            "asset_count": len(assets),
            "task_count": len(task_history),
            "export_count": len(exports),
            "version_count": len(versions),
            "board_document_count": len(board_documents),
            "extracted_item_count": len(extracted_items),
            "preview_asset_count": len(
                [asset for asset in assets if asset.type == "board_output"]
            ),
            "latest_provider": replay_entries[0]["provider"] if replay_entries else None,
        },
    }


def list_versions(db: Session, project_id: int) -> list[dict]:
    return [
        model_to_dict(item)
        for item in db.query(ProjectVersion).filter(ProjectVersion.project_id == project_id).order_by(ProjectVersion.created_at.desc()).all()
    ]


def create_version(db: Session, project_id: int, payload: dict) -> dict:
    if isinstance(payload.get("snapshot_json"), dict):
        payload["snapshot_json"] = json.dumps(payload["snapshot_json"], ensure_ascii=False)
    version = ProjectVersion(project_id=project_id, **payload)
    db.add(version)
    db.commit()
    db.refresh(version)
    return model_to_dict(version)


def get_replay(db: Session, project_id: int, task_id: int) -> dict | None:
    project = db.get(Project, project_id)
    task = db.get(Task, task_id)
    if not project or not task or task.project_id != project_id:
        return None
    task_payload = model_to_dict(task)
    prompt_recorded = bool((task_payload.get("prompt_snapshot_json") or {}).get("resolved_prompt"))
    output_assets = (task_payload.get("output_payload_json") or {}).get("assets") or []
    archived_asset_ids = [
        int(item["id"])
        for item in output_assets
        if isinstance(item, dict)
        and isinstance(item.get("id"), int)
        and item.get("project_id") == project_id
        and asset_service.get_asset_path(db, int(item["id"])) is not None
    ]
    execution_status = task.status if task.status in {"queued", "running", "success", "failed", "cancelled"} else "failed"
    archive_status = "done" if task.status == "success" and archived_asset_ids else "not_available"
    return {
        "project": project_service.serialize_project(project),
        "task": task_payload,
        "steps": [
            {"label": "任务已持久化", "status": "done", "task_id": task.id},
            {"label": "提示词快照", "status": "done" if prompt_recorded else "not_available"},
            {"label": "Provider / 模型路由", "status": "done" if task.provider and task.model_name else "not_available"},
            {"label": "任务执行", "status": execution_status},
            {"label": "输出归档", "status": archive_status, "asset_ids": archived_asset_ids},
        ],
        "message": "复盘仅展示数据库和文件系统中已确认的任务事实。",
    }
