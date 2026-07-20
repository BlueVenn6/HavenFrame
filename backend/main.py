import asyncio
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from starlette.websockets import WebSocketState

from backend.api import (
    assets,
    custom_tasks,
    exports,
    models,
    platform_info,
    projects,
    prompts,
    review,
    security,
    tasks,
    workflows_floorplan,
    workflows_softboard,
    workflows_space_render,
)
from backend.core.local_security import (
    LocalSecurityMiddleware,
    allowed_cors_origins,
    issue_local_session,
    websocket_is_allowed,
)
from backend.core.legacy_model_migration import migrate_legacy_model_routes
from backend.core.platform_capabilities import current_platform_capabilities
from backend.core.database import SessionLocal, init_db
from backend.core.seeds import seed_default_data
from backend.services import model_service
from backend.services.task_service import mark_stale_live_tasks
from backend.tasks.queue import queue_manager


logger = logging.getLogger(__name__)

SERVICE_ID = os.getenv("QIGOU_SERVICE_ID", "com.havenframe.desktop.backend")
API_CONTRACT_VERSION = "2026-07-13-model-persistence-v1"


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    init_db()
    with SessionLocal() as session:
        seed_default_data(session)
        migrate_legacy_model_routes(session)
        model_service.migrate_plain_api_keys(session)
        model_service.migrate_image_generation_timeouts(session)
        mark_stale_live_tasks(session)
    yield


app = FastAPI(title="HavenFrame API", version="0.2.0-rc.12", lifespan=lifespan)
app.add_middleware(LocalSecurityMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type", "X-Qigou-Local-Token"],
)

for router in (
    projects.router,
    assets.router,
    tasks.router,
    prompts.router,
    models.router,
    platform_info.router,
    exports.router,
    workflows_floorplan.router,
    workflows_softboard.router,
    workflows_space_render.router,
    custom_tasks.router,
    review.router,
    security.router,
):
    app.include_router(router)

@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "HavenFrame API",
        "service_id": SERVICE_ID,
        "api_contract_version": API_CONTRACT_VERSION,
    }


@app.get("/api/security/session")
def local_security_session(response: Response) -> dict[str, str]:
    if current_platform_capabilities().cloud_api:
        return {"service": "HavenFrame API", "token_header": "Authorization"}
    return issue_local_session(response)


@app.websocket("/ws/tasks")
async def task_updates(websocket: WebSocket) -> None:
    if not websocket_is_allowed(websocket):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    try:
        while True:
            await websocket.send_json({"tasks": queue_manager.snapshot()})
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        return
    except (RuntimeError, OSError):
        logger.exception("Desktop task WebSocket failed.")
        if websocket.client_state == WebSocketState.CONNECTED:
            await websocket.close(code=1011)
