import { useEffect, useState } from "react";

import { AssetUploader } from "../components/AssetUploader";
import { CustomTaskBuilder } from "../components/CustomTaskBuilder";
import { GeneratedResultPanel } from "../components/GeneratedResultPanel";
import { ProjectContextBar } from "../components/ProjectContextBar";
import { WorkflowModelOverride } from "../components/WorkflowModelOverride";
import { WorkflowModelStatusCard } from "../components/WorkflowModelStatusCard";
import { aspectRatioOptions } from "../lib/aspect-ratio";
import { findRunnableImageModelConfig, resolveRunnableImageSelection } from "../lib/model-selection";
import { latestInputsForSource, latestOutputForModule } from "../lib/workflow-history";
import { firstResultAsset } from "../lib/task-output";
import { useModelStore } from "../stores/useModelStore";
import { useAssetStore } from "../stores/useAssetStore";
import { useProjectStore } from "../stores/useProjectStore";
import { useTaskStore } from "../stores/useTaskStore";
import { useUIStore } from "../stores/useUIStore";
import type { AssetRecord } from "../types";
import { useLocale } from "../i18n/locale";
import { localizeBuiltinText } from "../i18n/builtin-content";
import { localeLabel } from "../lib/zh-labels";

const taskTypes = ["房间改造", "图片编辑", "图片生成", "方案板生成", "自定义"];

