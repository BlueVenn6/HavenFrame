from __future__ import annotations

import os
from dataclasses import asdict, dataclass


API_PROFILE_DESKTOP_CLIENT = "desktop_client"
API_PROFILE_CLOUD = "cloud"
SUPPORTED_API_PROFILES = {API_PROFILE_DESKTOP_CLIENT, API_PROFILE_CLOUD}


@dataclass(frozen=True)
class PlatformCapabilities:
    api_profile: str
    local_file_open: bool
    cloud_api: bool

    def as_dict(self) -> dict[str, str | bool]:
        return asdict(self)


def current_api_profile() -> str:
    value = os.getenv("QIGOU_API_PROFILE", API_PROFILE_DESKTOP_CLIENT).strip().lower()
    if value not in SUPPORTED_API_PROFILES:
        supported = ", ".join(sorted(SUPPORTED_API_PROFILES))
        raise RuntimeError(f"QIGOU_API_PROFILE must be one of: {supported}.")
    return value


def current_platform_capabilities() -> PlatformCapabilities:
    profile = current_api_profile()
    desktop_client = profile == API_PROFILE_DESKTOP_CLIENT
    return PlatformCapabilities(
        api_profile=profile,
        local_file_open=desktop_client,
        cloud_api=profile == API_PROFILE_CLOUD,
    )

