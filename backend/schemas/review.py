from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ProjectVersionCreate(BaseModel):
    version_name: str
    description: str | None = None
    snapshot_json: dict[str, Any] = Field(default_factory=dict)


class ReviewReplayEntry(BaseModel):
    task_id: int
    module: str
    task_type: str
    provider: str
    model_name: str
    status: str
    prompt: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | str


class ProjectReviewResponse(BaseModel):
    project: dict[str, Any]
    task_history: list[dict[str, Any]]
    exports: list[dict[str, Any]]
    versions: list[dict[str, Any]]
    replay_entries: list[ReviewReplayEntry]
    summary: dict[str, Any]


class ReplayResponse(BaseModel):
    project: dict[str, Any]
    task: dict[str, Any]
    steps: list[dict[str, Any]]
    message: str
