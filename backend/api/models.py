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
    """Keep provider diagnostics internal while returning stable UI-safe fields."""
    public_result = dict(result)
    public_result.pop("raw_error_preview", None)
    return public_result


@router.get("/capabilities")
def list_capabilities() -> list[str]:
    return model_service.list_capabilities()


@router.get("/module-preferences")
def list_module_preferences(db: Session = Depends(get_db)) -> list[dict]:
    return model_service.list_module_preferences(db)


@router.patch("/module-preferences/{module_name}")
def update_module_preferences(module_name: str, payload: ModulePreferenceUpdate, db: Session = Depends(get_db)) -> dict:
    return model_service.update_module_preference(db, module_name, payload.model_dump(exclude_unset=True))
