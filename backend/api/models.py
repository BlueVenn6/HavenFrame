from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.core.database import get_db
from backend.core.redaction import redact_text
from backend.schemas.models import (
    ModelConnectivityTestRequest,
    ModulePreferenceUpdate,
    ProviderConfigCreate,
    ProviderConfigSave,
    ProviderConfigUpdate,
    TestAllConfiguredModelsRequest,
)
from backend.services import model_service


router = APIRouter(prefix="/api/models", tags=["models"])


_PUBLIC_CONNECTIVITY_ERRORS = {
    "missing_api_key": "Missing API key or required auth field.",
    "missing_base_url": "Base URL is required for this routing mode.",
    "auth_error": "Authentication failed. Check API key.",
    "network_error": "Network error. Check host, relay URL, or local service.",
    "timeout": "Request timed out.",
    "invalid_request": "Provider rejected the request. Check model, endpoint, and payload.",
    "unsupported_model": "This model or capability is not supported by this smoke test.",
    "model_lookup_unavailable": "The relay responded but does not expose a model lookup endpoint. Verify image generation through the workflow task queue.",
    "response_parse_error": "Response was received but could not be parsed.",
    "provider_error": "Provider returned an error.",
    "unknown_error": "Unknown provider connectivity error.",
    "unsupported_auth": "Provider auth signing is not configured for this smoke test.",
    "invalid_headers_json": "Headers JSON must be an object.",
    "skipped_cost_risk": "Skipped image model to avoid billable provider calls.",
    "not_tested_missing_credentials": "Not tested because required credentials are missing.",
    "cost_risk_skipped": "Skipped image model to avoid billable provider calls.",
    "needs_official_id_verification": "Official API model id is not confirmed; live test is disabled.",
    "unsupported_consumer_app": "Consumer app membership/token access is not an API provider.",
    "unsupported_compatibility": "This compatibility mode is not supported for the selected provider.",
    "invalid_secret_placeholder": "Credential/header contains placeholder text.",
    "invalid_secret_format": "Credential/header contains an invalid format.",
    "invalid_header_value": "HTTP header keys and values must be valid strings.",
    "invalid_base_url": "Base URL is invalid.",
    "url_policy_blocked": "URL policy blocked this endpoint.",
}
_PUBLIC_RELEASE_STATUSES = {
    "PASS",
    "BLOCKED_CONFIG",
    "BLOCKED_CREDENTIALS",
    "BLOCKED_NETWORK",
    "BLOCKED_PROVIDER",
    "BLOCKED_LIVE_VERIFICATION",
    "CODE_FAILURE",
    "SKIPPED_COST",
}
_PUBLIC_VERIFICATION_SOURCES = {"successful_task_history"}


@router.get("/providers")
def list_providers(db: Session = Depends(get_db)) -> list[dict]:
    return model_service.list_provider_configs(db)


@router.get("/mobile-image-routes")
def list_mobile_image_routes(db: Session = Depends(get_db)) -> list[dict]:
    return model_service.list_mobile_image_routes(db)


@router.get("/registry")
def list_registry() -> dict:
    return model_service.list_model_registry()


@router.post("/providers")
def create_provider(payload: ProviderConfigCreate, db: Session = Depends(get_db)) -> dict:
    try:
        return model_service.create_provider_config(db, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=redact_text(str(exc))) from exc


@router.post("/configs")
def save_provider_config(payload: ProviderConfigSave, db: Session = Depends(get_db)) -> dict:
    try:
        return model_service.save_provider_config(db, payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=redact_text(str(exc))) from exc


@router.post("/mobile-image-routes")
def save_mobile_image_route(payload: ProviderConfigSave, db: Session = Depends(get_db)) -> dict:
    try:
        return model_service.ensure_mobile_image_route(db, payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=redact_text(str(exc))) from exc


@router.post("/mobile-routes")
def save_mobile_model_route(payload: ProviderConfigSave, db: Session = Depends(get_db)) -> dict:
    try:
        return model_service.ensure_mobile_model_route(db, payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=redact_text(str(exc))) from exc


