from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx


TERMINAL_STATUSES = {"success", "failed", "cancelled"}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate real image generation through the installed HavenFrame application backend."
    )
    parser.add_argument("--api-base", default="http://127.0.0.1:8010")
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--provider-config-id", type=int)
    parser.add_argument("--max-wait-sec", type=int, default=1800)
    parser.add_argument(
        "--paid-workflows",
        default="single,multi",
        help="comma-separated paid workflows: single,multi",
    )
    parser.add_argument(
        "--allow-paid-provider-call",
        action="store_true",
        help="required acknowledgement that this validation incurs real provider charges",
    )
    args = parser.parse_args()

    if not args.allow_paid_provider_call:
        parser.error("--allow-paid-provider-call is required")
    if not args.fixture.is_file():
        parser.error(f"fixture does not exist: {args.fixture}")

    paid_workflows = [item.strip() for item in args.paid_workflows.split(",") if item.strip()]
    if not paid_workflows or any(item not in {"single", "multi"} for item in paid_workflows):
        parser.error("--paid-workflows must contain single and/or multi")

    result: dict[str, Any] = {
        "started_at": _now(),
        "api_base": args.api_base,
        "external_provider_called": False,
        "installed_database_used": True,
        "paid_workflows": paid_workflows,
        "checks": {},
        "tasks": [],
    }
    exit_code = 1
    try:
        with httpx.Client(base_url=args.api_base, timeout=60.0) as client:
            session = _request(client, "GET", "/api/security/session")
            token_header = session.get("token_header")
            token = session.get("token")
            if not token_header or not token:
                raise RuntimeError("installed backend did not issue a local security token")
            client.headers[token_header] = token

            health = _request(client, "GET", "/health")
            result["checks"]["health"] = health.get("status") == "ok"

            configs = _request(client, "GET", "/api/models/providers")
            config = _select_relay_config(configs, args.provider_config_id)
            if int(config.get("timeout_sec") or 0) < 900:
                raise RuntimeError("installed image provider timeout was not migrated to at least 900 seconds")
            result["provider"] = {
                "config_id": config["id"],
                "provider": config.get("provider_name"),
                "model": config.get("model_id") or config.get("model_name"),
                "routing_mode": config.get("routing_mode"),
                "timeout_sec": config.get("timeout_sec"),
                "has_api_key": bool(config.get("has_api_key")),
            }

            project = _request(
                client,
                "POST",
                "/api/projects",
                json={
                    "name": f"RC6 安装版真实验收 {datetime.now().strftime('%Y%m%d-%H%M%S')}",
                    "client_name": "发布验收",
                    "style_tags": "现代、自然、暖色",
                    "room_types": "客厅、餐厅",
                    "description": "真实安装版中转出图与独立工作流验收。",
                },
            )
            project_id = int(project["id"])
            asset_a = _upload(client, args.fixture, project_id, "客厅")
            asset_b = _upload(client, args.fixture, project_id, "餐厅")
            asset_ids = [int(asset_a["id"]), int(asset_b["id"])]
            result["project_id"] = project_id
            result["source_asset_ids"] = asset_ids

            single_doc = _request(
                client,
                "POST",
                "/api/workflows/softboard/single-room",
                json={
                    "project_id": project_id,
                    "asset_id": asset_ids[0],
                    "room_type": "客厅",
                    "style": "现代自然",
                    "selected_item_ids": [],
                },
            )
            multi_doc = _request(
                client,
                "POST",
                "/api/workflows/softboard/multi-room",
                json={
                    "project_id": project_id,
                    "asset_ids": asset_ids,
                    "selected_item_ids": [],
                    "room_tags": {str(asset_ids[0]): "客厅", str(asset_ids[1]): "餐厅"},
                    "integrated_board_title": "RC6 独立多房间方案板验收",
                },
            )
            result["checks"].update(
                {
                    "single_without_extraction_review_or_budget": bool(single_doc.get("board_documents")),
                    "multi_without_extraction_review_or_budget": bool(multi_doc.get("board_documents")),
                }
            )

            for workflow in paid_workflows:
                source_ids = asset_ids[:1] if workflow == "single" else asset_ids
                task = _queue_paid_task(client, project_id, source_ids, config, workflow)
                result["external_provider_called"] = True
                completed = _wait_for_task(client, int(task["id"]), args.max_wait_sec)
                task_result = _request(client, "GET", f"/api/tasks/{task['id']}/result")
                assets = (task_result.get("result") or {}).get("assets") or []
                if completed.get("status") != "success":
                    raise RuntimeError(
                        f"installed {workflow} provider task #{task['id']} failed: "
                        f"{completed.get('error_message') or completed.get('status')}"
                    )
                if not assets:
                    raise RuntimeError(f"installed {workflow} task #{task['id']} returned no assets")
                output_asset_id = int(assets[0]["id"])
                content = client.get(f"/api/assets/{output_asset_id}/content")
                content.raise_for_status()
                content_type = content.headers.get("content-type", "").split(";", 1)[0]
                if not content_type.startswith("image/") or len(content.content) < 1024:
                    raise RuntimeError(f"installed task #{task['id']} output is not a readable image")
                result["tasks"].append(
                    {
                        "workflow": workflow,
                        "task_id": int(task["id"]),
                        "status": completed.get("status"),
                        "output_asset_id": output_asset_id,
                        "content_type": content_type,
                        "content_bytes": len(content.content),
                    }
                )

            result["checks"]["real_provider_images_readable"] = len(result["tasks"]) == len(paid_workflows)
            failed_checks = [name for name, passed in result["checks"].items() if passed is not True]
            if failed_checks:
                raise RuntimeError(f"installed release checks failed: {', '.join(failed_checks)}")
            result["status"] = "passed"
            exit_code = 0
    except Exception as exc:
        result["status"] = "failed"
        result["error"] = str(exc)
    finally:
        result["finished_at"] = _now()
        args.result.parent.mkdir(parents=True, exist_ok=True)
        args.result.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return exit_code


