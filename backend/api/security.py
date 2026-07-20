from __future__ import annotations

from fastapi import APIRouter, Query

from backend.core.security_context import build_security_context


router = APIRouter(prefix="/api/security", tags=["security"])


@router.get("/diagnosis")
def security_diagnosis(
    endpoint: str | None = Query(default=None),
    provider_id: str = Query(default="openai"),
    routing_mode: str = Query(default="direct_api"),
    compatibility_mode: str | None = Query(default=None),
    provider_type: str | None = Query(default=None),
    task_type: str | None = Query(default=None),
    data_flow_confirmed: bool = Query(default=False),
    require_data_flow: bool = Query(default=False),
    allow_provider_fallback: bool = Query(default=False),
) -> dict:
    context = build_security_context(
        endpoint=endpoint,
        provider_id=provider_id,
        routing_mode=routing_mode,
        compatibility_mode=compatibility_mode,
        provider_type=provider_type,
        task_type=task_type,
        data_flow_confirmed=data_flow_confirmed,
        require_data_flow=require_data_flow,
        allow_provider_fallback=allow_provider_fallback,
    )
    return context.as_dict()
