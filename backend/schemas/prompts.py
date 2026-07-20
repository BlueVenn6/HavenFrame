from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class _PromptTemplateBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("name", "module", "user_prompt", check_fields=False)
    @classmethod
    def reject_blank_values(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("value must not be blank")
        return value.strip() if value is not None else value

    @field_validator("variables_json", check_fields=False)
    @classmethod
    def validate_variables(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        normalized: list[str] = []
        for variable in value:
            item = variable.strip()
            if not item or len(item) > 64 or not item.replace("_", "a").isalnum():
                raise ValueError("variables must contain only letters, numbers, and underscores")
            if item not in normalized:
                normalized.append(item)
        return normalized


class PromptTemplateCreate(_PromptTemplateBase):
    name: str = Field(min_length=1, max_length=255)
    module: str = Field(min_length=1, max_length=128)
    scope: str = Field(default="project", min_length=1, max_length=64)
    system_prompt: str | None = Field(default=None, max_length=20_000)
    user_prompt: str = Field(min_length=1, max_length=50_000)
    negative_prompt: str | None = Field(default=None, max_length=20_000)
    variables_json: list[str] = Field(default_factory=list, max_length=100)
    is_builtin: bool = False
    is_favorite: bool = False
    version: int = Field(default=1, ge=1)


class PromptTemplateUpdate(_PromptTemplateBase):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    module: str | None = Field(default=None, min_length=1, max_length=128)
    scope: str | None = Field(default=None, min_length=1, max_length=64)
    system_prompt: str | None = Field(default=None, max_length=20_000)
    user_prompt: str | None = Field(default=None, min_length=1, max_length=50_000)
    negative_prompt: str | None = Field(default=None, max_length=20_000)
    variables_json: list[str] | None = Field(default=None, max_length=100)
    is_builtin: bool | None = None
    is_favorite: bool | None = None
    version: int | None = Field(default=None, ge=1)


class PromptTemplateResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: int
    name: str
    module: str
    scope: str
    system_prompt: str | None = None
    user_prompt: str
    negative_prompt: str | None = None
    variables_json: list[str] | None = None
    is_builtin: bool
    is_favorite: bool
    version: int
    created_at: datetime
    updated_at: datetime
