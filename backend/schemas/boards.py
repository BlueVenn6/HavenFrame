from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class _BoardRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ExtractItemsRequest(_BoardRequest):
    project_id: int = Field(ge=1)
    asset_id: int = Field(ge=1)
    room_type: str = Field(default="客厅", min_length=1, max_length=128)
    style: str = Field(default="柔和极简", min_length=1, max_length=255)
    must_keep: list[str] = Field(default_factory=list, max_length=100)
    provider_name: str | None = Field(default=None, max_length=128)
    model_name: str | None = Field(default=None, max_length=255)
    provider_config_id: int | None = Field(default=None, ge=1)
    workflow_slot: Literal["room_board.extraction", "multi_room_board.extraction", "space_render.extraction"] | None = None
    output_language: Literal["zh-CN", "en"] = "zh-CN"
    data_flow_confirmed: bool = False


class ExtractedItemUpdateRequest(_BoardRequest):
    selection_state: Literal["keep", "remove", "replace", "undecided"] | None = None
    notes: str | None = Field(default=None, max_length=5000)
    replacement_notes: str | None = Field(default=None, max_length=5000)
    price_min: float | None = Field(default=None, ge=0)
    price_max: float | None = Field(default=None, ge=0)
    procurement_status: Literal["pending", "purchased"] | None = None
    quantity: int | None = Field(default=None, ge=1, le=10000)
    purchase_method: str | None = Field(default=None, max_length=255)
    purchase_url: str | None = Field(default=None, max_length=2000)

    @field_validator("purchase_url")
    @classmethod
    def validate_purchase_url(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return value
        normalized = value.strip()
        if not normalized.lower().startswith(("https://", "http://")):
            raise ValueError("购买链接必须使用 http:// 或 https://")
        return normalized
    task_id: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_budget_range(self):
        if self.price_min is not None and self.price_max is not None and self.price_min > self.price_max:
            raise ValueError("最低预算不能高于最高预算")
        return self


class SingleRoomBoardRequest(_BoardRequest):
    project_id: int = Field(ge=1)
    asset_id: int = Field(ge=1)
    room_type: str = Field(default="客厅", min_length=1, max_length=128)
    style: str = Field(default="柔和极简", min_length=1, max_length=255)
    selected_item_ids: list[int] = Field(default_factory=list, max_length=200)
    keep_items: list[str] = Field(default_factory=list, max_length=100)
    replace_items: list[str] = Field(default_factory=list, max_length=100)
    prompt_template_id: int | None = Field(default=None, ge=1)
    custom_prompt: str | None = Field(default=None, max_length=20_000)
    negative_prompt: str | None = Field(default=None, max_length=10_000)
    provider_name: str | None = Field(default=None, max_length=128)
    model_name: str | None = Field(default=None, max_length=255)
    provider_config_id: int | None = Field(default=None, ge=1)
    params_snapshot: dict[str, Any] = Field(default_factory=dict)


class QuoteGenerationRequest(_BoardRequest):
    project_id: int = Field(ge=1)
    task_id: int | None = Field(default=None, ge=1)
    asset_id: int | None = Field(default=None, ge=1)
    room_type: str = Field(default="客厅", min_length=1, max_length=128)
    selected_item_ids: list[int] = Field(default_factory=list, max_length=200)
    budget_label: str = Field(default="中档", min_length=1, max_length=128)


class MultiRoomBoardRequest(_BoardRequest):
    project_id: int = Field(ge=1)
    asset_ids: list[int] = Field(min_length=2, max_length=100)
    selected_item_ids: list[int] = Field(default_factory=list, max_length=500)
    room_tags: dict[str, str] = Field(default_factory=dict)
    style_consistency: float = Field(default=0.8, ge=0, le=1)
    integrated_board_title: str = Field(default="整屋综合方案板", min_length=1, max_length=255)
    provider_name: str | None = Field(default=None, max_length=128)
    model_name: str | None = Field(default=None, max_length=255)
    provider_config_id: int | None = Field(default=None, ge=1)
    params_snapshot: dict[str, Any] = Field(default_factory=dict)
