from __future__ import annotations

import base64
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.core.database import SessionLocal, init_db  # noqa: E402
from backend.core.seeds import seed_default_data  # noqa: E402
from backend.services import asset_service, model_service, project_service, task_service  # noqa: E402


TEST_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAABqUlEQVR4nO3TMQEAIAzAsIF/z0NGHjQK"
    "O6lT0FfX9wJwZgDgA8AHAJ8APgD4APABwAeADwA+AHwA8AHAB4APAD4A/ADwAcAHgA8APgB8APAB"
    "wAeADwA+AHwA8AHAB4APAD4AfADwAeADgA8APgB8APABwAeADwA+AHwA8AHAB4APAD4AfADwAcAH"
    "gA8APgB8APABwAeADwA+AHwA8AHAB4APAD4AfADwAcAHgA8APgB8APABwAeADwA+AHwA8AHAB4AP"
    "AD4AfADwAcAHgA8APgB8APABwAeADwA+AHwA8AHAB4APAD4AfADwAcAHgA8APgB8APABwAeADwA+"
    "AHwA8AHAB4APAD4AfADwAcAHgA8APgB8APABwAeADwA+AHwA8AHAB4APAD4AfADwAcAHgA8APgB8"
    "APABwAeADwA+AHwA8AHAB4APAD4AfADwAcAHgA8APgB8APABwAeADwA+AHwA8AHAB4APAD4AfADw"
    "AcAHgA8APgB8APABwAeADwA+AHwA8AHAB4APAD4AfADwAcAHgA8APgB8APABwAeADwA+AHwA8AHA"
    "B4APAD4AfADwAcAHgA8APgB8APABwAeADwA+AHwA8AHAB4APAD4AfADwAcAHgA8APgB8APABwAeA"
    "DwA+AHwA8AHAB4APAD4AfADwAcAHgA8APgB8APABwAeADwA+AHwA8AHAB4APgN8Am9wD/eb0cEQA"
    "AAAASUVORK5CYII="
)


def main() -> int:
    if os.getenv("LIVE_MOBILE_MODEL_TESTS") != "1":
        print("SKIPPED: set LIVE_MOBILE_MODEL_TESTS=1 to run a real billable mobile image workflow.")
        return 2

    init_db()
    with SessionLocal() as db:
        seed_default_data(db)
        selection = model_service.resolve_module_selection(db, "space_render")
        project = project_service.create_project(
            db,
            {
                "name": f"mobile-real-model-smoke-{int(time.time())}",
                "client_name": "移动端真实模型测试",
                "style_tags": "现代自然",
                "room_types": "客厅",
                "budget_min": 0,
                "budget_max": 0,
                "archive_root_path": f"workspace/projects/mobile-real-model-smoke-{int(time.time())}",
                "status": "active",
                "description": "由发布前 Mobile 真实模型验收脚本创建。",
            },
        )
        asset = asset_service.create_uploaded_asset(
            db,
            project_id=int(project["id"]),
            file_name="mobile-real-input.png",
            file_bytes=TEST_PNG,
            asset_type="space_input",
            mime_type="image/png",
            room_type="客厅",
            source="space_render",
            metadata={"source": "mobile_real_model_smoke"},
        )
        payload = {
            "project_id": project["id"],
            "module": "space_render",
            "task_type": "provider_space_render",
            "capability": "image_to_image",
            "provider": selection.get("provider_name") or "OpenAI",
            "model_name": selection.get("model_name") or "gpt-image-2",
            "provider_config_id": selection.get("provider_config_id"),
            "payload_summary": "Mobile 真实模型验收 · 空间渲染 · 1:1",
            "payload_json": {
                "asset_ids": [asset["id"]],
                "room_type": "客厅",
                "style": "现代自然",
                "prompt": (
                    "根据这张极简输入图生成一张真实感室内客厅概念图，"
                    "现代自然风格，干净构图，保留单一空间透视。"
                ),
                "material_keywords": ["胡桃木", "亚麻", "微水泥"],
                "output_count": 1,
                "aspect_ratio": "1:1",
                "require_source_images": True,
            },
            "prompt_snapshot": {
                "resolved_prompt": "Mobile 真实模型验收：生成一张现代自然风格室内客厅效果图。",
                "negative_prompt": "文字水印、结构扭曲、低清晰度",
            },
            "params_snapshot": {
                "source": "mobile_expo_real_model_smoke",
                "output_count": 1,
                "aspect_ratio": "1:1",
                "timeout_sec": int(os.getenv("MOBILE_REAL_MODEL_TIMEOUT_SEC", "240")),
                "data_flow_confirmed": True,
            },
            "data_flow_confirmed": True,
        }
        task = task_service.queue_provider_image_task(db, payload)
        task_id = int(task["id"])

    deadline = time.time() + int(os.getenv("MOBILE_REAL_MODEL_WAIT_SEC", "360"))
    latest: dict[str, Any] = task
    while time.time() < deadline:
        time.sleep(3)
        with SessionLocal() as db:
            latest = task_service.get_task(db, task_id) or latest
        print(f"task #{task_id}: {latest.get('status')} {latest.get('progress')}%")
        if latest.get("status") in {"success", "failed", "cancelled"}:
            break

    if latest.get("status") != "success":
        print(json.dumps({"ok": False, "task": _safe_task(latest)}, ensure_ascii=False, indent=2))
        return 1

    output = latest.get("output_payload_json") or {}
    assets = output.get("assets") if isinstance(output, dict) else None
    first_asset = assets[0] if isinstance(assets, list) and assets else None
    if not isinstance(first_asset, dict) or not first_asset.get("id"):
        print(json.dumps({"ok": False, "reason": "success task had no output asset", "task": _safe_task(latest)}, ensure_ascii=False, indent=2))
        return 1

    with SessionLocal() as db:
        resolved = asset_service.get_asset_path(db, int(first_asset["id"]))
    if resolved is None:
        print(json.dumps({"ok": False, "reason": "output asset file missing", "asset": first_asset}, ensure_ascii=False, indent=2))
        return 1

    file_path, media_type = resolved
    result = {
        "ok": True,
        "task_id": task_id,
        "project_id": latest.get("project_id"),
        "provider": latest.get("provider"),
        "model_name": latest.get("model_name"),
        "asset_id": first_asset.get("id"),
        "asset_type": first_asset.get("type"),
        "mime_type": media_type,
        "file_size": file_path.stat().st_size,
        "file_name": file_path.name,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def _safe_task(task: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": task.get("id"),
        "project_id": task.get("project_id"),
        "module": task.get("module"),
        "task_type": task.get("task_type"),
        "provider": task.get("provider"),
        "model_name": task.get("model_name"),
        "status": task.get("status"),
        "progress": task.get("progress"),
        "error_message": task.get("error_message"),
        "output_payload_json": task.get("output_payload_json"),
    }


if __name__ == "__main__":
    raise SystemExit(main())
