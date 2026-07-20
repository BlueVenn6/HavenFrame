from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ProviderImageTaskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: int = Field(ge=1)
    module: Literal["floorplan", "single_room_board", "multi_room_board", "space_render", "custom_tasks"]
    task_type: Literal[
        "provider_image_generation",
        "provider_floorplan_render",
        "provider_single_room_board",
        "provider_multi_room_board",
        "provider_space_render",
        "provider_custom_task",
    ] = "provider_image_generation"
    capability: Literal["image_generation", "text_to_image", "image_to_image", "multi_image_composition", "inpaint"] = "image_to_image"
    provider: str = Field(default="OpenAI", min_length=1, max_length=128)
    model_name: str = Field(default="gpt-image-2", min_length=1, max_length=255)
    provider_config_id: int | None = Field(default=None, ge=1)
    payload_summary: str | None = Field(default=None, max_length=2000)
    payload_json: dict[str, Any] = Field(default_factory=dict)
    prompt_snapshot: dict[str, Any] = Field(default_factory=dict)
    params_snapshot: dict[str, Any] = Field(default_factory=dict)
    data_flow_confirmed: bool = False
    allow_provider_fallback: bool = False
