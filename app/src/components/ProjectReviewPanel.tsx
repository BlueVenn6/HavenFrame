import { useReviewStore } from "../stores/useReviewStore";
import { taskRuntimeLabel } from "../lib/model-route-labels";
import { localeLabel } from "../lib/zh-labels";
import { useModelStore } from "../stores/useModelStore";
import type { TaskRecord } from "../types";
import { useLocale } from "../i18n/locale";

export function ProjectReviewPanel({ projectId }: { projectId: number }) {
  const { locale, text } = useLocale();
  const providerConfigs = useModelStore((state) => state.providerConfigs);
  const getSnapshot = useReviewStore((state) => state.getSnapshot);
  const activeTab = useReviewStore((state) => state.activeTab);
  const setActiveTab = useReviewStore((state) => state.setActiveTab);
  const selectedReplayTaskId = useReviewStore((state) => state.selectedReplayTaskId);
  const setSelectedReplayTaskId = useReviewStore((state) => state.setSelectedReplayTaskId);
  const snapshot = getSnapshot(projectId);
  const selectedReplay =
    snapshot?.replay_entries.find((entry) => entry.task_id === selectedReplayTaskId) ??
    snapshot?.replay_entries[0];

  if (!snapshot) {
    return null;
  }

  return (
    <div className="panel-surface p-5">
      <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="eyebrow">{text("复盘 / 重放", "Review / Replay")}</div>
          <h3 className="section-title mt-2">{text("项目版本归档", "Project version archive")}</h3>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("review")}
            className={activeTab === "review" ? "btn-primary" : "btn-secondary"}
          >
            {text("复盘", "Review")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("replay")}
            className={activeTab === "replay" ? "btn-primary" : "btn-secondary"}
          >
            {text("重放", "Replay")}
          </button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <div className="panel-muted p-4">
          <div className="eyebrow">{text("素材", "Assets")}</div>
          <div className="mt-2 text-2xl font-semibold text-studio-navy">{snapshot.summary.asset_count}</div>
        </div>
        <div className="panel-muted p-4">
          <div className="eyebrow">{text("任务", "Tasks")}</div>
          <div className="mt-2 text-2xl font-semibold text-studio-navy">{snapshot.summary.task_count}</div>
        </div>
        <div className="panel-muted p-4">
          <div className="eyebrow">{text("导出", "Exports")}</div>
          <div className="mt-2 text-2xl font-semibold text-studio-navy">{snapshot.summary.export_count}</div>
        </div>
        <div className="panel-muted p-4">
          <div className="eyebrow">{text("提取元素", "Extracted items")}</div>
          <div className="mt-2 text-2xl font-semibold text-studio-navy">
            {snapshot.summary.extracted_item_count ?? snapshot.extracted_items?.length ?? 0}
          </div>
        </div>
        <div className="panel-muted p-4">
          <div className="eyebrow">{text("最近供应商", "Latest provider")}</div>
          <div className="mt-2 text-lg font-semibold text-studio-navy">{localeLabel(snapshot.summary.latest_provider, locale) || text("暂无", "None")}</div>
        </div>
      </div>

      {activeTab === "review" ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="panel-muted p-4">
            <div className="font-medium text-studio-navy">{text("版本", "Versions")}</div>
            <div className="mt-3 space-y-3">
              {snapshot.versions.map((version) => (
                <div key={version.id}>
                  <div className="text-sm font-medium text-studio-ink">{version.version_name}</div>
                  <div className="text-xs text-studio-mutedText">{version.description}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="panel-muted p-4">
            <div className="font-medium text-studio-navy">{text("导出记录", "Export history")}</div>
            <div className="mt-3 space-y-3">
              {snapshot.exports.map((record) => (
                <div key={record.id}>
                  <div className="text-sm font-medium text-studio-ink">{record.file_name}</div>
                  <div className="text-xs text-studio-mutedText">{record.file_path}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-3">
            {snapshot.replay_entries.map((entry) => (
              <button
                key={entry.task_id}
                type="button"
                onClick={() => setSelectedReplayTaskId(entry.task_id)}
                className={`panel-muted w-full p-4 text-left transition ${
                  selectedReplay?.task_id === entry.task_id ? "border-teal-500 bg-teal-50/50" : "hover:border-teal-300"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-studio-navy">{localeLabel(entry.task_type, locale)}</div>
                    <div className="text-xs text-studio-mutedText">
                      {taskRuntimeLabel(entryAsTask(entry), providerConfigs.find((config) => config.provider_name === entry.provider && (config.model_id ?? config.model_name) === entry.model_name), locale)}
                    </div>
                  </div>
                  <span className="tag-chip">{localeLabel(entry.status, locale)}</span>
                </div>
              </button>
            ))}
          </div>
          <div className="panel-muted p-5">
            <div className="eyebrow">{text("重放详情", "Replay details")}</div>
            <h4 className="mt-2 text-xl font-semibold text-studio-navy">{localeLabel(selectedReplay?.task_type, locale)}</h4>
            <p className="mt-2 text-sm text-studio-mutedText">{selectedReplay?.prompt}</p>
            <pre className="mt-4 overflow-auto rounded-lg border border-studio-border bg-white p-4 text-xs text-studio-ink">
              {JSON.stringify(selectedReplay?.params ?? {}, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function entryAsTask(entry: { task_id: number; module: string; task_type: string; provider: string; model_name: string; status: string; created_at: string }): TaskRecord {
  return {
    id: entry.task_id,
    module: entry.module,
    task_type: entry.task_type,
    provider: entry.provider,
    model_name: entry.model_name,
    status: entry.status as TaskRecord["status"],
    progress: 0,
    created_at: entry.created_at,
    updated_at: entry.created_at,
  };
}
