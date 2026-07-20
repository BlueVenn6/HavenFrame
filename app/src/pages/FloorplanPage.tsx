import { useEffect, useState } from "react";

import { AssetOpenActions } from "../components/AssetOpenActions";
import { AssetImage } from "../components/AssetImage";
import { AssetUploader } from "../components/AssetUploader";
import { ProjectContextBar } from "../components/ProjectContextBar";
import { WorkflowModelOverride } from "../components/WorkflowModelOverride";
import { WorkflowModelStatusCard } from "../components/WorkflowModelStatusCard";
import { aspectRatioOptions, aspectRatioToCss } from "../lib/aspect-ratio";
import { floorplanOutputModes, floorplanStyles } from "../lib/workflow-options";
import { findRunnableImageModelConfig, resolveRunnableImageSelection } from "../lib/model-selection";
import { localeLabel, zhLabel } from "../lib/zh-labels";
import { firstResultAsset } from "../lib/task-output";
import { latestInputsForSource, latestOutputForModule } from "../lib/workflow-history";
import { useModelStore } from "../stores/useModelStore";
import { useAssetStore } from "../stores/useAssetStore";
import { useProjectStore } from "../stores/useProjectStore";
import { useTaskStore } from "../stores/useTaskStore";
import { useUIStore } from "../stores/useUIStore";
import type { AssetRecord } from "../types";
import { useLocale } from "../i18n/locale";
import { localizeBuiltinText } from "../i18n/builtin-content";

