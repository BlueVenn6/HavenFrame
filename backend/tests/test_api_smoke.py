import json
import time
from datetime import timedelta

from fastapi.testclient import TestClient
from backend.tests.image_fixtures import VALID_PNG


def test_healthcheck(client: TestClient):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "HavenFrame API",
        "service_id": "com.havenframe.desktop.backend",
        "api_contract_version": "2026-07-13-model-persistence-v1",
    }


def test_core_routers_are_registered(client: TestClient):
    routes = {route.path for route in client.app.routes if hasattr(route, "path")}

    assert "/api/projects" in routes
    assert "/api/tasks" in routes
    assert "/api/workflows/floorplan/render" not in routes
    assert "/api/models/providers" in routes
    assert "/api/custom-tasks/run" not in routes
    assert "/api/local/status" not in routes
    assert "/api/render-engines" not in routes


def test_desktop_client_exposes_only_runtime_file_capabilities(client: TestClient):
    response = client.get("/api/platform/capabilities")

    assert response.status_code == 200
    assert response.json() == {
        "api_profile": "desktop_client",
        "local_file_open": True,
        "cloud_api": False,
    }


def test_provider_image_rejects_stale_or_unsupported_explicit_selection(client: TestClient):
    missing = client.post(
        "/api/tasks/provider-image",
        json={
            "project_id": 1,
            "module": "space_render",
            "provider": "OpenAI",
            "model_name": "gpt-image-2",
            "provider_config_id": 999999,
            "data_flow_confirmed": True,
        },
    )
    assert missing.status_code == 400
    assert "不存在或已删除" in missing.json()["detail"]

    mismatch = client.post(
        "/api/tasks/provider-image",
        json={
            "project_id": 1,
            "module": "space_render",
            "provider": "不存在的 Provider",
            "model_name": "gpt-image-2",
            "data_flow_confirmed": True,
        },
    )
    assert mismatch.status_code == 400
    assert "不一致" in mismatch.json()["detail"]


def test_database_uses_temp_sqlite(test_database_url: str):
    from backend.core.config import DATABASE_URL

    assert DATABASE_URL == test_database_url
    assert "interior_ai_studio_test.db" in DATABASE_URL


def test_open_asset_file_endpoint_resolves_saved_asset(client: TestClient, monkeypatch):
    from backend.services import asset_service

    upload_response = client.post(
        "/api/assets/upload",
        data={"project_id": "1", "asset_type": "space_input", "source": "test"},
        files={"file": ("open-me.png", VALID_PNG, "image/png")},
    )
    asset = upload_response.json()
    opened_paths = []

    monkeypatch.setattr(asset_service, "_open_path", lambda path: opened_paths.append(str(path)))

    response = client.post(f"/api/assets/{asset['id']}/open-file")

    assert response.status_code == 200
    payload = response.json()
    assert payload["opened"] is True
    assert payload["path"].endswith(asset["file_name"])
    assert opened_paths == [payload["path"]]


def test_custom_task_template_accepts_json_fields_from_mobile(client: TestClient):
    response = client.post(
        "/api/custom-tasks/templates",
        json={
            "name": "手机端模板",
            "description": "从 Expo 手机端创建。",
            "module_chain_json": ["custom_tasks"],
            "input_schema_json": {"required": ["reference_image"], "optional": ["prompt"]},
            "output_schema_json": {"outputs": ["render_output"]},
            "default_provider": "OpenAI",
            "default_model": "gpt-image-2",
            "export_rules_json": {"formats": ["png"]},
            "is_team_visible": False,
            "version": 1,
        },
    )

    assert response.status_code == 200
    template = response.json()
    assert template["module_chain_json"] == ["custom_tasks"]
    assert template["input_schema_json"]["required"] == ["reference_image"]
    assert template["output_schema_json"]["outputs"] == ["render_output"]
    assert template["export_rules_json"]["formats"] == ["png"]