export function CustomTasksPage() {
  const { locale, message, text } = useLocale();
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const projects = useProjectStore((state) => state.projects);
  const customWorkflowDraft = useUIStore((state) => state.customWorkflowDraft);
  const updateCustomWorkflowDraft = useUIStore((state) => state.updateCustomWorkflowDraft);
  const queueProviderImageTask = useTaskStore((state) => state.queueProviderImageTask);
  const loadAssets = useAssetStore((state) => state.loadAssets);
  const assets = useAssetStore((state) => state.assets);
  const activeProvider = useModelStore((state) => state.activeProviderByModule.boards);
  const activeModel = useModelStore((state) => state.activeModelByModule.boards);
  const activeProviderConfigId = useModelStore((state) => state.activeProviderConfigIdByModule.boards);
  const workflowModelOverrides = useModelStore((state) => state.workflowModelOverrides);
  const providerConfigs = useModelStore((state) => state.providerConfigs);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [uploadedAssets, setUploadedAssets] = useState<AssetRecord[]>([]);
  const [isReplacingInput, setIsReplacingInput] = useState(false);
  const [resultAsset, setResultAsset] = useState<AssetRecord | undefined>();
  const [generationError, setGenerationError] = useState<string | undefined>();
  const [isGenerating, setIsGenerating] = useState(false);

  const imageModelFallback = { provider: activeProvider, model: activeModel, providerConfigId: activeProviderConfigId };
  const imageModelSelection = workflowModelOverrides["custom_tasks.image"] ?? imageModelFallback;
  const resolvedImageModelSelection = resolveRunnableImageSelection(providerConfigs, imageModelSelection);
  const selectedConfig = findRunnableImageModelConfig(providerConfigs, resolvedImageModelSelection);
  const taskType = isCustomValue(customWorkflowDraft.taskType) ? customWorkflowDraft.customTaskType : customWorkflowDraft.taskType;
  const displayedTaskName = localizeBuiltinText(customWorkflowDraft.taskName, locale);
  const displayedMainPrompt = localizeBuiltinText(customWorkflowDraft.mainPrompt, locale);
  const displayedNegativePrompt = localizeBuiltinText(customWorkflowDraft.negativePrompt, locale);
  const canQueue = Boolean(displayedTaskName.trim() && displayedMainPrompt.trim() && taskType);
  const customTaskPrompt = text(
    `${displayedMainPrompt} 请严格生成 1 张 ${customWorkflowDraft.aspectRatio} 比例的结果。`,
    `${displayedMainPrompt} Generate exactly one result with a ${customWorkflowDraft.aspectRatio} aspect ratio.`,
  );

  useEffect(() => {
    if (!activeProjectId) return;
    void loadAssets(activeProjectId);
  }, [activeProjectId, loadAssets]);

  useEffect(() => {
    if (!activeProjectId) return;
    const currentInputs = uploadedAssets.length > 0
      ? uploadedAssets
      : !isReplacingInput
        ? latestInputsForSource(assets, "custom_task", activeProjectId)
        : [];
    if (uploadedAssets.length === 0 && !isReplacingInput) setUploadedAssets(currentInputs);
    if (!resultAsset) {
      setResultAsset(latestOutputForModule(assets, "custom_tasks", activeProjectId, currentInputs.map((asset) => asset.id), true));
    }
  }, [activeProjectId, assets, isReplacingInput, resultAsset, uploadedAssets.length]);

  const queueCustomTask = async () => {
    if (isGenerating) return;
    if (!activeProjectId) {
      setGenerationError(text("生成前请先创建或选择项目。", "Create or select a project before generating."));
      return;
    }
    if (!selectedConfig) {
      setGenerationError(text("当前没有可运行的自定义任务图片模型，请先保存并应用图片模型线路。", "No runnable image route is available for custom tasks. Save and apply an image model route first."));
      return;
    }
    setGenerationError(undefined);
    setResultAsset(undefined);
    setIsGenerating(true);
    try {
      const task = await queueProviderImageTask({
      project_id: activeProjectId,
      module: "custom_tasks",
      task_type: "provider_custom_task",
      capability: customWorkflowDraft.capability,
      provider: resolvedImageModelSelection.provider,
      model_name: resolvedImageModelSelection.model,
      provider_config_id: selectedConfig.id,
      payload_summary: `${displayedTaskName} · ${localeLabel(taskType, locale)} · ${customWorkflowDraft.aspectRatio}`,
      payload_json: {
        asset_ids: uploadedAssets.map((asset) => asset.id),
        task_name: displayedTaskName,
        task_type: taskType,
        prompt: customTaskPrompt,
        negative_prompt: displayedNegativePrompt,
        output_count: 1,
        aspect_ratio: customWorkflowDraft.aspectRatio,
        resolution: customWorkflowDraft.resolutionPreset,
        require_source_images: true,
      },
      prompt_snapshot: {
        resolved_prompt: customTaskPrompt,
        negative_prompt: displayedNegativePrompt,
      },
      params_snapshot: {
        output_count: 1,
        aspect_ratio: customWorkflowDraft.aspectRatio,
      },
      });
      setResultAsset(firstResultAsset(task.output_payload_json));
      void loadAssets(activeProjectId);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="page-stack min-w-0 overflow-x-hidden">
      <section className="page-hero">
        <div className="eyebrow">{text("自定义任务", "Custom Tasks")}</div>
        <h2 className="hero-title">{text("创建可复用任务，不需要复杂工作流编辑器。", "Create reusable tasks without a complex workflow editor.")}</h2>
        <p className="body-muted mt-2 max-w-3xl">{text("上传参考图，填写任务提示词，选择基础输出设置，然后加入任务队列。", "Upload references, enter a prompt, select output settings, and add the task to the queue.")}</p>
      </section>
      <ProjectContextBar label={text("自定义任务项目", "Custom task project")} />
      <CustomTaskBuilder />

      <section className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1.15fr)_420px]">
        <div className="min-w-0 space-y-5">
          <AssetUploader
            title={text("1. 上传参考图片", "1. Upload reference images")}
            description={text("上传这个自定义任务需要用到的源图或参考图。", "Upload source or reference images required by this custom task.")}
            multiple
            existingAssets={uploadedAssets}
            onFilesSelected={() => {
              setIsReplacingInput(true);
              setUploadedAssets([]);
              setResultAsset(undefined);
              setGenerationError(undefined);
            }}
            uploadOptions={activeProjectId ? { projectId: activeProjectId, assetType: "reference_image", source: "custom_task" } : undefined}
            onAssetsUploaded={(nextAssets) => {
              setUploadedAssets(nextAssets);
              setResultAsset(undefined);
              setGenerationError(undefined);
            }}
            onAssetRemoved={(asset) => {
              setUploadedAssets((current) => current.filter((item) => item.id !== asset.id));
              setResultAsset(undefined);
              setGenerationError(undefined);
            }}
          />
          {generationError ? <div className="soft-alert">{message(generationError)}</div> : null}
          {isGenerating ? <div className="panel-muted p-4 text-sm font-semibold text-studio-navy">{text("正在生成 1 个自定义结果...", "Generating one custom result...")}</div> : null}

          {resultAsset ? (
            <GeneratedResultPanel asset={resultAsset} title={text("自定义任务输出", "Custom task output")} aspectRatio={customWorkflowDraft.aspectRatio} />
          ) : null}

        </div>

        <aside className="panel-surface h-fit min-w-0 p-5">
          <div className="eyebrow">{text("2. 任务设置", "2. Task settings")}</div>
          <h3 className="section-title mt-2">{text("提示词和输出", "Prompt and output")}</h3>

          <div className="mt-4 space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("任务名称", "Task name")}</span>
              <input value={displayedTaskName} onChange={(event) => updateCustomWorkflowDraft({ taskName: event.target.value })} className="form-field w-full" />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("任务类型", "Task type")}</span>
              <select value={customWorkflowDraft.taskType} onChange={(event) => updateCustomWorkflowDraft({ taskType: event.target.value })} className="form-field w-full">
                {taskTypes.map((type) => <option key={type} value={type}>{localeLabel(type, locale)}</option>)}
              </select>
            </label>

            {isCustomValue(customWorkflowDraft.taskType) ? (
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("自定义类型", "Custom type")}</span>
                <input value={customWorkflowDraft.customTaskType} onChange={(event) => updateCustomWorkflowDraft({ customTaskType: event.target.value })} className="form-field w-full" />
              </label>
            ) : null}

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("主提示词", "Main prompt")}</span>
              <textarea
                value={displayedMainPrompt}
                onChange={(event) => updateCustomWorkflowDraft({ mainPrompt: event.target.value })}
                placeholder={text("清楚描述需要生成什么结果...", "Describe the result to generate...")}
                className="textarea-field h-40 w-full"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("画面比例", "Aspect ratio")}</span>
              <select value={customWorkflowDraft.aspectRatio} onChange={(event) => updateCustomWorkflowDraft({ aspectRatio: event.target.value })} className="form-field w-full">
                {aspectRatioOptions.map((ratio) => <option key={ratio}>{ratio}</option>)}
              </select>
            </label>

            <button type="button" onClick={() => setShowAdvanced((value) => !value)} className="btn-secondary w-full">
              {showAdvanced ? text("收起高级设置", "Hide advanced settings") : text("高级设置", "Advanced settings")}
            </button>

            {showAdvanced ? (
              <div className="space-y-3 rounded-lg border border-studio-border bg-studio-panelBg p-3">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("负面提示词", "Negative prompt")}</span>
                  <textarea value={displayedNegativePrompt} onChange={(event) => updateCustomWorkflowDraft({ negativePrompt: event.target.value })} className="textarea-field h-20 w-full" />
                </label>
              </div>
            ) : null}

            <WorkflowModelStatusCard
              slotKey="custom_tasks.image"
              fallback={imageModelFallback}
            />

            <button type="button" onClick={() => void queueCustomTask().catch((error) => setGenerationError(error instanceof Error ? error.message : text("生成失败。", "Generation failed.")))} disabled={!canQueue || uploadedAssets.length === 0 || isGenerating || projects.length === 0} className="btn-primary w-full">
              {isGenerating ? text("正在生成 1 个结果...", "Generating one result...") : text("3. 加入自定义任务", "3. Start custom task")}
            </button>
          </div>
        </aside>
      </section>

      <WorkflowModelOverride
        slotKey="custom_tasks.image"
        title={text("自定义任务图像模型", "Custom task image model")}
        description={text("当自定义任务需要输出图片时使用这个模型。", "This model is used when a custom task produces an image.")}
        capability="image"
        fallback={imageModelFallback}
      />
    </div>
  );
}

function isCustomValue(value?: string): boolean {
  return value === "Custom" || value === "自定义";
}
