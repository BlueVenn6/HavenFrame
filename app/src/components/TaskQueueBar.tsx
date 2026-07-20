import { useEffect } from "react";

import { useLocale } from "../i18n/locale";
import { localeLabel } from "../lib/zh-labels";
import { useModelStore } from "../stores/useModelStore";
import { useTaskStore } from "../stores/useTaskStore";
import { useUIStore } from "../stores/useUIStore";
import type { TaskRecord } from "../types";
import { TaskStatusItem } from "./TaskStatusItem";

export function TaskQueueBar() {
  const { locale, text } = useLocale();
  const tasks = useTaskStore((state) => state.tasks);
  const loadTasks = useTaskStore((state) => state.loadTasks);
  const selectTask = useTaskStore((state) => state.selectTask);
  const setTaskDrawerOpen = useUIStore((state) => state.setTaskDrawerOpen);
  const taskQueueCollapsed = useUIStore((state) => state.taskQueueCollapsed);
  const setTaskQueueCollapsed = useUIStore((state) => state.setTaskQueueCollapsed);
  const hiddenTaskIds = useUIStore((state) => state.hiddenTaskIds);
  const hideTask = useUIStore((state) => state.hideTask);
  const clearHiddenTasks = useUIStore((state) => state.clearHiddenTasks);
  const loadProviderConfigs = useModelStore((state) => state.loadProviderConfigs);

  useEffect(() => {
    void loadTasks();
    void loadProviderConfigs();
    const interval = window.setInterval(() => void loadTasks(), 10000);
    return () => window.clearInterval(interval);
  }, [loadProviderConfigs, loadTasks]);

  const compactTasks = compactVisibleTasks(tasks).filter((task) => !hiddenTaskIds.includes(task.id));
  const activeTasks = compactTasks.filter((task) => task.status === "running" || task.status === "queued");
  const latestDoneTasks = compactTasks.filter((task) => task.status === "success" || task.status === "failed").slice(0, 3);
  const visibleTasks = [...activeTasks, ...latestDoneTasks].slice(0, 5);
  const latestTask = visibleTasks[0];

  return (
    <div id="task-queue" className="panel-surface mt-3 shrink-0 p-3 sm:mt-4">
      <div className={taskQueueCollapsed ? "flex items-center justify-between gap-4" : "mb-2 flex items-center justify-between gap-4"}>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-studio-navy">{text("任务队列", "Task queue")}</h3>
          <p className="truncate text-xs font-medium text-studio-mutedText">
            {latestTask ? `${localeLabel(latestTask.module, locale)} · ${localeLabel(latestTask.status, locale)}` : text("暂无任务", "No tasks")}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {hiddenTaskIds.length > 0 ? (
            <button type="button" onClick={clearHiddenTasks} className="btn-secondary px-3 py-1 text-xs">
              {text("恢复隐藏任务", "Restore hidden tasks")}
            </button>
          ) : null}
          <span className="status-pill">{activeTasks.length} {text("个进行中 / 最近", "active / latest")} {latestDoneTasks.length}</span>
          <button
            type="button"
            onClick={() => setTaskQueueCollapsed(!taskQueueCollapsed)}
            className="btn-secondary px-3 py-1 text-xs"
          >
            {taskQueueCollapsed ? text("展开", "Expand") : text("收起", "Collapse")}
          </button>
        </div>
      </div>
      {taskQueueCollapsed ? null : (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2">
        {visibleTasks.length > 0 ? visibleTasks.map((task) => (
          <TaskStatusItem
            key={task.id}
            task={task}
            onOpen={(taskId) => {
              selectTask(taskId);
              setTaskDrawerOpen(true);
            }}
            onHide={(taskId) => hideTask(taskId)}
          />
        )) : (
          <div className="rounded-lg border border-dashed border-studio-border bg-studio-panelBg px-4 py-5 text-sm font-medium text-studio-mutedText">
            {text("还没有真实任务。", "No tasks yet.")}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

function compactVisibleTasks(tasks: TaskRecord[]): TaskRecord[] {
  const succeededProviderKeys = new Set(
    tasks
      .filter((task) => task.status === "success" && task.task_type.startsWith("provider_"))
      .map(providerTaskKey),
  );
  const seen = new Set<string>();
  return tasks.filter((task) => {
    if (task.task_type.startsWith("provider_") && task.status === "failed" && succeededProviderKeys.has(providerTaskKey(task))) {
      return false;
    }
    if (task.task_type !== "extract_items" || task.status !== "failed") {
      return true;
    }
    const key = [
      task.module,
      task.task_type,
      task.model_name,
      assetIdOf(task),
      task.error_message ?? "",
    ].join(":");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function providerTaskKey(task: TaskRecord): string {
  const params = task.params_snapshot_json ?? {};
  const signature = params.request_signature;
  if (typeof signature === "string" && signature) {
    return signature;
  }
  return [
    task.module,
    task.task_type,
    task.provider,
    task.model_name,
    assetIdsOf(task),
    String(params.aspect_ratio ?? ""),
    String(params.requested_size ?? ""),
  ].join(":");
}

function assetIdOf(task: TaskRecord): string {
  const ids = assetIdsOf(task);
  return ids === "unknown" ? "unknown" : ids.split(",")[0];
}

function assetIdsOf(task: TaskRecord): string {
  const input = task.input_payload_json ?? {};
  const direct = input.asset_id;
  if (typeof direct === "number" || typeof direct === "string") {
    return String(direct);
  }
  const payload = input.payload_json;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const assetIds = (payload as Record<string, unknown>).asset_ids;
    if (Array.isArray(assetIds) && assetIds.length > 0) {
      return assetIds.map(String).sort().join(",");
    }
  }
  return "unknown";
}
