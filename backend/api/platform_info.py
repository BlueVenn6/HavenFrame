from fastapi import APIRouter

from backend.core.platform_capabilities import current_platform_capabilities


router = APIRouter(prefix="/api/platform", tags=["platform"])


@router.get("/capabilities")
def platform_capabilities() -> dict[str, str | bool]:
    return current_platform_capabilities().as_dict()

