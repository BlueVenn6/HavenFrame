import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from backend.tests.image_fixtures import VALID_PNG


def test_upload_rejects_oversized_file(client: TestClient, monkeypatch):
    monkeypatch.setenv("QIGOU_MAX_UPLOAD_BYTES", "8")

    response = client.post(
        "/api/assets/upload",
        data={"project_id": "1", "asset_type": "space_input", "source": "test"},
        files={"file": ("room.png", b"0123456789", "image/png")},
    )

    assert response.status_code == 400
    assert "大小超过上限" in response.json()["detail"]


def test_upload_rejects_non_whitelist_mime(client: TestClient):
    response = client.post(
        "/api/assets/upload",
        data={"project_id": "1", "asset_type": "space_input", "source": "test"},
        files={"file": ("room.png", b"demo-image-bytes", "text/plain")},
    )

    assert response.status_code == 400
    assert "MIME" in response.json()["detail"]


def test_upload_rejects_image_mime_with_invalid_file_signature(client: TestClient):
    response = client.post(
        "/api/assets/upload",
        data={"project_id": "1", "asset_type": "space_input", "source": "test"},
        files={"file": ("room.png", b"plain text pretending to be png", "image/png")},
    )

    assert response.status_code == 400
    assert "内容签名" in response.json()["detail"]


