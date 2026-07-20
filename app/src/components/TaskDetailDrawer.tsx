import { aspectRatioToCss } from "../lib/aspect-ratio";
import { useLocale, type AppLocale } from "../i18n/locale";
import { routeAddressStatus, taskRuntimeLabel } from "../lib/model-route-labels";
import { localeLabel } from "../lib/zh-labels";
import { extractedResultItems, firstResultAsset } from "../lib/task-output";
import { useModelStore } from "../stores/useModelStore";
import { useTaskStore } from "../stores/useTaskStore";
import { useUIStore } from "../stores/useUIStore";
import { AssetOpenActions } from "./AssetOpenActions";
import { AssetImage } from "./AssetImage";

export function TaskDetailDrawer() {
  const { locale, message, text } = useLocale();
  const isOpen = useUIStore((state) => state.taskDrawerOpen);
  const setTaskDrawerOpen = useUIStore((state) => state.setTaskDrawerOpen);
  const selectedTaskId = useTaskStore((state) => state.selectedTaskId);
  const task = useTaskStore((state) => state.tasks.find((item) => item.id === selectedTaskId));
  const providerConfigs = useModelStore((state) => state.providerConfigs);

  if (!isOpen || !task) {
    return null;
  }

  const resultAsset = firstResultAsset(task.output_payload_json);
  const extractedItems = extractedResultItems(task.output_payload_json);
  const prompt = localizePromptSnapshot(task.prompt_snapshot_json?.resolved_prompt, locale) ?? text("还没有保存提示词。", "No prompt was saved.");
  const aspectRatio = typeof task.params_snapshot_json?.aspect_ratio === "string" ? task.params_snapshot_json.aspect_ratio : "16:9";
  const requestedSize = task.params_snapshot_json?.requested_size;
  const actualSize = task.output_payload_json?.actual_size ?? resultAsset?.metadata_json?.actual_size;
  const ratioMatched = task.output_payload_json?.ratio_matched;
  const timeoutSec = typeof task.params_snapshot_json?.timeout_sec === "number" ? task.params_snapshot_json.timeout_sec : undefined;
  const elapsedSec = elapsedSeconds(task.started_at ?? task.created_at);
  const routeConfig = providerConfigs.find((config) => config.id === task.provider_config_id)
    ?? providerConfigs.find((config) => config.provider_name === task.provider && (config.model_id ?? config.model_name) === task.model_name);

  return (
    <div className="fixed inset-y-6 right-6 z-50 flex w-[min(680px,calc(100vw-64px))] flex-col rounded-lg border border-studio-border bg-white p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow">{text("任务详情", "Task details")}</div>
          <h3 className="mt-2 text-xl font-semibold text-studio-navy">{localeLabel(task.task_type, locale)}</h3>
        </div>
        <button
          type="button"
          onClick={() => setTaskDrawerOpen(false)}
          className="btn-secondary px-3 py-1 text-sm"
        >
          {text("关闭", "Close")}
        </button>
      </div>
      <div className="workspace-scroll mt-6 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 text-sm">
        <div className="panel-muted p-4">
          <div className="font-medium text-studio-navy">{taskRuntimeLabel(task, routeConfig, locale)}</div>
          {routeConfig?.routing_mode === "relay_base_url" ? (
            <div className="mt-1 break-all text-xs font-semibold text-emerald-800">{routeAddressStatus(routeConfig, locale)}</div>
          ) : null}
          <div className="mt-2 text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{localeLabel(task.status, locale)}</div>
          {task.status === "running" ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
              {text("已运行", "Running for")} {formatDuration(elapsedSec, locale)}
              {timeoutSec ? ` / ${text("超时", "timeout")} ${formatDuration(timeoutSec, locale)}` : ""}. {text("如果超过超时时间，后端会在下次刷新时标记为失败。", "If the timeout is exceeded, the backend marks the task failed on the next refresh.")}
            </div>
          ) : null}
        </div>
        {resultAsset ? (
          <div className="panel-muted p-4">
            <div className="eyebrow">{text("生成结果", "Generation result")}</div>
            <AssetImage
              assetId={resultAsset.id}
              alt={resultAsset.file_name}
              className="mt-3 w-full rounded-lg border border-studio-border object-contain"
              style={{ aspectRatio: aspectRatioToCss(aspectRatio) }}
            />
            <div className="mt-3 grid gap-2 text-xs font-medium text-studio-mutedText sm:grid-cols-2">
              <div>{text("请求尺寸：", "Requested size: ")}{typeof requestedSize === "string" ? requestedSize : aspectRatio}</div>
              <div>{text("实际尺寸：", "Actual size: ")}{typeof actualSize === "string" ? actualSize : text("等待中", "Pending")}</div>
            </div>
            {ratioMatched === false ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                {text("模型返回的比例与请求比例不一致。", "The returned aspect ratio does not match the request.")}
              </div>
            ) : null}
            <div className="mt-3 break-all text-xs font-medium text-studio-mutedText">{resultAsset.file_path}</div>
            <AssetOpenActions asset={resultAsset} size="sm" className="mt-3" />
          </div>
        ) : null}
        {extractedItems.length > 0 ? (
          <div className="panel-muted p-4">
            <div className="eyebrow">{text("视觉提取结果", "Vision extraction result")}</div>
            <div className="mt-2 text-sm font-semibold text-studio-navy">{text("已写入", "Saved")} {extractedItems.length} {text("个结构化提取项", "structured items")}</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {extractedItems.map((item) => (
                <div key={item.id} className="min-w-0 rounded-lg border border-studio-border bg-white p-3">
                  <div className="break-words font-semibold text-studio-navy">{item.name}</div>
                  <div className="mt-1 text-xs text-studio-mutedText">
                    {[item.category, item.material, item.color].filter(Boolean).join(" · ") || text("已识别元素", "Recognized item")}
                  </div>
                  {item.color_hex ? (
                    <div className="mt-2 flex items-center gap-2 text-xs font-medium text-studio-mutedText">
                      <span className="h-4 w-4 rounded border border-studio-border" style={{ backgroundColor: item.color_hex }} />
                      {item.color_hex}
                    </div>
                  ) : null}
                  {item.notes ? <div className="mt-2 text-xs text-studio-mutedText">{item.notes}</div> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {task.error_message ? (
          <div className="soft-alert">{message(task.error_message)}</div>
        ) : null}
        <div className="panel-muted p-4">
          <div className="eyebrow">{text("提示词快照", "Prompt snapshot")}</div>
          <p className="mt-2 text-studio-ink">{prompt}</p>
        </div>
        <div className="panel-muted p-4">
          <div className="eyebrow">{text("参数", "Parameters")}</div>
          <pre className="workspace-scroll mt-2 max-h-44 overflow-auto text-xs text-studio-ink">
            {JSON.stringify(task.params_snapshot_json ?? {}, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

function localizePromptSnapshot(value: string | undefined, locale: AppLocale): string | undefined {
  if (!value) return undefined;
  if (locale === "en") return value;
  return [
    ["Create a realistic interior render that preserves the source architecture and improves furniture, material palette, and lighting.", "生成真实感室内渲染图，保留原始空间结构，并优化家具、材质配色和灯光。"],
    ["Generate exactly one result in", "请严格生成 1 张，比例为"],
    ["Room type:", "空间类型："],
    ["Living Room", "客厅"],
    ["Dining Room", "餐厅"],
    ["Bedroom", "卧室"],
    ["Style:", "风格："],
    ["Materials:", "材质："],
    ["Preserve the core structure of the uploaded image.", "请保留上传图片的核心结构。"],
    ["Final output must be exactly one image in", "最终必须只输出 1 张图片，比例为"],
    ["aspect ratio at requested size", "，请求尺寸为"],
    ["do not return a square image unless the ratio is 1:1.", "除非比例是 1:1，否则不要返回正方形图片。"],
    ["walnut", "胡桃木"],
    ["boucle", "羊羔绒"],
    ["stone", "石材"],
    ["Wabi-sabi", "侘寂"],
  ].reduce((text, [from, to]) => text.split(from).join(to), value);
}


function elapsedSeconds(value?: string): number {
  if (!value) return 0;
  const started = new Date(value).getTime();
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.round((Date.now() - started) / 1000));
}

function formatDuration(seconds: number, locale: AppLocale): string {
  if (seconds < 60) return `${seconds} ${locale === "zh-CN" ? "秒" : "sec"}`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return locale === "zh-CN" ? `${minutes} 分 ${rest} 秒` : `${minutes} min ${rest} sec`;
}
