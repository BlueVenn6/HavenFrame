from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ExportImageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: int | None = None
    task_id: int | None = None
    asset_id: int = Field(ge=1)
    file_name: str = Field(min_length=1, max_length=180)
    export_config_json: dict[str, Any] = Field(default_factory=dict)


class ExportReportImageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: int
    task_id: int | None = None
    file_name: str = Field(min_length=1, max_length=180)
    title: str = Field(default="栖构图片报告", min_length=1, max_length=255)
    board_document_ids: list[int] = Field(min_length=1, max_length=100)
    mode: Literal["single", "multi"]
    source_asset_ids: list[int] = Field(min_length=1, max_length=100)
    selected_item_ids: list[int] = Field(default_factory=list, max_length=500)
    review_snapshot: str = Field(min_length=1, max_length=20_000)
    generated_asset_id: int | None = Field(default=None, ge=1)
    delivery_prompt_version: str = Field(default="qigou-board-delivery-v2", min_length=1, max_length=64)
    output_language: Literal["zh-CN", "en"] = "zh-CN"
    export_config_json: dict[str, Any] = Field(default_factory=dict)


class ExportTableRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: int
    task_id: int | None = None
    file_name: str = Field(min_length=1, max_length=180)
    asset_ids: list[int] = Field(default_factory=list, max_length=100)
    selected_item_ids: list[int] = Field(default_factory=list, max_length=500)
    review_snapshot: str | None = Field(default=None, max_length=20_000)
    selected_only: bool = False
    output_language: Literal["zh-CN", "en"] = "zh-CN"
    export_config_json: dict[str, Any] = Field(default_factory=dict)