def test_upload_normalizes_allowed_image_when_extension_and_signature_differ(client: TestClient):
    jpeg_bytes = b"\xff\xd8\xff" + b"jpeg-image-data"
    response = client.post(
        "/api/assets/upload",
        data={"project_id": "1", "asset_type": "space_input", "source": "single_room_board"},
        files={"file": ("微信截图.png", jpeg_bytes, "image/png")},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["file_name"].endswith(".jpg")
    assert payload["mime_type"] == "image/jpeg"


def test_upload_rejects_dangerous_extension(client: TestClient):
    response = client.post(
        "/api/assets/upload",
        data={"project_id": "1", "asset_type": "space_input", "source": "test"},
        files={"file": ("run.exe", b"MZnot-a-real-exe", "image/png")},
    )

    assert response.status_code == 400
    assert "可执行文件" in response.json()["detail"] or "扩展名" in response.json()["detail"]


def test_upload_rejects_path_traversal_filename(client: TestClient):
    response = client.post(
        "/api/assets/upload",
        data={"project_id": "1", "asset_type": "space_input", "source": "test"},
        files={"file": ("../secret.png", b"demo-image-bytes", "image/png")},
    )

    assert response.status_code == 400
    assert "路径" in response.json()["detail"]
    assert "C:\\Users" not in response.json()["detail"]


def test_upload_saves_safe_generated_filename_inside_workspace(client: TestClient):
    response = client.post(
        "/api/assets/upload",
        data={"project_id": "1", "asset_type": "space_input", "source": "test"},
        files={"file": ("../../client-room.png", b"demo-image-bytes", "image/png")},
    )

    assert response.status_code == 400

    good = client.post(
        "/api/assets/upload",
        data={"project_id": "1", "asset_type": "space_input", "source": "test"},
        files={"file": ("client-room.png", VALID_PNG, "image/png")},
    )
    assert good.status_code == 200
    payload = good.json()
    assert payload["file_name"].startswith("upload-")
    assert payload["file_name"].endswith(".png")
    assert "/assets/upload-" in payload["file_path"].replace("\\", "/")


def test_upload_rejects_project_capacity(client: TestClient, monkeypatch):
    monkeypatch.setenv("QIGOU_MAX_PROJECT_UPLOAD_BYTES", "1")

    response = client.post(
        "/api/assets/upload",
        data={"project_id": "1", "asset_type": "space_input", "source": "test"},
        files={"file": ("room.png", VALID_PNG, "image/png")},
    )

    assert response.status_code == 400
    assert "项目上传容量" in response.json()["detail"]


def test_queue_rejects_when_active_limit_exceeded(client: TestClient, monkeypatch):
    from backend.core.database import SessionLocal
    from backend.db.models import Task
    from backend.services import task_service

    with SessionLocal() as db:
        active_count = int(db.query(Task).filter(Task.status.in_(("queued", "running"))).count())
        monkeypatch.setenv("QIGOU_MAX_ACTIVE_TASKS", str(active_count + 1))
        task_service.queue_task(db, "space_render", "limit_a", {"project_id": 1})
        with pytest.raises(ValueError, match="任务队列已满"):
            task_service.queue_task(db, "space_render", "limit_b", {"project_id": 1})


def test_queue_rejects_when_project_running_limit_exceeded(client: TestClient, monkeypatch):
    from backend.core.database import SessionLocal
    from backend.db.models import Task
    from backend.services import task_service

    monkeypatch.setenv("QIGOU_MAX_PROJECT_RUNNING_TASKS", "1")
    monkeypatch.setenv("QIGOU_MAX_ACTIVE_TASKS", "100")
    with SessionLocal() as db:
        created = task_service.queue_task(
            db,
            "space_render",
            "provider_limit_project_a",
            {"project_id": 1},
            provider="ProjectLimitTest",
        )
        running = db.get(Task, created["id"])
        assert running is not None
        running.status = "running"
        db.commit()
        with pytest.raises(ValueError, match="当前项目运行任务已达到并发上限"):
            task_service.queue_task(
                db,
                "space_render",
                "provider_limit_project_b",
                {"project_id": 1},
                provider="ProjectLimitTest",
            )
        running.status = "failed"
        db.commit()


def test_cancelled_provider_task_does_not_call_provider(client: TestClient, monkeypatch):
    from backend.core.database import SessionLocal
    from backend.services import task_service

    called = {"value": False}

    def fake_generate(*args, **kwargs):
        called["value"] = True
        return {"ok": True, "image_bytes": b"png", "mime_type": "image/png", "endpoint_used": "https://api.openai.com/v1"}

    monkeypatch.setattr(task_service, "_generate_provider_image", fake_generate)
    with SessionLocal() as db:
        task = task_service.queue_task(
            db,
            module="space_render",
            task_type="provider_image_generation",
            payload={
                "project_id": 1,
                "inputs": {"payload_json": {"prompt": "x"}},
                "prompt_snapshot": {"resolved_prompt": "x"},
                "params_snapshot": {"real_provider": True, "data_flow_confirmed": True},
            },
            provider="OpenAI",
            model_name="gpt-image-2",
        )
        task_service.cancel_task(db, int(task["id"]))
        result = task_service.run_provider_image_task_now(
            int(task["id"]),
            {
                "project_id": 1,
                "module": "space_render",
                "provider": "OpenAI",
                "model_name": "gpt-image-2",
                "payload_json": {"prompt": "x"},
                "prompt_snapshot": {"resolved_prompt": "x"},
                "data_flow_confirmed": True,
            },
            "x",
            {"requested_size": "1024x1024", "aspect_ratio": "1:1", "output_count": 1},
        )

    assert called["value"] is False
    assert result is not None
    assert result["status"] == "cancelled"


def test_retry_limit_is_enforced(client: TestClient, monkeypatch):
    from backend.core.database import SessionLocal
    from backend.db.models import Task
    from backend.services import task_service

    monkeypatch.setenv("QIGOU_MAX_TASK_RETRIES", "1")
    with SessionLocal() as db:
        task = Task(
            project_id=1,
            module="space_render",
            task_type="provider_retry_limit",
            provider="OpenAI",
            model_name="gpt-image-2",
            status="failed",
            progress=100,
            retry_count=1,
        )
        db.add(task)
        db.commit()
        task_id = task.id

    response = client.post(f"/api/tasks/{task_id}/retry")
    assert response.status_code == 400
    assert "重试次数" in response.json()["detail"]


def test_provider_retry_restarts_worker_from_persisted_snapshot(monkeypatch):
    import json

    from backend.core.database import SessionLocal
    from backend.db.models import Task
    from backend.services import task_service

    started: dict = {}
    monkeypatch.setenv("QIGOU_MAX_ACTIVE_TASKS", "100000")
    monkeypatch.setenv("QIGOU_MAX_PROJECT_RUNNING_TASKS", "100000")
    monkeypatch.setattr(task_service, "_start_provider_image_worker", lambda **kwargs: started.update(kwargs))
    with SessionLocal() as db:
        task = Task(
            project_id=1,
            module="space_render",
            task_type="provider_space_render",
            provider="OpenAI",
            model_name="gpt-image-2",
            status="failed",
            progress=100,
            input_payload_json=json.dumps({"capability": "image_to_image", "payload_json": {"asset_ids": []}}),
            prompt_snapshot_json=json.dumps({"resolved_prompt": "重试提示词"}, ensure_ascii=False),
            params_snapshot_json=json.dumps({"data_flow_confirmed": True, "aspect_ratio": "4:3", "requested_size": "1536x1024"}),
        )
        db.add(task)
        db.commit()
        task_id = task.id
        result = task_service.retry_task(db, task_id)

    assert result is not None and result["status"] == "queued"
    assert started["task_id"] == task_id
    assert started["payload"]["data_flow_confirmed"] is True
    assert started["resolved_prompt"] == "重试提示词"
    assert started["image_params"]["aspect_ratio"] == "4:3"


def test_pre_release_check_fails_without_security_doc(tmp_path: Path):
    root = _copy_minimal_release_tree(tmp_path)
    (root / "SECURITY.md").unlink()

    result = _run_pre_release(root)

    assert result.returncode == 1
    assert "FAIL security_doc" in result.stdout


def test_pre_release_check_fails_on_wildcard_cors(tmp_path: Path):
    root = _copy_minimal_release_tree(tmp_path)
    main = root / "backend/main.py"
    main.write_text("allow_origins=[\"*\"]\n", encoding="utf-8")

    result = _run_pre_release(root)

    assert result.returncode == 1
    assert "FAIL cors_not_wildcard" in result.stdout


def test_pre_release_check_fails_on_tracked_env_or_p8(tmp_path: Path):
    root = _copy_minimal_release_tree(tmp_path)
    (root / ".env").write_text("OPENAI_API_KEY=test", encoding="utf-8")
    subprocess.run(["git", "init"], cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    subprocess.run(["git", "add", "-f", ".env"], cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    result = _run_pre_release(root)

    assert result.returncode == 1
    assert "FAIL secret_scan" in result.stdout


def test_pre_release_check_fails_on_plaintext_api_key_storage(tmp_path: Path):
    root = _copy_minimal_release_tree(tmp_path)
    service = root / "backend/services/model_service.py"
    service.write_text("api_key_encrypted = api_key\n", encoding="utf-8")

    result = _run_pre_release(root)

    assert result.returncode == 1
    assert "FAIL api_key_not_plaintext" in result.stdout


def test_sidecar_runtime_config_uses_app_data_dir(tmp_path: Path):
    app_data = tmp_path / "Qigou Interior AI Studio"
    script = (
        "import json;"
        "from backend.core.config import DATA_DIR, WORKSPACE_DIR, DATABASE_PATH, LOGS_DIR;"
        "print(json.dumps({"
        "'data': str(DATA_DIR),"
        "'workspace': str(WORKSPACE_DIR),"
        "'database': str(DATABASE_PATH),"
        "'logs': str(LOGS_DIR)"
        "}))"
    )
    env = {
        **os.environ,
        "INTERIOR_AI_STUDIO_SKIP_LOCAL_ENV": "1",
        "QIGOU_APP_DATA_DIR": str(app_data),
        "INTERIOR_AI_STUDIO_DATABASE_URL": "",
    }

    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=Path(__file__).resolve().parents[2],
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )

    assert result.returncode == 0
    payload = __import__("json").loads(result.stdout)
    assert Path(payload["data"]) == app_data / "data"
    assert Path(payload["workspace"]) == app_data / "workspace"
    assert Path(payload["database"]) == app_data / "data" / "interior_ai_studio.db"
    assert Path(payload["logs"]) == app_data / "workspace" / "logs"


def test_sidecar_entry_rejects_non_loopback_host():
    result = subprocess.run(
        [sys.executable, "-m", "backend.sidecar_entry", "--host", "0.0.0.0", "--port", "8000"],
        cwd=Path(__file__).resolve().parents[2],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=10,
    )

    assert result.returncode == 2
    assert "loopback" in result.stdout


def test_sidecar_parent_process_probe():
    from backend.sidecar_entry import _process_exists

    assert _process_exists(os.getpid()) is True
    assert _process_exists(0) is False
    exited = subprocess.Popen([sys.executable, "-c", "pass"])
    exited.wait(timeout=10)
    assert _process_exists(exited.pid) is False


def test_pre_release_check_fails_without_sidecar_bundle_config(tmp_path: Path):
    root = _copy_minimal_release_tree(tmp_path)
    tauri_conf = root / "app/src-tauri/tauri.conf.json"
    tauri_conf.write_text('{"bundle":{"active":true,"targets":["nsis"]}}', encoding="utf-8")

    result = _run_pre_release(root)

    assert result.returncode == 1
    assert "FAIL tauri_sidecar_config" in result.stdout


def _copy_minimal_release_tree(tmp_path: Path) -> Path:
    source_root = Path(__file__).resolve().parents[2]
    root = tmp_path / "release"
    paths = [
        ".gitignore",
        "README.md",
        "SECURITY.md",
        "scripts/pre-release-check.py",
        "scripts/secret_scan.py",
        "scripts/build-backend-sidecar.py",
        "app/package.json",
        "app/src-tauri/tauri.conf.json",
        "app/src-tauri/src/main.rs",
        "backend/main.py",
        "backend/sidecar_entry.py",
        "backend/core/config.py",
        "backend/core/local_security.py",
        "backend/core/security_context.py",
        "backend/services/model_service.py",
        "backend/services/task_service.py",
    ]
    for relative in paths:
        source = source_root / relative
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    return root


def _run_pre_release(root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "scripts/pre-release-check.py", "--root", str(root), "--skip-heavy"],
        cwd=root,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
