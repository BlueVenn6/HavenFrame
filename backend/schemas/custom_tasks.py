from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class CustomTaskTemplateCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    module_chain_json: list[str] = Field(min_length=1, max_length=20)
    input_schema_json: dict[str, Any]
    output_schema_json: dict[str, Any] | None = None
    default_provider: str | None = Field(default=None, max_length=128)
    default_model: str | None = Field(default=None, max_length=255)
    default_prompt_template_id: int | None = None
    export_rules_json: dict[str, Any] | None = None
    is_team_visible: bool = False
    version: int = Field(default=1, ge=1)


class CustomTaskTemplateUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    module_chain_json: list[str] | None = Field(default=None, min_length=1, max_length=20)
    input_schema_json: dict[str, Any] | None = None
    output_schema_json: dict[str, Any] | None = None
    default_provider: str | None = Field(default=None, max_length=128)
    default_model: str | None = Field(default=None, max_length=255)
    default_prompt_template_id: int | None = None
    export_rules_json: dict[str, Any] | None = None
    is_team_visible: bool | None = None
    version: int | None = Field(default=None, ge=1)