@router.patch("/providers/{config_id}")
def update_provider(config_id: int, payload: ProviderConfigUpdate, db: Session = Depends(get_db)) -> dict:
    try:
        config = model_service.update_provider_config(db, config_id, payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=redact_text(str(exc))) from exc
    if config is None:
        raise HTTPException(status_code=404, detail="Provider config not found")
    return config


@router.delete("/providers/{config_id}/api-key")
def clear_provider_api_key(config_id: int, db: Session = Depends(get_db)) -> dict:
    config = model_service.clear_provider_api_key(db, config_id)
    if config is None:
        raise HTTPException(status_code=404, detail="Provider config not found")
    return config


@router.post("/providers/{config_id}/validate")
def validate_provider(config_id: int, db: Session = Depends(get_db)) -> dict:
    result = model_service.validate_provider_config(db, config_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Provider config not found")
    return result


@router.post("/test")
def test_model_connection(payload: ModelConnectivityTestRequest, db: Session = Depends(get_db)) -> dict:
    return _public_connectivity_result(model_service.test_model_connection(db, payload.model_dump()))


@router.post("/test-all")
def test_all_configured_models(payload: TestAllConfiguredModelsRequest, db: Session = Depends(get_db)) -> list[dict]:
    return [
        _public_connectivity_result(result)
        for result in model_service.test_all_configured_models(db, payload.model_dump())
    ]


def _public_connectivity_result(result: dict) -> dict:
    """Rebuild the public result without forwarding provider-controlled diagnostics."""
    ok = result.get("ok") is True
    error_type_value = result.get("error_type")
    error_type = error_type_value if isinstance(error_type_value, str) and error_type_value in _PUBLIC_CONNECTIVITY_ERRORS else None
    if not ok and error_type is None:
        error_type = "unknown_error"

    release_status_value = result.get("release_status")
    release_status = (
        release_status_value
        if isinstance(release_status_value, str) and release_status_value in _PUBLIC_RELEASE_STATUSES
        else ("PASS" if ok else "CODE_FAILURE")
    )
    verification_source_value = result.get("verification_source")
    verification_source = (
        verification_source_value
        if isinstance(verification_source_value, str) and verification_source_value in _PUBLIC_VERIFICATION_SOURCES
        else None
    )

    return {
        "ok": ok,
        "provider_id": _public_string(result.get("provider_id")),
        "model_id": _public_string(result.get("model_id")),
        "model_id_used": _public_string(result.get("model_id_used")),
        "display_name": _public_string(result.get("display_name")),
        "capability": _public_string(result.get("capability")),
        "routing_mode": _public_string(result.get("routing_mode")),
        "compatibility_mode": _public_string(result.get("compatibility_mode")),
        "base_url_used": _public_optional_string(result.get("base_url_used")),
        "endpoint_used": _public_optional_string(result.get("endpoint_used")),
        "timeout_sec": _public_optional_int(result.get("timeout_sec")),
        "status_code": _public_optional_int(result.get("status_code")),
        "latency_ms": _public_optional_int(result.get("latency_ms")),
        "response_preview": "Connection verified." if ok else None,
        "normalized_output": "Connection verified." if ok else None,
        "error_type": error_type,
        "error": _PUBLIC_CONNECTIVITY_ERRORS.get(error_type) if error_type else None,
        "cost_risk": result.get("cost_risk") is True,
        "live_tested": result.get("live_tested") is True,
        "request_attempted": result.get("request_attempted") is True,
        "response_received": result.get("response_received") is True,
        "release_status": release_status,
        "fallback_used": result.get("fallback_used") is True,
        "verification_source": verification_source,
        "verified_task_id": _public_optional_int(result.get("verified_task_id")),
    }


def _public_string(value: object) -> str:
    return value if isinstance(value, str) else ""


def _public_optional_string(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _public_optional_int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


@router.get("/capabilities")
def list_capabilities() -> list[str]:
    return model_service.list_capabilities()


@router.get("/module-preferences")
def list_module_preferences(db: Session = Depends(get_db)) -> list[dict]:
    return model_service.list_module_preferences(db)


@router.patch("/module-preferences/{module_name}")
def update_module_preferences(module_name: str, payload: ModulePreferenceUpdate, db: Session = Depends(get_db)) -> dict:
    return model_service.update_module_preference(db, module_name, payload.model_dump(exclude_unset=True))