def test_stale_provider_task_is_failed_on_task_list(client: TestClient):
    from backend.core.database import SessionLocal
    from backend.db.models import Task, utc_now
    from backend.services.task_service import PROVIDER_TIMEOUT_MESSAGE

    started_at = utc_now() - timedelta(seconds=420)
    with SessionLocal() as db:
        task = Task(
            project_id=1,
            module="floorplan",
            task_type="provider_floorplan_render",
            provider="OpenAI",
            model_name="gpt-image-2",
            status="running",
            progress=15,
            input_payload_json=json.dumps({"payload_json": {"asset_ids": [101]}}),
            prompt_snapshot_json=json.dumps({"resolved_prompt": "Render a 3D plan."}),
            params_snapshot_json=json.dumps({"real_provider": True, "timeout_sec": 120}),
            started_at=started_at,
            created_at=started_at,
            updated_at=started_at,
        )
        db.add(task)
        db.commit()
        task_id = task.id

    response = client.get("/api/tasks")

    assert response.status_code == 200
    task = next(item for item in response.json() if item["id"] == task_id)
    assert task["status"] == "failed"
    assert task["progress"] == 100
    assert task["error_message"] == PROVIDER_TIMEOUT_MESSAGE
    assert task["output_payload_json"]["timeout_sec"] == 120


def test_provider_task_stale_grace_allows_slow_response(client: TestClient):
    from backend.core.database import SessionLocal
    from backend.db.models import Task, utc_now
    from backend.services import task_service

    started_at = utc_now() - timedelta(seconds=200)
    with SessionLocal() as db:
        task = Task(
            project_id=1,
            module="custom_tasks",
            task_type="provider_custom_task",
            provider="OpenAI-Compatible Relay",
            model_name="gpt-image-2",
            status="running",
            progress=15,
            params_snapshot_json=json.dumps({"real_provider": True, "timeout_sec": 120}),
            started_at=started_at,
            created_at=started_at,
            updated_at=started_at,
        )
        db.add(task)
        db.commit()
        task_id = task.id

    response = client.get("/api/tasks")

    assert response.status_code == 200
    task = next(item for item in response.json() if item["id"] == task_id)
    assert task["status"] == "running"
    with SessionLocal() as db:
        task_service.mark_task_failed(db, task_id, "test cleanup")


def test_provider_image_task_queues_supported_gemini_image_preview(client: TestClient):
    response = client.post(
        "/api/tasks/provider-image",
        json={
            "project_id": 1,
            "module": "space_render",
            "task_type": "provider_space_render",
            "capability": "image_to_image",
            "provider": "Google Gemini",
            "model_name": "gemini-3-pro-image-preview",
            "payload_summary": "Provider guard smoke test",
            "payload_json": {
                "prompt": "生成一张室内精修效果图。",
                "aspect_ratio": "1:1",
                "output_count": 1,
            },
            "prompt_snapshot": {"resolved_prompt": "生成一张室内精修效果图。"},
            "params_snapshot": {"aspect_ratio": "1:1", "timeout_sec": 120},
            "data_flow_confirmed": True,
        },
    )

    assert response.status_code == 200
    task = response.json()
    assert task["status"] == "queued"
    assert task["provider"] == "Google Gemini"
    assert task["model_name"] == "gemini-3-pro-image-preview"
    assert task["provider_config_id"] is not None

    latest = task
    for _ in range(120):
        latest = client.get(f"/api/tasks/{task['id']}").json()
        if latest["status"] == "failed":
            break
        time.sleep(0.1)

    assert latest["status"] == "failed"
    assert "API key" in latest["error_message"]


def test_provider_image_task_rejects_legacy_placeholder_config(client: TestClient):
    from backend.core.database import SessionLocal
    from backend.db.models import ModelConfig

    with SessionLocal() as db:
        legacy_config = ModelConfig(
            provider_type="openai_compatible",
            provider_name="OpenAI-Compatible Custom",
            routing_mode="relay_base_url",
            base_url="https://relay.invalid/v1",
            model_name="studio-custom-image",
            capabilities_json='["image"]',
            timeout_sec=120,
            max_concurrency=1,
            is_enabled=True,
            priority=999,
            extra_config_json='{"provider_id":"custom_openai","compatibility_mode":"openai_compatible"}',
        )
        db.add(legacy_config)
        db.commit()
        db.refresh(legacy_config)
        legacy_config_id = legacy_config.id
        legacy_provider_name = legacy_config.provider_name

    response = client.post(
        "/api/tasks/provider-image",
        json={
            "project_id": 1,
            "module": "floorplan",
            "task_type": "provider_floorplan_render",
            "capability": "image_to_image",
            "provider": legacy_provider_name,
            "model_name": "studio-custom-image",
            "provider_config_id": legacy_config_id,
            "payload_summary": "Legacy placeholder should not be sent to provider",
            "payload_json": {
                "prompt": "生成一张平面图。",
                "aspect_ratio": "4:3",
                "output_count": 1,
            },
            "prompt_snapshot": {"resolved_prompt": "生成一张平面图。"},
            "params_snapshot": {"aspect_ratio": "4:3", "timeout_sec": 120},
            "data_flow_confirmed": True,
        },
    )

    assert response.status_code == 400
    assert "当前真实图片生成仅支持" in response.json()["detail"]


