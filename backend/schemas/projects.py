from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ProjectCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    client_name: str | None = Field(default=None, max_length=255)
    style_tags: str | None = Field(default=None, max_length=2000)
    room_types: str | None = Field(default=None, max_length=2000)
    budget_min: float | None = Field(default=None, ge=0)
    budget_max: float | None = Field(default=None, ge=0)
    description: str | None = Field(default=None, max_length=10000)
    archive_root_path: str | None = Field(default=None, max_length=500)
    status: str = Field(default="active", min_length=1, max_length=64)

    @model_validator(mode="after")
    def validate_budget_range(self):
        if self.budget_min is not None and self.budget_max is not None and self.budget_min > self.budget_max:
            raise ValueError("最低预算不能高于最高预算。")
        return self


class ProjectUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    client_name: str | None = Field(default=None, max_length=255)
    style_tags: str | None = Field(default=None, max_length=2000)
    room_types: str | None = Field(default=None, max_length=2000)
    budget_min: float | None = Field(default=None, ge=0)
    budget_max: float | None = Field(default=None, ge=0)
    description: str | None = Field(default=None, max_length=10000)
    archive_root_path: str | None = Field(default=None, max_length=500)
    status: str | None = Field(default=None, min_length=1, max_length=64)
