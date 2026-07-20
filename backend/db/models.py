from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )


class Project(Base, TimestampMixin):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    client_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    style_tags: Mapped[str | None] = mapped_column(Text, nullable=True)
    room_types: Mapped[str | None] = mapped_column(Text, nullable=True)
    budget_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    budget_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    cover_asset_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(64), default="active")
    archive_root_path: Mapped[str] = mapped_column(String(500))


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), nullable=True)
    type: Mapped[str] = mapped_column(String(64))
    file_name: Mapped[str] = mapped_column(String(255))
    file_path: Mapped[str] = mapped_column(String(500))
    mime_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source: Mapped[str | None] = mapped_column(String(128), nullable=True)
    room_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    version_no: Mapped[int] = mapped_column(Integer, default=1)
    parent_asset_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Task(Base, TimestampMixin):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), nullable=True)
    template_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    module: Mapped[str] = mapped_column(String(128))
    task_type: Mapped[str] = mapped_column(String(128))
    provider: Mapped[str] = mapped_column(String(128))
    model_name: Mapped[str] = mapped_column(String(255))
    provider_config_id: Mapped[int | None] = mapped_column(ForeignKey("model_configs.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    input_payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    output_payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    prompt_snapshot_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    params_snapshot_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PromptTemplate(Base, TimestampMixin):
    __tablename__ = "prompt_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    module: Mapped[str] = mapped_column(String(128))
    scope: Mapped[str] = mapped_column(String(64), default="project")
    system_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_prompt: Mapped[str] = mapped_column(Text)
    negative_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    variables_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(Integer, default=1)


class ModelConfig(Base, TimestampMixin):
    __tablename__ = "model_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    provider_type: Mapped[str] = mapped_column(String(128))
    provider_name: Mapped[str] = mapped_column(String(128))
    routing_mode: Mapped[str] = mapped_column(String(64), default="direct_api")
    endpoint: Mapped[str | None] = mapped_column(String(500), nullable=True)
    base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    api_key_encrypted: Mapped[str | None] = mapped_column(String(500), nullable=True)
    model_name: Mapped[str] = mapped_column(String(255))
    capabilities_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    timeout_sec: Mapped[int] = mapped_column(Integer, default=120)
    max_concurrency: Mapped[int] = mapped_column(Integer, default=2)
    headers_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    query_params_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload_template_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_mapping_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    priority: Mapped[int] = mapped_column(Integer, default=100)
    tags_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    extra_config_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class ModuleModelPreference(Base, TimestampMixin):
    __tablename__ = "module_model_preferences"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    module_name: Mapped[str] = mapped_column(String(128), unique=True)
    priority_order_json: Mapped[str] = mapped_column(Text)
    default_provider_config_id: Mapped[int | None] = mapped_column(ForeignKey("model_configs.id"), nullable=True)
    fallback_enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class CustomTaskTemplate(Base, TimestampMixin):
    __tablename__ = "custom_task_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    module_chain_json: Mapped[str] = mapped_column(Text)
    input_schema_json: Mapped[str] = mapped_column(Text)
    output_schema_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    default_provider: Mapped[str | None] = mapped_column(String(128), nullable=True)
    default_model: Mapped[str | None] = mapped_column(String(255), nullable=True)
    default_prompt_template_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    export_rules_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_team_visible: Mapped[bool] = mapped_column(Boolean, default=True)
    version: Mapped[int] = mapped_column(Integer, default=1)


class ExportRecord(Base):
    __tablename__ = "exports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), nullable=True)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"), nullable=True)
    type: Mapped[str] = mapped_column(String(64))
    file_path: Mapped[str] = mapped_column(String(500))
    file_name: Mapped[str] = mapped_column(String(255))
    export_config_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ExtractedItem(Base):
    __tablename__ = "extracted_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), nullable=True)
    asset_id: Mapped[int | None] = mapped_column(ForeignKey("assets.id"), nullable=True)
    room_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    category: Mapped[str | None] = mapped_column(String(128), nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    bbox_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    material: Mapped[str | None] = mapped_column(String(255), nullable=True)
    color: Mapped[str | None] = mapped_column(String(255), nullable=True)
    price_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class BoardDocument(Base, TimestampMixin):
    __tablename__ = "board_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), nullable=True)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"), nullable=True)
    board_type: Mapped[str] = mapped_column(String(128))
    title: Mapped[str] = mapped_column(String(255))
    layout_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    data_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    preview_asset_id: Mapped[int | None] = mapped_column(Integer, nullable=True)


class ProjectVersion(Base):
    __tablename__ = "project_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    version_name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    snapshot_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
