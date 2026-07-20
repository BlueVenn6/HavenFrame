from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from backend.db.models import Task


ACTIVE_TASK_STATES = {"queued", "running"}
RUNNING_TASK_STATES = {"running"}


@dataclass(frozen=True)
class TaskLimitPolicy:
    max_active_tasks: int
    max_running_tasks: int
    max_provider_running: int
    max_project_running: int
    max_retries: int


def current_task_limit_policy() -> TaskLimitPolicy:
    return TaskLimitPolicy(
        max_active_tasks=_env_int("QIGOU_MAX_ACTIVE_TASKS", 50),
        max_running_tasks=_env_int("QIGOU_MAX_RUNNING_TASKS", 4),
        max_provider_running=_env_int("QIGOU_MAX_PROVIDER_RUNNING_TASKS", 2),
        max_project_running=_env_int("QIGOU_MAX_PROJECT_RUNNING_TASKS", 3),
        max_retries=_env_int("QIGOU_MAX_TASK_RETRIES", 1),
    )


def enforce_task_create_limits(
    db: Session,
    *,
    provider: str,
    project_id: int | None,
    task_type: str,
) -> None:
    policy = current_task_limit_policy()
    active_count = _count_tasks(db, statuses=ACTIVE_TASK_STATES)
    if active_count >= policy.max_active_tasks:
        raise ValueError(f"任务队列已满，当前最多允许 {policy.max_active_tasks} 个排队/运行任务。")

    running_count = _count_tasks(db, statuses=RUNNING_TASK_STATES)
    if running_count >= policy.max_running_tasks and _starts_immediately(task_type):
        raise ValueError(f"当前运行任务已达到全局并发上限 {policy.max_running_tasks}。")

    provider_running = _count_tasks(db, statuses=RUNNING_TASK_STATES, provider=provider)
    if provider_running >= policy.max_provider_running and _starts_immediately(task_type):
        raise ValueError(f"Provider 当前运行任务已达到并发上限 {policy.max_provider_running}。")

    if project_id is not None:
        project_running = _count_tasks(db, statuses=RUNNING_TASK_STATES, project_id=project_id)
        if project_running >= policy.max_project_running and _starts_immediately(task_type):
            raise ValueError(f"当前项目运行任务已达到并发上限 {policy.max_project_running}。")


def enforce_task_retry_limit(task: Task) -> None:
    policy = current_task_limit_policy()
    if int(task.retry_count or 0) >= policy.max_retries:
        raise ValueError(f"任务重试次数已达到上限 {policy.max_retries}。")


def task_is_cancelled(db: Session, task_id: int) -> bool:
    task = db.get(Task, task_id)
    return task is None or task.status == "cancelled"


def ensure_task_not_cancelled(db: Session, task_id: int) -> None:
    if task_is_cancelled(db, task_id):
        raise ValueError("任务已取消，停止后台执行。")


def _count_tasks(
    db: Session,
    *,
    statuses: set[str],
    provider: str | None = None,
    project_id: int | None = None,
) -> int:
    query = db.query(Task).filter(Task.status.in_(tuple(statuses)))
    if provider is not None:
        query = query.filter(Task.provider == provider)
    if project_id is not None:
        query = query.filter(Task.project_id == project_id)
    return int(query.count())


def _starts_immediately(task_type: str) -> bool:
    return task_type.startswith("provider")


def _env_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, ""))
    except ValueError:
        return default
    return value if value > 0 else default