def test_glm_extraction_requires_explicit_data_flow_confirmation(client: TestClient):
    response = client.post(
        "/api/workflows/softboard/extract-items",
        json={"project_id": 1, "asset_id": 1, "room_type": "客厅", "style": "现代"},
    )
    assert response.status_code == 400
    assert "确认数据流和素材授权" in response.json()["detail"]


def test_provider_image_requires_data_flow_confirmation(client: TestClient):
    response = client.post(
        "/api/tasks/provider-image",
        json={
            "project_id": 1,
            "module": "space_render",
            "task_type": "provider_space_render",
            "capability": "image_to_image",
            "provider": "OpenAI",
            "model_name": "gpt-image-2",
            "payload_summary": "Missing confirmation",
            "payload_json": {
                "prompt": "生成一张室内精修效果图。",
                "aspect_ratio": "1:1",
                "output_count": 1,
            },
            "prompt_snapshot": {"resolved_prompt": "生成一张室内精修效果图。"},
            "params_snapshot": {"aspect_ratio": "1:1", "timeout_sec": 120},
        },
    )

    assert response.status_code == 400
    assert "必须确认数据流" in response.json()["detail"]


def test_mobile_model_route_saves_glm_extraction_without_exposing_key(client: TestClient):
    response = client.post(
        "/api/models/mobile-routes",
        json={
            "provider_id": "zhipu_glm",
            "provider_name": "Zhipu GLM",
            "model_name": "glm-4.5v",
            "display_name": "GLM-4.5V 多模态提取",
            "routing_mode": "direct_api",
            "compatibility_mode": "openai_compatible",
            "base_url": "https://open.bigmodel.cn/api/paas/v4",
            "api_key": "test-only-not-a-real-secret",
            "capabilities_json": ["text", "vision"],
        },
    )

    assert response.status_code == 200, response.text
    config = response.json()
    assert config["provider_id"] == "zhipu_glm"
    assert config["model_id"] == "glm-4.5v"
    assert config["extra_config_json"]["capability"] == "vision"
    assert config["extra_config_json"]["default_endpoint_path"] == "/chat/completions"
    assert config["has_api_key"] is True
    assert "api_key" not in config
    assert "api_key_encrypted" not in config
    assert "test-only-not-a-real-secret" not in response.text


def test_mobile_model_route_keeps_generation_and_extraction_whitelists_separate(client: TestClient):
    invalid_glm = client.post(
        "/api/models/mobile-routes",
        json={
            "provider_id": "zhipu_glm",
            "provider_name": "Zhipu GLM",
            "model_name": "gpt-image-2",
            "routing_mode": "direct_api",
            "compatibility_mode": "openai_compatible",
        },
    )
    assert invalid_glm.status_code == 400
    assert "只允许 GLM" in invalid_glm.json()["detail"]

    image_only_route = client.post(
        "/api/models/mobile-image-routes",
        json={
            "provider_id": "zhipu_glm",
            "provider_name": "Zhipu GLM",
            "model_name": "glm-4.5v",
            "routing_mode": "direct_api",
            "compatibility_mode": "openai_compatible",
        },
    )
    assert image_only_route.status_code == 400
    detail = image_only_route.json()["detail"]
    assert "只支持 OpenAI gpt-image-2 或 Google Gemini 图像模型" in detail


