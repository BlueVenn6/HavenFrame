from __future__ import annotations

import json
import mimetypes
import os
import sys
import time
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.core.database import SessionLocal, init_db  # noqa: E402
from backend.core.seeds import seed_default_data  # noqa: E402
from backend.services import asset_service, board_service, project_service  # noqa: E402


def main() -> int:
    if os.getenv("LIVE_GLM_EXTRACTION_TESTS") != "1":
        print("SKIPPED: set LIVE_GLM_EXTRACTION_TESTS=1 to run a real billable GLM extraction workflow.")
        return 2
    if not os.getenv("ZHIPU_API_KEY", "").strip():
        print("BLOCKED: ZHIPU_API_KEY is not configured.")
        return 2
    image_value = os.getenv("GLM_TEST_IMAGE_PATH", "").strip()
    image_path = Path(image_value).expanduser().resolve() if image_value else None
    if image_path is None or not image_path.is_file():
        print("BLOCKED: set GLM_TEST_IMAGE_PATH to an explicit room image owned for provider testing.")
        return 2
    mime_type = mimetypes.guess_type(image_path.name)[0]
    if not mime_type or not mime_type.startswith("image/"):
        print("BLOCKED: GLM_TEST_IMAGE_PATH must be an image file.")
        return 2

    init_db()
    with SessionLocal() as db:
        seed_default_data(db)
        timestamp = int(time.time())
        project = project_service.create_project(
            db,
            {
                "name": f"glm-extraction-smoke-{timestamp}",
                "client_name": "GLM 真实提取验收",
                "style_tags": "测试",
                "room_types": "客厅",
                "archive_root_path": f"workspace/projects/glm-extraction-smoke-{timestamp}",
                "status": "active",
            },
        )
        asset = asset_service.create_uploaded_asset(
            db,
            project_id=int(project["id"]),
            file_name=image_path.name,
            file_bytes=image_path.read_bytes(),
            asset_type="room_input",
            mime_type=mime_type,
            room_type="客厅",
            source="glm_live_extraction_test",
        )
        try:
            result = board_service.extract_single_room_items(
                db,
                {
                    "project_id": int(project["id"]),
                    "asset_id": int(asset["id"]),
                    "room_type": "客厅",
                    "style": "现代",
                    "workflow_slot": "room_board.extraction",
                },
            )
        except Exception as exc:
            print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
            return 1

    items = result.get("items") or []
    task = result.get("task") or {}
    valid = bool(items) and task.get("status") == "success"
    print(
        json.dumps(
            {
                "ok": valid,
                "project_id": project["id"],
                "asset_id": asset["id"],
                "task_id": task.get("id"),
                "task_status": task.get("status"),
                "provider": task.get("provider"),
                "model_name": task.get("model_name"),
                "item_count": len(items),
                "items_have_chinese": any(_contains_chinese(str(item.get("name") or "")) for item in items),
                "budget_ranges_valid": all(_valid_budget(item) for item in items),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if valid else 1


def _contains_chinese(value: str) -> bool:
    return any("\u4e00" <= char <= "\u9fff" for char in value)


def _valid_budget(item: dict) -> bool:
    minimum = item.get("price_min")
    maximum = item.get("price_max")
    return minimum is None or maximum is None or float(minimum) <= float(maximum)


if __name__ == "__main__":
    raise SystemExit(main())
