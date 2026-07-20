from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


RoutingMode = Literal["direct_api", "relay_base_url"]
CompatibilityMode = Literal["native", "openai_compatible", "gemini_compatible", "custom_rest"]


class ProviderConfigCreate(BaseModel):
    provider_type: str
    provider_name: str
    routing_mode: str = "direct_api"
    endpoint: str | None = None
    base_url: str | None = None
    api_key_encrypted: str | None = None
    model_name: str
    capabilities_json: list[str] = Field(default_factory=list)
    timeout_sec: int = Field(default=120, ge=5, le=1800)
    max_concurrency: int = 2
    headers_json: str | None = None
    query_params_json: str | None = None
    payload_template_json: str | None = None
    response_mapping_json: str | None = None
    is_default: bool = False
    is_enabled: bool = True
    priority: int = 100
    tags_json: list[str] = Field(default_factory=list)
    extra_config_json: dict = Field(default_factory=dict)


class ProviderConfigUpdate(BaseModel):
    provider_type: str | None = None
    provider_name: str | None = None
    routing_mode: str | None = None
    endpoint: str | None = None
    base_url: str | None = None
    api_key_encrypted: str | None = None
    model_name: str | None = None
    capabilities_json: list[str] | None = None
    timeout_sec: int | None = Field(default=None, ge=5, le=1800)
    max_concurrency: int | None = None
    headers_json: str | None = None
    query_params_json: str | None = None
    payload_template_json: str | None = None
    response_mapping_json: str | None = None
    is_default: bool | None = None
    is_enabled: bool | None = None
    priority: int | None = None
    tags_json: list[str] | None = None
    extra_config_json: dict | None = None


class ProviderConfigResponse(BaseModel):
    id: int
    provider_type: str
    provider_name: str
    routing_mode: str
    endpoint: str | None = None
    base_url: str | None = None
    model_name: str
    capabilities_json: list[str] | None = None
    timeout_sec: int
    max_concurrency: int
    is_default: bool
    is_enabled: bool
    priority: int
    tags_json: list[str] | None = None
    extra_config_json: dict | None = None
    created_at: datetime
    updated_at: datetime


class ProviderValidationResponse(BaseModel):
    id: int
    status: str
    provider_name: str
    routing_mode: str
    message: str


class ProviderConfigSave(BaseModel):
    id: int | None = None
    provider_id: str | None = None
    provider_type: str | None = None
    provider_name: str
    routing_mode: RoutingMode = "direct_api"
    compatibility_mode: CompatibilityMode = "native"
    endpoint: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    api_key_encrypted: str | None = None
    model_name: str
    model_id: str | None = None
    display_name: str | None = None
    capabilities_json: list[str] = Field(default_factory=list)
    timeout_sec: int = Field(default=30, ge=5, le=1800)
    max_concurrency: int = 2
    headers_json: dict | str | None = None
    query_params_json: dict | str | None = None
    payload_template_json: dict | str | None = None
    response_mapping_json: dict | str | None = None
    is_default: bool = False
    is_enabled: bool = True
    priority: int = 100
    tags_json: list[str] = Field(default_factory=list)
    extra_config_json: dict = Field(default_factory=dict)
    api_key_name: str | None = None


class ModelConnectivityTestRequest(BaseModel):
    provider_config_id: int | None = None
    provider_id: str
    provider_label: str | None = None
    model_id: str
    model_label: str | None = None
    capability: str = "text"
    routing_mode: RoutingMode = "direct_api"
    compatibility_mode: CompatibilityMode = "native"
    base_url: str | None = None
    endpoint_path: str | None = None
    api_key: str | None = None
    access_key: str | None = None
    secret_key: str | None = None
    region: str | None = None
    headers_json: dict | str | None = None
    body_template_json: dict | str | None = None
    test_prompt: str = "Return the word OK."
    timeout_sec: int = 30
    include_costly: bool = False


class ModelConnectivityTestResponse(BaseModel):
    ok: bool
    provider_id: str
    model_id: str
    routing_mode: str
    compatibility_mode: str | None = None
    base_url_used: str | None = None
    endpoint_used: str | None = None
    status_code: int | None = None
    latency_ms: int | None = None
    response_preview: str | None = None
    normalized_output: str | None = None
    error_type: str | None = None
    error: str | None = None
    raw_error_preview: str | None = None


class TestAllConfiguredModelsRequest(BaseModel):
    include_cost_risk: bool = False
    include_costly: bool = False
    routing_modes: list[RoutingMode] = Field(default_factory=lambda: ["direct_api", "relay_base_url"])
    capabilities: list[str] = Field(default_factory=list)
    test_prompt: str = "Return the word OK."


class ModulePreferenceUpdate(BaseModel):
    priority_order_json: list[str] | None = None
    default_provider_config_id: int | None = None
    fallback_enabled: bool | None = None