def test_provider_presets_and_module_priority(client: TestClient):
    providers_response = client.get("/api/models/providers")
    preferences_response = client.get("/api/models/module-preferences")

    assert providers_response.status_code == 200
    assert preferences_response.status_code == 200

    providers = providers_response.json()
    expected_provider_fields = {
        "id",
        "provider_type",
        "provider_name",
        "routing_mode",
        "endpoint",
        "base_url",
        "model_name",
        "capabilities_json",
        "timeout_sec",
        "max_concurrency",
        "is_default",
        "is_enabled",
        "priority",
        "created_at",
        "updated_at",
    }
    assert providers
    assert expected_provider_fields.issubset(providers[0].keys())

    gemini_models = {
        item["model_name"]
        for item in providers
        if item["provider_name"] == "Google Gemini"
    }
    openai_models = {
        item["model_name"]
        for item in providers
        if item["provider_name"] == "OpenAI"
    }
    provider_names = {item["provider_name"] for item in providers}

    assert "Google Gemini" in provider_names
    assert "Volcengine Ark" not in provider_names
    assert "Volcengine Jimeng Official API" not in provider_names
    assert "Jimeng / Volcengine" not in provider_names
    assert "OpenAI" in provider_names
    assert "ComfyUI Local" not in provider_names
    assert "gemini-2.5-flash-image" in gemini_models
    assert "gemini-3-pro-image-preview" in gemini_models
    assert "gemini-3.1-flash-image-preview" in gemini_models
    assert "gemini-2.5-flash-image-preview" not in gemini_models
    assert "gemini-3-pro-preview" not in gemini_models
    assert "Nano Banana" not in provider_names
    assert not {"gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"}.intersection(openai_models)
    assert "gpt-5.2" not in openai_models
    assert "gpt-image-2" in openai_models
    assert "gpt-image-1.5" not in openai_models
    assert "gpt-image-1" not in openai_models
    assert "gpt-image-1-mini" not in openai_models
    assert "relay-text-smoke-test" not in {item["model_name"] for item in providers}
    assert "studio-custom-image" not in {item["model_name"] for item in providers}
    assert "custom-rest-model" not in {item["model_name"] for item in providers}
    openai_gpt_image_2_direct = [
        item for item in providers
        if item["provider_id"] == "openai"
        and item["model_id"] == "gpt-image-2"
        and item["routing_mode"] == "direct_api"
    ]
    assert openai_gpt_image_2_direct
    zhipu_glm = next(
        item for item in providers
        if item["provider_id"] == "zhipu_glm" and item["model_id"] == "glm-4.5v"
    )
    assert zhipu_glm["routing_mode"] == "direct_api"
    assert zhipu_glm["compatibility_mode"] == "native"
    assert zhipu_glm["base_url"] == "https://open.bigmodel.cn/api/paas/v4"
    zai_glm = next(
        item for item in providers
        if item["provider_id"] == "zai_glm" and item["model_id"] == "glm-4.5v"
    )
    assert zai_glm["routing_mode"] == "direct_api"
    assert zai_glm["compatibility_mode"] == "native"
    assert zai_glm["base_url"] == "https://api.z.ai/api/paas/v4"
    assert zai_glm["api_key_name"] == "ZAI_API_KEY"

    gemini_labels = {
        item["extra_config_json"].get("label")
        for item in providers
        if item["provider_name"] == "Google Gemini"
    }
    assert "Gemini 2.5 Flash Image (Nano Banana)" in gemini_labels
    assert "Gemini 3 Pro Image Preview (Nano Banana Pro)" in gemini_labels
    assert "Gemini 3.1 Flash Image Preview (Nano Banana 2)" in gemini_labels
    openai_labels = {
        item["extra_config_json"].get("label")
        for item in providers
        if item["provider_name"] == "OpenAI"
    }
    assert "GPT Image 2" in openai_labels
    volcengine_provider_ids = {
        item["provider_id"]
        for item in providers
        if item["provider_label"].startswith("Volcengine")
    }
    assert "volcengine_ark" not in volcengine_provider_ids
    assert "volcengine_jimeng" not in volcengine_provider_ids

    preferences = {
        item["module_name"]: item["priority_order_json"]
        for item in preferences_response.json()
    }
    assert {"floorplan", "boards", "room_board_extraction", "multi_room_board_extraction", "space_render", "image_editing", "fast_draft"}.issubset(
        preferences.keys()
    )
    assert "vid" + "eo" not in preferences
    assert preferences["boards"][:2] == [
        "gpt-image-2",
        "gemini-2.5-flash-image",
    ]
    assert preferences["fast_draft"][0] == "gpt-image-2"
    assert preferences["room_board_extraction"][0] == "glm-4.5v"
    assert preferences["multi_room_board_extraction"][0] == "glm-4.5v"
    assert "gpt-image-1-mini" not in preferences["fast_draft"]
    registry_response = client.get("/api/models/registry")
    assert registry_response.status_code == 200
    registry = registry_response.json()
    assert "gpt-image-1" in registry["removed_or_hidden_model_ids"]
    assert "gemini-2.5-flash-image-preview" in registry["removed_or_hidden_model_ids"]