def _request(client: httpx.Client, method: str, url: str, **kwargs: Any) -> Any:
    response = client.request(method, url, **kwargs)
    if response.is_error:
        detail = response.text[:1000]
        raise RuntimeError(f"{method} {url} returned HTTP {response.status_code}: {detail}")
    return response.json()


def _select_relay_config(configs: list[dict[str, Any]], requested_id: int | None) -> dict[str, Any]:
    candidates = [
        item
        for item in configs
        if item.get("is_enabled")
        and item.get("has_api_key")
        and item.get("routing_mode") == "relay_base_url"
        and (item.get("model_id") or item.get("model_name")) == "gpt-image-2"
    ]
    if requested_id is not None:
        candidates = [item for item in candidates if int(item.get("id") or 0) == requested_id]
    if not candidates:
        raise RuntimeError("installed database has no enabled gpt-image-2 relay config with a saved API key")
    return sorted(candidates, key=lambda item: int(item.get("priority") or 1000))[0]


def _upload(client: httpx.Client, fixture: Path, project_id: int, room_type: str) -> dict[str, Any]:
    with fixture.open("rb") as handle:
        return _request(
            client,
            "POST",
            "/api/assets/upload",
            data={
                "project_id": str(project_id),
                "asset_type": "room_input",
                "room_type": room_type,
                "source": "rc6_installed_live_validation",
            },
            files={"file": (fixture.name, handle, "image/png")},
        )


def _queue_paid_task(
    client: httpx.Client,
    project_id: int,
    asset_ids: list[int],
    config: dict[str, Any],
    workflow: str,
) -> dict[str, Any]:
    is_multi = workflow == "multi"
    prompt = (
        "基于上传的室内图生成一张可交付的现代自然风中文室内方案板，保持原空间关系，"
        "呈现真实材质、协调配色和清晰家具布局，不添加价格或购买链接。"
        if not is_multi
        else "综合两张上传的室内参考图生成一张统一现代自然风的整屋中文方案板，保持空间用途，"
        "统一材质与配色，不添加价格或购买链接。"
    )
    return _request(
        client,
        "POST",
        "/api/tasks/provider-image",
        json={
            "project_id": project_id,
            "module": "multi_room_board" if is_multi else "single_room_board",
            "task_type": "provider_multi_room_board" if is_multi else "provider_single_room_board",
            "capability": "multi_image_composition" if is_multi else "image_to_image",
            "provider": config.get("provider_name") or "OpenAI-Compatible Relay",
            "model_name": "gpt-image-2",
            "provider_config_id": int(config["id"]),
            "payload_summary": "RC6 正式安装版真实中转出图验收",
            "payload_json": {
                "asset_ids": asset_ids,
                "require_source_images": True,
                "prompt": prompt,
                "output_count": 1,
                "aspect_ratio": "16:9",
                "review_snapshot": [],
                "selected_item_ids": [],
            },
            "prompt_snapshot": {"resolved_prompt": prompt},
            "params_snapshot": {
                "timeout_sec": max(900, int(config.get("timeout_sec") or 900)),
                "output_count": 1,
                "aspect_ratio": "16:9",
                "data_flow_confirmed": True,
                "allow_provider_fallback": False,
            },
            "data_flow_confirmed": True,
            "allow_provider_fallback": False,
        },
    )


def _wait_for_task(client: httpx.Client, task_id: int, max_wait_sec: int) -> dict[str, Any]:
    deadline = time.monotonic() + max_wait_sec
    while time.monotonic() < deadline:
        task = _request(client, "GET", f"/api/tasks/{task_id}")
        if task.get("status") in TERMINAL_STATUSES:
            return task
        time.sleep(10)
    raise RuntimeError(f"installed provider task #{task_id} did not finish within {max_wait_sec}s")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    sys.exit(main())
