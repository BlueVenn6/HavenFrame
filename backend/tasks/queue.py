from collections import deque
from typing import Any


class TaskQueue:
    def __init__(self) -> None:
        self._items: deque[dict[str, Any]] = deque()

    def enqueue(self, item: dict[str, Any]) -> dict[str, Any]:
        self._items.append(item)
        return item

    def snapshot(self) -> list[dict[str, Any]]:
        return list(self._items)

    def cancel(self, task_id: int) -> bool:
        updated = False
        for item in self._items:
            if item["id"] == task_id:
                item["status"] = "cancelled"
                updated = True
        return updated

    def update(self, task_id: int, patch: dict[str, Any]) -> bool:
        updated = False
        for item in self._items:
            if item["id"] == task_id:
                item.update(patch)
                updated = True
        return updated


queue_manager = TaskQueue()