export function FloorplanPage() {
  const { locale, message, text } = useLocale();
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const projects = useProjectStore((state) => state.projects);
  const floorplanDraft = useUIStore((state) => state.floorplanDraft);
  const updateFloorplanDraft = useUIStore((state) => state.updateFloorplanDraft);
  const queueProviderImageTask = useTaskStore((state) => state.queueProviderImageTask);
  const loadAssets = useAssetStore((state) => state.loadAssets);
  const assets = useAssetStore((state) => state.assets);
  const activeProvider = useModelStore((state) => state.activeProviderByModule.floorplan);
  const activeModel = useModelStore((state) => state.activeModelByModule.floorplan);
  const activeProviderConfigId = useModelStore((state) => state.activeProviderConfigIdByModule.floorplan);
  const workflowModelOverrides = useModelStore((state) => state.workflowModelOverrides);
  const providerConfigs = useModelStore((state) => state.providerConfigs);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [uploadedAssets, setUploadedAssets] = useState<AssetRecord[]>([]);
  const [isReplacingInput, setIsReplacingInput] = useState(false);
  const [resultAsset, setResultAsset] = useState<AssetRecord | undefined>();
  const [generationError, setGenerationError] = useState<string | undefined>();
  const [isGenerating, setIsGenerating] = useState(false);

  const imageModelFallback = { provider: activeProvider, model: activeModel, providerConfigId: activeProviderConfigId };
  const imageModelSelection = workflowModelOverrides["floorplan.image"] ?? imageModelFallback;
  const resolvedImageModelSelection = resolveRunnableImageSelection(providerConfigs, imageModelSelection);
  const selectedConfig = findRunnableImageModelConfig(providerConfigs, resolvedImageModelSelection);
  const normalizedStyle = floorplanStyles.includes(floorplanDraft.style) ? floorplanDraft.style : zhLabel(floorplanDraft.style);
  const resolvedStyle = isCustomValue(normalizedStyle) ? floorplanDraft.customStyle : normalizedStyle;
  const displayedCustomPrompt = localizeBuiltinText(floorplanDraft.customPrompt, locale);
  const displayedNegativePrompt = localizeBuiltinText(floorplanDraft.negativePrompt, locale);
  const renderPrompt = text(
    `${displayedCustomPrompt} 请严格生成 1 张 ${floorplanDraft.aspectRatio} 比例的结果。输出类型：${floorplanDraft.outputMode}。风格：${resolvedStyle}。请保留上传平面图的墙体、门窗、房间关系和基础结构。`,
    `${displayedCustomPrompt} Generate exactly one ${floorplanDraft.aspectRatio} result. Output type: ${floorplanDraft.outputMode}. Style: ${localeLabel(resolvedStyle, locale)}. Preserve the uploaded floor plan's walls, doors, windows, room relationships, and base structure.`,
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
        ? latestInputsForSource(assets, "floorplan", activeProjectId).slice(0, 1)
        : [];
    if (uploadedAssets.length === 0 && !isReplacingInput) setUploadedAssets(currentInputs);
    if (!resultAsset) {
      setResultAsset(latestOutputForModule(assets, "floorplan", activeProjectId, currentInputs.map((asset) => asset.id)));
    }
  }, [activeProjectId, assets, isReplacingInput, resultAsset, uploadedAssets.length]);

  const queueRender = async () => {
    if (isGenerating) return;
    if (!activeProjectId) {
      setGenerationError(text("生成前请先创建或选择项目。", "Create or select a project before generating."));
      return;
    }
    if (!selectedConfig) {
      setGenerationError(text("当前没有可运行的平面图图片模型，请先保存并应用图片模型线路。", "No runnable image route is available for floor plans. Save and apply an image model route first."));
      return;
    }
    setGenerationError(undefined);
    setResultAsset(undefined);
    setIsGenerating(true);
    try {
      const task = await queueProviderImageTask({
        project_id: activeProjectId,
        module: "floorplan",
        task_type: "provider_floorplan_render",
        capability: "image_to_image",
        provider: resolvedImageModelSelection.provider,
        model_name: resolvedImageModelSelection.model,
        provider_config_id: selectedConfig.id,
        payload_summary: `${floorplanDraft.outputMode} · ${resolvedStyle} · ${floorplanDraft.aspectRatio}`,
        payload_json: {
          asset_ids: uploadedAssets.map((asset) => asset.id),
          output_mode: floorplanDraft.outputMode,
          style: resolvedStyle,
          prompt: renderPrompt,
          negative_prompt: displayedNegativePrompt,
          scale_calibration: floorplanDraft.scaleCalibration,
          output_count: 1,
          aspect_ratio: floorplanDraft.aspectRatio,
          require_source_images: true,
        },
        prompt_snapshot: {
          resolved_prompt: renderPrompt,
          negative_prompt: displayedNegativePrompt,
        },
        params_snapshot: {
          output_mode: floorplanDraft.outputMode,
          style: resolvedStyle,
          output_count: 1,
          aspect_ratio: floorplanDraft.aspectRatio,
        },
      });
      const latestAsset = firstResultAsset(task.output_payload_json);
      setResultAsset(latestAsset);
      void loadAssets(activeProjectId);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="page-stack min-w-0 overflow-x-hidden">
      <section className="page-hero">
        <div className="eyebrow">{text("平面图", "Floor Plan")}</div>
        <h2 className="hero-title">{text("上传平面图，设置风格，然后渲染。", "Upload a floor plan, select a style, and render.")}</h2>
        <p className="body-muted mt-2 max-w-3xl">{text("用于把草图或黑白平面图生成 2D 彩色平面图 / 3D 鸟瞰图。", "Turn a sketch or monochrome floor plan into a 2D color plan or 3D bird's-eye view.")}</p>
      </section>
      <ProjectContextBar label={text("平面图项目", "Floor-plan project")} />

      <section className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1.15fr)_420px]">
        <div className="min-w-0 space-y-5">
          <AssetUploader
            title={text("1. 上传平面图或草图", "1. Upload a floor plan or sketch")}
            description={text("上传原始平面图、草图或黑白布局图。", "Upload the original floor plan, sketch, or monochrome layout.")}
            existingAssets={uploadedAssets}
            onFilesSelected={() => {
              setIsReplacingInput(true);
              setUploadedAssets([]);
              setResultAsset(undefined);
              setGenerationError(undefined);
            }}
            uploadOptions={activeProjectId ? { projectId: activeProjectId, assetType: "floorplan", source: "floorplan" } : undefined}
            onAssetsUploaded={(nextAssets) => {
              setUploadedAssets(nextAssets.slice(0, 1));
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
          {isGenerating ? <div className="panel-muted p-4 text-sm font-semibold text-studio-navy">{text("正在生成 1 张平面图结果...", "Generating one floor-plan result...")}</div> : null}

          <div className="panel-surface min-w-0 p-5">
            <div className="eyebrow">{text("预览", "Preview")}</div>
            <h3 className="section-title mt-2">{text("输入图和生成结果", "Input and generated result")}</h3>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="thumbnail-placeholder flex items-center justify-center overflow-hidden" style={{ aspectRatio: aspectRatioToCss(floorplanDraft.aspectRatio) }}>
                {uploadedAssets[0]?.mime_type?.startsWith("image/") ? <AssetImage assetId={uploadedAssets[0].id} alt={uploadedAssets[0].file_name} className="h-full w-full object-contain" /> : text("原始平面图预览", "Original floor-plan preview")}
              </div>
              <div className="thumbnail-placeholder flex items-center justify-center overflow-hidden" style={{ aspectRatio: aspectRatioToCss(floorplanDraft.aspectRatio) }}>
                {resultAsset ? <AssetImage assetId={resultAsset.id} alt={resultAsset.file_name} className="h-full w-full object-contain" /> : text("生成平面图预览", "Generated floor-plan preview")}
              </div>
            </div>
            {resultAsset ? (
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-studio-border bg-studio-panelBg p-3 text-xs font-medium text-studio-mutedText">
                <span className="min-w-0 flex-1 break-all">{resultAsset.file_path}</span>
                <AssetOpenActions asset={resultAsset} size="sm" />
              </div>
            ) : null}
          </div>
        </div>

        <aside className="panel-surface h-fit min-w-0 p-5">
          <div className="eyebrow">{text("2. 渲染设置", "2. Rendering settings")}</div>
          <h3 className="section-title mt-2">{text("风格和提示词", "Style and prompt")}</h3>

          <div className="mt-4 space-y-4">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("输出类型", "Output type")}</div>
              <div className="grid gap-2">
                {floorplanOutputModes.map((mode) => (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => updateFloorplanDraft({ outputMode: mode.value })}
                    className={floorplanDraft.outputMode === mode.value ? "btn-primary w-full" : "btn-secondary w-full"}
                  >
                    {localeLabel(mode.label, locale)}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("风格", "Style")}</span>
              <select value={normalizedStyle} onChange={(event) => updateFloorplanDraft({ style: event.target.value })} className="form-field w-full">
                {floorplanStyles.map((style) => <option key={style} value={style}>{localeLabel(style, locale)}</option>)}
              </select>
            </label>

            {isCustomValue(normalizedStyle) ? (
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("自定义风格", "Custom style")}</span>
                <input value={floorplanDraft.customStyle} onChange={(event) => updateFloorplanDraft({ customStyle: event.target.value })} className="form-field w-full" />
              </label>
            ) : null}

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("画面比例", "Aspect ratio")}</span>
              <select value={floorplanDraft.aspectRatio} onChange={(event) => updateFloorplanDraft({ aspectRatio: event.target.value })} className="form-field w-full">
                {aspectRatioOptions.map((ratio) => <option key={ratio}>{ratio}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("提示词", "Prompt")}</span>
              <textarea
                value={displayedCustomPrompt}
                onChange={(event) => updateFloorplanDraft({ customPrompt: event.target.value })}
                placeholder={text("描述你希望生成的平面图效果...", "Describe the floor-plan result you want...")}
                className="textarea-field h-32 w-full"
              />
            </label>

            <button type="button" onClick={() => setShowAdvanced((value) => !value)} className="btn-secondary w-full">
              {showAdvanced ? text("收起高级设置", "Hide advanced settings") : text("高级设置", "Advanced settings")}
            </button>

            {showAdvanced ? (
              <div className="space-y-3 rounded-lg border border-studio-border bg-studio-panelBg p-3">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("负面提示词", "Negative prompt")}</span>
                  <textarea value={displayedNegativePrompt} onChange={(event) => updateFloorplanDraft({ negativePrompt: event.target.value })} className="textarea-field h-20 w-full" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("比例备注", "Scale notes")}</span>
                  <input value={floorplanDraft.scaleCalibration} onChange={(event) => updateFloorplanDraft({ scaleCalibration: event.target.value })} className="form-field w-full" />
                </label>
              </div>
            ) : null}

            <WorkflowModelStatusCard
              slotKey="floorplan.image"
              fallback={imageModelFallback}
            />

            <button type="button" onClick={() => void queueRender().catch((error) => setGenerationError(error instanceof Error ? error.message : text("生成失败。", "Generation failed.")))} disabled={!resolvedStyle || uploadedAssets.length === 0 || isGenerating || projects.length === 0} className="btn-primary w-full">
              {isGenerating ? text("正在生成 1 张结果...", "Generating one result...") : text("3. 渲染平面图", "3. Render floor plan")}
            </button>

          </div>
        </aside>
      </section>

      <WorkflowModelOverride
        slotKey="floorplan.image"
        title={text("平面图渲染模型", "Floor-plan rendering model")}
        description={text("仅用于当前平面图页面。全局默认模型在「模型设置」里管理，本页面需要不同图像模型时可在这里单独覆盖。", "Used only on this page. Global defaults are managed in Model Settings, and this page can override the image model when needed.")}
        capability="image"
        fallback={imageModelFallback}
      />
    </div>
  );
}

function isCustomValue(value?: string): boolean {
  return value === "Custom" || value === "自定义";
}
