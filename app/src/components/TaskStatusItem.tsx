import type { TaskRecord } from "../types";
import { routeAddressStatus, taskRuntimeLabel } from "../lib/model-route-labels";
import { localeLabel } from "../lib/zh-labels";
import { useModelStore } from "../stores/useModelStore";
import { useLocale } from "../i18n/locale";

const tone: Record<TaskRecord["status"], string> = {
  queued: "bg-slate-100 text-slate-700",
  running: "bg-amber-100 text-amber-800",
  success: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
  cancelled: "bg-slate-200 text-slate-700",
};

export function TaskStatusItem({
  task,
  onOpen,
  onHide,
}: {
  task: TaskRecord;
  onOpen?: (taskId: number) => void;
  onHide?: (taskId: number) => void;
}) {
  const { locale, message, text } = useLocale();
  const providerConfigs = useModelStore((state) => state.providerConfigs);
  const routeConfig = providerConfigs.find((config) => config.id === task.provider_config_id)
    ?? providerConfigs.find((config) => config.provider_name === task.provider && (config.model_id ?? config.model_name) === task.model_name);

  return (
    <div className="panel-muted w-full min-w-[190px] p-3 text-left transition hover:border-studio-primary">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold capitalize text-studio-navy">{localeLabel(task.module, locale)}</div>
          <div className="mt-0.5 truncate text-xs font-medium text-studio-mutedText">
            {taskRuntimeLabel(task, routeConfig, locale)}
          </div>
          {routeConfig?.routing_mode === "relay_base_url" ? (
            <div className="mt-0.5 truncate text-xs font-semibold text-emerald-800">
              {routeAddressStatus(routeConfig, locale)}
            </div>
          ) : null}
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${tone[task.status]}`}>{localeLabel(task.status, locale)}</span>
      </div>
      <div className="mt-3 h-2 rounded-full bg-slate-200">
        <div
          className="h-2 rounded-full bg-studio-primary transition-all"
          style={{ width: `${task.progress}%` }}
        />
      </div>
      <div className="mt-2 text-xs font-semibold text-studio-primaryHover">
        {task.status === "success" ? text("点击查看结果", "View result") : task.status === "running" ? text("生成中...", "Generating...") : text("点击查看详情", "View details")}
      </div>
      <div className="mt-3 grid gap-1 text-xs font-medium text-studio-mutedText">
        <div>{text("任务 ID", "Task ID")}: #{task.id}</div>
        <div>{text("任务类型", "Task type")}: {localeLabel(task.task_type, locale)}</div>
        <div>{text("创建时间", "Created")}: {formatTime(task.created_at, locale)}</div>
        <div>{text("完成时间", "Finished")}: {formatTime(task.finished_at, locale)}</div>
        {task.status === "success" ? <div className="break-all">{text("输出", "Output")}: {outputSummaryOf(task, text)}</div> : null}
        {task.status === "failed" ? <div className="break-all text-rose-700">{text("错误", "Error")}: {message(task.error_message ?? outputErrorOf(task)) || text("未记录错误", "No error recorded")}</div> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => onOpen?.(task.id)} className="btn-secondary px-3 py-1 text-xs">
          {text("查看", "View")}
        </button>
        <button type="button" onClick={() => onHide?.(task.id)} className="btn-secondary px-3 py-1 text-xs">
          {text("隐藏", "Hide")}
        </button>
      </div>
    </div>
  );
}

function formatTime(value: string | null | undefined, locale: "zh-CN" | "en"): string {
  if (!value) return locale === "zh-CN" ? "尚未完成" : "Not finished";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale === "zh-CN" ? "zh-CN" : "en", { hour12: false });
}

function outputPathOf(task: TaskRecord): string | undefined {
  const direct = task.output_payload_json?.archive_path;
  if (typeof direct === "string") return direct;
  const assets = task.output_payload_json?.assets;
  if (Array.isArray(assets) && assets.length > 0) {
    const first = assets[0] as { file_path?: unknown };
    return typeof first.file_path === "string" ? first.file_path : undefined;
  }
  return undefined;
}

function outputSummaryOf(task: TaskRecord, text: (zh: string, en: string) => string): string {
  const path = outputPathOf(task);
  if (path) return path;
  const items = task.output_payload_json?.extracted_items;
  if (Array.isArray(items)) return text(`已写入 ${items.length} 个结构化提取项`, `${items.length} structured extraction items saved`);
  return text("任务已完成，但没有可展示的输出", "Task completed without displayable output");
}

function outputErrorOf(task: TaskRecord): string | undefined {
  const value = task.output_payload_json?.error;
  return typeof value === "string" ? value : undefined;
}
