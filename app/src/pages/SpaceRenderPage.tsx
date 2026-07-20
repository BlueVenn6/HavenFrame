import { useEffect, useRef, useState } from "react";

import { AssetOpenActions } from "../components/AssetOpenActions";
import { AssetImage } from "../components/AssetImage";
import { AssetUploader } from "../components/AssetUploader";
import { ProjectContextBar } from "../components/ProjectContextBar";
import { WorkflowModelOverride } from "../components/WorkflowModelOverride";
import { WorkflowModelStatusCard } from "../components/WorkflowModelStatusCard";
import { aspectRatioOptions, aspectRatioToCss } from "../lib/aspect-ratio";
import { useAssetContentUrl } from "../hooks/useAssetContentUrl";
import { spaceRenderRoomTypes, spaceRenderStyles } from "../lib/workflow-options";
import {
  findRunnableImageModelConfig,
  findRunnableVisionModelConfig,
  resolveRunnableImageSelection,
  resolveRunnableVisionSelection,
} from "../lib/model-selection";
import { localeLabel, zhLabel } from "../lib/zh-labels";
import { firstResultAsset } from "../lib/task-output";
import { latestInputsForSource, latestOutputForModule, outputMatchesSpaceRenderReferences } from "../lib/workflow-history";
import { useBoardStore } from "../stores/useBoardStore";
import { useModelStore } from "../stores/useModelStore";
import { useAssetStore } from "../stores/useAssetStore";
import { useProjectStore } from "../stores/useProjectStore";
import { useTaskStore } from "../stores/useTaskStore";
import { useUIStore } from "../stores/useUIStore";
import type { AssetRecord, ExtractedItemRecord } from "../types";
import { useLocale } from "../i18n/locale";
import { localizeBuiltinText } from "../i18n/builtin-content";

const REFERENCE_ROLES = ["风格与配色", "材质与饰面", "指定家具", "灯光与氛围"] as const;
type ReferenceRole = (typeof REFERENCE_ROLES)[number];

export function SpaceRenderPage() {
  const { locale, message, text } = useLocale();
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const spaceRenderDraft = useUIStore((state) => state.spaceRenderDraft);
  const updateSpaceRenderDraft = useUIStore((state) => state.updateSpaceRenderDraft);
  const queueProviderImageTask = useTaskStore((state) => state.queueProviderImageTask);
  const loadAssets = useAssetStore((state) => state.loadAssets);
  const assets = useAssetStore((state) => state.assets);
  const providerConfigs = useModelStore((state) => state.providerConfigs);
  const activeProvider = useModelStore((state) => state.activeProviderByModule.space_render);
  const activeModel = useModelStore((state) => state.activeModelByModule.space_render);
  const activeProviderConfigId = useModelStore((state) => state.activeProviderConfigIdByModule.space_render);
  const extractionProvider = useModelStore((state) => state.activeProviderByModule.room_board_extraction);
  const extractionModel = useModelStore((state) => state.activeModelByModule.room_board_extraction);
  const extractionProviderConfigId = useModelStore((state) => state.activeProviderConfigIdByModule.room_board_extraction);
  const workflowModelOverrides = useModelStore((state) => state.workflowModelOverrides);
  const extractedItems = useBoardStore((state) => state.extractedItems);
  const savingSelectionItemIds = useBoardStore((state) => state.savingSelectionItemIds);
  const loadPersistedProjectBoardData = useBoardStore((state) => state.loadPersistedProjectBoardData);
  const extractItemsFromAsset = useBoardStore((state) => state.extractItemsFromAsset);
  const saveExtractedItemSelection = useBoardStore((state) => state.saveExtractedItemSelection);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [uploadedAssets, setUploadedAssets] = useState<AssetRecord[]>([]);
  const [referenceAssets, setReferenceAssets] = useState<AssetRecord[]>([]);
  const [useReferenceImages, setUseReferenceImages] = useState(true);
  const [referenceRoles, setReferenceRoles] = useState<Record<number, ReferenceRole>>({});
  const [analyzingReferenceIds, setAnalyzingReferenceIds] = useState<number[]>([]);
  const [isReplacingInput, setIsReplacingInput] = useState(false);
  const [isReplacingReferences, setIsReplacingReferences] = useState(false);
  const [resultAsset, setResultAsset] = useState<AssetRecord | undefined>();
  const [generationError, setGenerationError] = useState<string | undefined>();
  const [referenceError, setReferenceError] = useState<string | undefined>();
  const [isGenerating, setIsGenerating] = useState(false);

  const imageModelFallback = { provider: activeProvider, model: activeModel, providerConfigId: activeProviderConfigId };
  const imageModelSelection = workflowModelOverrides["space_render.image"] ?? imageModelFallback;
  const resolvedImageModelSelection = resolveRunnableImageSelection(providerConfigs, imageModelSelection);
  const selectedConfig = findRunnableImageModelConfig(providerConfigs, resolvedImageModelSelection);
  const extractionModelFallback = { provider: extractionProvider, model: extractionModel, providerConfigId: extractionProviderConfigId };
  const extractionModelSelection = workflowModelOverrides["space_render.extraction"] ?? extractionModelFallback;
  const resolvedExtractionModelSelection = resolveRunnableVisionSelection(providerConfigs, extractionModelSelection);
  const extractionSelectedConfig = findRunnableVisionModelConfig(providerConfigs, resolvedExtractionModelSelection);
  const normalizedRoomType = spaceRenderRoomTypes.includes(spaceRenderDraft.roomType)
    ? spaceRenderDraft.roomType
    : zhLabel(spaceRenderDraft.roomType);
  const normalizedStyle = spaceRenderStyles.includes(spaceRenderDraft.styles[0] ?? "")
    ? spaceRenderDraft.styles[0]
    : zhLabel(spaceRenderDraft.styles[0]);
  const roomType = isCustomValue(normalizedRoomType) ? spaceRenderDraft.customRoomType.trim() : normalizedRoomType;
  const mainStyle = normalizedStyle || "现代";
  const referenceAssetIds = referenceAssets.map((asset) => asset.id);
  const activeReferenceAssets = useReferenceImages ? referenceAssets : [];
  const activeReferenceAssetIds = activeReferenceAssets.map((asset) => asset.id);
  const currentReferenceItems = extractedItems.filter((item) => item.asset_id && referenceAssetIds.includes(item.asset_id));
  const selectedReferenceItems = currentReferenceItems.filter((item) => item.selection_state === "keep");
  const ignoredReferenceItems = currentReferenceItems.filter((item) => item.selection_state === "remove");
  const referenceReviewSnapshot = buildReferenceReviewSnapshot(activeReferenceAssets, currentReferenceItems, referenceRoles, useReferenceImages);
  const generationInputIds = [...uploadedAssets.map((asset) => asset.id), ...activeReferenceAssetIds];
  const generationInputKey = generationInputIds.join(",");
  const referenceReviewNotice = describeReferenceReview(referenceAssets, currentReferenceItems, referenceRoles, useReferenceImages, locale);
  const referenceSummary = buildReferenceSummary(activeReferenceAssets, selectedReferenceItems, ignoredReferenceItems, referenceRoles, locale);
  const displayedMainPrompt = localizeBuiltinText(spaceRenderDraft.mainPrompt, locale);
  const displayedNegativePrompt = localizeBuiltinText(spaceRenderDraft.negativePrompt, locale);
  const displayedDesignBrief = localizeBuiltinText(spaceRenderDraft.designBrief, locale);
  const displayedMaterialKeywords = spaceRenderDraft.materialKeywords.map((item) => localeLabel(item, locale));
  const renderPrompt = locale === "zh-CN" ? [displayedMainPrompt,
    `请严格生成 1 张 ${spaceRenderDraft.aspectRatio} 比例的空间渲染图。空间类型：${roomType}。风格：${mainStyle}。`,
    `材质关键词：${displayedMaterialKeywords.join("、")}。`,
    "第 1 张图片是唯一源空间图，必须保留它的主体结构、视角、窗洞、墙地面关系和构图。",
    activeReferenceAssets.length > 0 ? `后续 ${activeReferenceAssets.length} 张图片仅作为视觉参考，不得复制其空间结构。参考角色和人工确认内容：${referenceSummary}。未完成 GLM 提取的参考图按所选角色直接参考。` : "没有参考图，不得引入其他项目或历史图片的风格与家具。",
    "不得加入未确认的参考元素，不得把参考图中的房间布局替换到源空间。",
  ].join(" ") : [displayedMainPrompt,
    `Generate exactly one ${spaceRenderDraft.aspectRatio} space rendering. Room type: ${localeLabel(roomType, locale)}. Style: ${localeLabel(mainStyle, locale)}.`,
    `Material keywords: ${displayedMaterialKeywords.join(", ")}.`,
    "The first image is the only source-space image. Preserve its main structure, viewpoint, openings, wall-floor relationships, and composition.",
    activeReferenceAssets.length > 0 ? `The following ${activeReferenceAssets.length} images are visual references only; do not copy their spatial structure. Reference roles and human-confirmed content: ${referenceSummary}. References without GLM extraction should be used according to their selected role.` : "No reference images are provided. Do not introduce style or furniture from other projects or historical images.",
    "Do not add unconfirmed reference items or replace the source-space layout with a reference-image layout.",
  ].join(" ");

  useEffect(() => {
    if (!activeProjectId) return;
    void Promise.all([
      loadAssets(activeProjectId),
      loadPersistedProjectBoardData(activeProjectId),
    ]);
  }, [activeProjectId, loadAssets, loadPersistedProjectBoardData]);

  useEffect(() => {
    if (!activeProjectId) return;
    const currentInputs = uploadedAssets.length > 0
      ? uploadedAssets
      : !isReplacingInput
        ? latestInputsForSource(assets, "space_render", activeProjectId).slice(0, 1)
        : [];
    if (uploadedAssets.length === 0 && !isReplacingInput) setUploadedAssets(currentInputs);
    const persistedReferences = referenceAssets.length > 0
      ? referenceAssets
      : !isReplacingReferences
        ? assets.filter((asset) => asset.source === "space_render_reference" && asset.type === "space_reference").slice(0, 3)
        : [];
    if (referenceAssets.length === 0 && !isReplacingReferences) setReferenceAssets(persistedReferences);
    const expectedInputIds = [
      ...currentInputs.map((asset) => asset.id),
      ...(useReferenceImages ? persistedReferences.map((asset) => asset.id) : []),
    ];
    if (!resultAsset) {
      const historicalResult = latestOutputForModule(assets, "space_render", activeProjectId, expectedInputIds);
      setResultAsset(outputMatchesSpaceRenderReferences(historicalResult, expectedInputIds, referenceReviewSnapshot) ? historicalResult : undefined);
    }
  }, [activeProjectId, assets, isReplacingInput, isReplacingReferences, referenceAssets.length, referenceReviewSnapshot, resultAsset, uploadedAssets.length, useReferenceImages]);

  useEffect(() => {
    setReferenceRoles((current) => {
      const next = { ...current };
      let changed = false;
      for (const asset of referenceAssets) {
        if (!next[asset.id]) {
          next[asset.id] = roleFromItems(currentReferenceItems, asset.id);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [currentReferenceItems, referenceAssets]);

  useEffect(() => {
    if (resultAsset && !outputMatchesSpaceRenderReferences(resultAsset, generationInputIds, referenceReviewSnapshot)) {
      setResultAsset(undefined);
    }
  }, [generationInputKey, referenceReviewSnapshot, resultAsset]);

  const analyzeReference = async (asset: AssetRecord) => {
    if (!activeProjectId) {
      setReferenceError(text("分析参考图前请先创建或选择项目。", "Create or select a project before analyzing references."));
      return;
    }
    if (!extractionSelectedConfig) {
      setReferenceError(text("没有可用的 GLM 视觉提取配置，请先在模型设置中保存 GLM 配置。", "No GLM vision route is available. Save a GLM route in Model Settings."));
      return;
    }
    const role = referenceRoles[asset.id] ?? "风格与配色";
    const confirmed = window.confirm(locale === "zh-CN" ? [
      "即将使用 GLM 分析空间渲染参考图。",
      `目标 Provider：${resolvedExtractionModelSelection.provider}`,
      `目标模型：${resolvedExtractionModelSelection.model}`,
      "所选参考图和提取角色会发送给服务商，结构化结果会保存到项目归档。",
      "请确认你有权上传这些客户图片和项目素材。",
    ].join("\n") : [
      "GLM will analyze the space-rendering reference image.",
      `Provider: ${resolvedExtractionModelSelection.provider}`,
      `Model: ${resolvedExtractionModelSelection.model}`,
      "The reference image and extraction role will be sent to the provider. Structured results will be saved in the project archive.",
      "Confirm that you have permission to upload this client image and project material.",
    ].join("\n"));
    if (!confirmed) return;
    setReferenceError(undefined);
    setAnalyzingReferenceIds((current) => [...new Set([...current, asset.id])]);
    try {
      await extractItemsFromAsset({
        projectId: activeProjectId,
        assetId: asset.id,
        roomType: `参考图：${role}`,
        style: role,
        providerName: resolvedExtractionModelSelection.provider,
        modelName: resolvedExtractionModelSelection.model,
        providerConfigId: extractionSelectedConfig.id,
        workflowSlot: "space_render.extraction",
        outputLanguage: locale,
        dataFlowConfirmed: true,
      });
      setResultAsset(undefined);
    } catch (error) {
      setReferenceError(error instanceof Error ? error.message : text("参考图 GLM 分析失败。", "GLM reference analysis failed."));
    } finally {
      setAnalyzingReferenceIds((current) => current.filter((id) => id !== asset.id));
    }
  };

  const saveReferenceItem = async (item: ExtractedItemRecord, selectionState: "keep" | "remove") => {
    setReferenceError(undefined);
    try {
      await saveExtractedItemSelection(item.id, selectionState, item.replacement_notes, {
        priceMin: item.price_min ?? null,
        priceMax: item.price_max ?? null,
        procurementStatus: item.procurement_status ?? "pending",
        quantity: item.quantity ?? null,
        purchaseMethod: item.purchase_method ?? "",
        purchaseUrl: item.purchase_url ?? "",
      });
      setResultAsset(undefined);
    } catch (error) {
      setReferenceError(error instanceof Error ? error.message : text("参考元素确认失败。", "Failed to confirm the reference item."));
    }
  };

  const queueRender = async () => {
    if (isGenerating) return;
    if (!activeProjectId) {
      setGenerationError(text("生成前请先创建或选择项目。", "Create or select a project before generating."));
      return;
    }
    if (!selectedConfig) {
      setGenerationError(text("当前没有可运行的空间渲染图片模型，请先在模型设置中保存并应用配置。", "No runnable space-rendering image route is available. Save and apply one in Model Settings."));
      return;
    }
    if (uploadedAssets.length === 0) {
      setGenerationError(text("请先上传源空间图。", "Upload a source-space image first."));
      return;
    }
    setGenerationError(undefined);
    setResultAsset(undefined);
    setIsGenerating(true);
    try {
      const task = await queueProviderImageTask({
      project_id: activeProjectId,
      module: "space_render",
      task_type: "provider_space_render",
      capability: "image_to_image",
      provider: resolvedImageModelSelection.provider,
      model_name: resolvedImageModelSelection.model,
      provider_config_id: selectedConfig.id,
      payload_summary: `${roomType} · ${mainStyle} · ${spaceRenderDraft.aspectRatio}`,
      payload_json: {
        asset_ids: generationInputIds,
        source_asset_ids: uploadedAssets.map((asset) => asset.id),
        reference_asset_ids: activeReferenceAssetIds,
        selected_reference_item_ids: useReferenceImages ? selectedReferenceItems.map((item) => item.id) : [],
        reference_roles: referenceRoles,
        reference_review_snapshot: referenceReviewSnapshot,
        use_reference_images: useReferenceImages,
        room_type: roomType,
        style: mainStyle,
        prompt: renderPrompt,
        design_brief: displayedDesignBrief,
        negative_prompt: displayedNegativePrompt,
        material_keywords: displayedMaterialKeywords,
        output_count: 1,
        aspect_ratio: spaceRenderDraft.aspectRatio,
        require_source_images: true,
      },
      prompt_snapshot: {
        resolved_prompt: renderPrompt,
        negative_prompt: displayedNegativePrompt,
      },
      params_snapshot: {
        room_type: roomType,
        style: mainStyle,
        aspect_ratio: spaceRenderDraft.aspectRatio,
        reference_asset_ids: activeReferenceAssetIds,
        selected_reference_item_ids: useReferenceImages ? selectedReferenceItems.map((item) => item.id) : [],
        reference_review_snapshot: referenceReviewSnapshot,
        use_reference_images: useReferenceImages,
        timeout_sec: activeReferenceAssets.length > 0 ? 1800 : 900,
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
        <div className="eyebrow">{text("空间渲染", "Space Rendering")}</div>
        <h2 className="hero-title">{text("上传空间图，描述需求，然后生成渲染图。", "Upload a space image, describe the requirements, and generate a rendering.")}</h2>
        <p className="body-muted mt-2 max-w-3xl">{text("适用于实景照片、白模图、SU 截图或粗略空间图。", "Suitable for room photos, white models, SketchUp screenshots, or rough spatial images.")}</p>
      </section>
      <ProjectContextBar label={text("空间渲染项目", "Space-rendering project")} />

      <section className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1.15fr)_420px]">
        <div className="min-w-0 space-y-5">
          <AssetUploader
            title={text("1. 上传源空间图", "1. Upload the source-space image")}
            description={text("上传 1 张需要被渲染的房间照片、SU 截图或白模图；这张图决定最终空间结构和视角。", "Upload one room photo, SketchUp screenshot, or white model. It determines the final structure and viewpoint.")}
            existingAssets={uploadedAssets}
            onFilesSelected={() => {
              setIsReplacingInput(true);
              setUploadedAssets([]);
              setResultAsset(undefined);
              setGenerationError(undefined);
            }}
            uploadOptions={activeProjectId ? { projectId: activeProjectId, assetType: "space_input", source: "space_render" } : undefined}
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
          <AssetUploader
            title={text("可选：上传 1-3 张风格参考图", "Optional: Upload 1-3 style references")}
            description={text("参考图只提供风格、配色、材质、家具或灯光线索，不会替代源空间结构。可以直接使用，也可以先用 GLM 提取后逐项确认。", "References provide only style, color, material, furniture, or lighting cues and never replace the source-space structure. Use them directly or extract and review details with GLM.")}
            multiple
            maxFiles={3}
            existingAssets={referenceAssets}
            onFilesSelected={() => {
              setIsReplacingReferences(true);
              setReferenceAssets([]);
              setReferenceRoles({});
              setReferenceError(undefined);
              setResultAsset(undefined);
            }}
            uploadOptions={activeProjectId ? { projectId: activeProjectId, assetType: "space_reference", source: "space_render_reference" } : undefined}
            onAssetsUploaded={(nextAssets) => {
              const limited = nextAssets.slice(0, 3);
              setReferenceAssets(limited);
              setUseReferenceImages(true);
              setReferenceRoles(Object.fromEntries(limited.map((asset) => [asset.id, "风格与配色" as ReferenceRole])));
              setReferenceError(undefined);
              setResultAsset(undefined);
            }}
            onAssetRemoved={(asset) => {
              setReferenceAssets((current) => current.filter((item) => item.id !== asset.id));
              setReferenceRoles((current) => {
                const next = { ...current };
                delete next[asset.id];
                return next;
              });
              setAnalyzingReferenceIds((current) => current.filter((id) => id !== asset.id));
              setReferenceError(undefined);
              setResultAsset(undefined);
              if (activeProjectId) void loadPersistedProjectBoardData(activeProjectId);
            }}
          />
          {referenceAssets.length > 0 ? (
            <>
              <div className="panel-surface flex min-w-0 flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-studio-navy">{text("生成时使用参考图", "Use references for generation")}</div>
                  <div className="mt-1 text-xs text-studio-mutedText">{text("关闭后，这些参考图不会发送给图片生成 Provider；源空间图仍可正常生成。", "When disabled, references are not sent to the image Provider; the source space can still be generated normally.")}</div>
                </div>
                <label className="inline-flex items-center gap-2 text-sm font-semibold text-studio-navy">
                  <input type="checkbox" checked={useReferenceImages} onChange={(event) => { setUseReferenceImages(event.target.checked); setResultAsset(undefined); setGenerationError(undefined); }} className="h-4 w-4 accent-teal-600" />
                  {useReferenceImages ? text("已启用", "Enabled") : text("未启用", "Disabled")}
                </label>
              </div>
              <SpaceReferenceReview
                assets={referenceAssets}
                items={currentReferenceItems}
                roles={referenceRoles}
                analyzingAssetIds={analyzingReferenceIds}
                savingItemIds={savingSelectionItemIds}
                onRoleChange={(assetId, role) => {
                  setReferenceRoles((current) => ({ ...current, [assetId]: role }));
                  setReferenceError(undefined);
                  setResultAsset(undefined);
                }}
                onAnalyze={(asset) => void analyzeReference(asset)}
                onSelect={(item, selectionState) => void saveReferenceItem(item, selectionState)}
              />
            </>
          ) : null}
          {referenceError ? <div className="soft-alert">{message(referenceError)}</div> : null}
          {referenceReviewNotice ? <div className="panel-muted p-3 text-sm font-medium text-studio-mutedText">{referenceReviewNotice}</div> : null}
          {generationError ? <div className="soft-alert">{message(generationError)}</div> : null}
          {isGenerating ? <div className="panel-muted p-4 text-sm font-semibold text-studio-navy">{text("正在生成 1 张渲染图...", "Generating one rendering...")}</div> : null}

          <div className="panel-surface min-w-0 p-5">
            <div className="eyebrow">{text("预览", "Preview")}</div>
            <h3 className="section-title mt-2">{text("原图和生成渲染图", "Source image and generated rendering")}</h3>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="thumbnail-placeholder flex items-center justify-center overflow-hidden" style={{ aspectRatio: aspectRatioToCss(spaceRenderDraft.aspectRatio) }}>
                {uploadedAssets[0]?.mime_type?.startsWith("image/") ? <AssetImage assetId={uploadedAssets[0].id} alt={uploadedAssets[0].file_name} className="h-full w-full object-contain" /> : text("源图预览", "Source preview")}
              </div>
              <div className="thumbnail-placeholder flex items-center justify-center overflow-hidden" style={{ aspectRatio: aspectRatioToCss(spaceRenderDraft.aspectRatio) }}>
                {resultAsset ? <AssetImage assetId={resultAsset.id} alt={resultAsset.file_name} className="h-full w-full object-contain" /> : text("生成结果预览", "Generated result preview")}
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
          <h3 className="section-title mt-2">{text("提示词和风格", "Prompt and style")}</h3>

          <div className="mt-4 space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("空间类型", "Room type")}</span>
              <select value={normalizedRoomType} onChange={(event) => updateSpaceRenderDraft({ roomType: event.target.value })} className="form-field w-full">
                {spaceRenderRoomTypes.map((type) => <option key={type} value={type}>{localeLabel(type, locale)}</option>)}
              </select>
            </label>

            {isCustomValue(normalizedRoomType) ? (
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("自定义空间类型", "Custom room type")}</span>
                <input value={spaceRenderDraft.customRoomType} onChange={(event) => updateSpaceRenderDraft({ customRoomType: event.target.value })} className="form-field w-full" />
              </label>
            ) : null}

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("风格", "Style")}</span>
              <select value={mainStyle} onChange={(event) => updateSpaceRenderDraft({ styles: [event.target.value] })} className="form-field w-full">
                {spaceRenderStyles.map((style) => <option key={style} value={style}>{localeLabel(style, locale)}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("提示词", "Prompt")}</span>
              <textarea
                value={displayedMainPrompt}
                onChange={(event) => updateSpaceRenderDraft({ mainPrompt: event.target.value })}
                placeholder={text("描述最终空间效果：要保留的结构、氛围、材质、灯光...", "Describe the final space: structure, atmosphere, materials, and lighting to preserve...")}
                className="textarea-field h-36 w-full"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("材质关键词", "Material keywords")}</span>
              <input
                value={displayedMaterialKeywords.join(", ")}
                onChange={(event) => updateSpaceRenderDraft({ materialKeywords: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })}
                placeholder={text("胡桃木、亚麻、洞石", "walnut, linen, travertine")}
                className="form-field w-full"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("画面比例", "Aspect ratio")}</span>
              <select value={spaceRenderDraft.aspectRatio} onChange={(event) => updateSpaceRenderDraft({ aspectRatio: event.target.value })} className="form-field w-full">
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
                  <textarea value={displayedNegativePrompt} onChange={(event) => updateSpaceRenderDraft({ negativePrompt: event.target.value })} className="textarea-field h-20 w-full" />
                </label>
              </div>
            ) : null}

            <WorkflowModelStatusCard
              slotKey="space_render.image"
              fallback={imageModelFallback}
            />

            <button type="button" onClick={() => void queueRender().catch((error) => setGenerationError(error instanceof Error ? error.message : text("生成失败。", "Generation failed.")))} disabled={isGenerating} className="btn-primary w-full">
              {isGenerating ? text("正在生成 1 张渲染图...", "Generating one rendering...") : text("3. 生成渲染图", "3. Generate rendering")}
            </button>

          </div>
        </aside>
      </section>

      <WorkflowModelOverride
        slotKey="space_render.image"
        title={text("空间渲染图像模型", "Space-rendering image model")}
        description={text("仅用于当前页面从房间照片、SU 截图或白模图生成渲染图。", "Used only on this page to generate renderings from room photos, SketchUp screenshots, or white models.")}
        capability="image"
        fallback={imageModelFallback}
      />
      <WorkflowModelOverride
        slotKey="space_render.extraction"
        title={text("空间参考图提取模型", "Space-reference extraction model")}
        description={text("仅用于分析空间渲染参考图中的风格、配色、材质、家具和灯光线索；默认使用独立 GLM 视觉配置，不受图片生成模型切换影响。", "Used only to analyze style, color, material, furniture, and lighting cues in rendering references. It uses an independent GLM vision route.")}
        capability="vision"
        fallback={extractionModelFallback}
      />
    </div>
  );
}

function isCustomValue(value?: string): boolean {
  return value === "Custom" || value === "自定义";
}

function SpaceReferenceReview({
  assets,
  items,
  roles,
  analyzingAssetIds,
  savingItemIds,
  onRoleChange,
  onAnalyze,
  onSelect,
}: {
  assets: AssetRecord[];
  items: ExtractedItemRecord[];
  roles: Record<number, ReferenceRole>;
  analyzingAssetIds: number[];
  savingItemIds: number[];
  onRoleChange: (assetId: number, role: ReferenceRole) => void;
  onAnalyze: (asset: AssetRecord) => void;
  onSelect: (item: ExtractedItemRecord, selectionState: "keep" | "remove") => void;
}) {
  const { locale, text } = useLocale();
  return (
    <section className="panel-surface min-w-0 p-5">
      <div className="eyebrow">{text("参考图分析", "Reference analysis")}</div>
      <h3 className="section-title mt-2">{text("先提取，再确认采用内容", "Extract, then confirm what to use")}</h3>
      <p className="body-muted mt-1">{text("每张参考图独立分析；未确认或已忽略的内容不会进入空间渲染提示词。", "Each reference is analyzed independently. Unconfirmed or ignored content is not added to the rendering prompt.")}</p>
      <div className="mt-4 space-y-4">
        {assets.map((asset, index) => {
          const role = roles[asset.id] ?? "风格与配色";
          const assetItems = items.filter((item) => item.asset_id === asset.id);
          const roleMatches = assetItems.length === 0 || assetItems.every((item) => item.room_type === `参考图：${role}`);
          const isAnalyzing = analyzingAssetIds.includes(asset.id);
          return (
            <div key={asset.id} className="min-w-0 border-t border-studio-border pt-4 first:border-t-0 first:pt-0">
              <div className="grid min-w-0 gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
                <AssetImage assetId={asset.id} alt={asset.file_name} className="aspect-[4/3] w-full rounded-lg border border-studio-border object-cover" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-studio-navy">{text(`参考图 ${index + 1}`, `Reference ${index + 1}`)}</div>
                      <div className="mt-1 break-all text-xs font-medium text-studio-mutedText">{asset.file_name} · {text("素材", "Asset")} #{asset.id}</div>
                    </div>
                    <span className="status-pill">{assetItems.length > 0 && roleMatches ? text(`已提取 ${assetItems.length} 项`, `${assetItems.length} extracted`) : text("待提取", "Pending")}</span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <label className="block min-w-0">
                      <span className="mb-1 block text-xs font-semibold text-studio-mutedText">{text("参考角色", "Reference role")}</span>
                      <select value={role} disabled={isAnalyzing} onChange={(event) => onRoleChange(asset.id, event.target.value as ReferenceRole)} className="form-field w-full">
                        {REFERENCE_ROLES.map((option) => <option key={option} value={option}>{localeLabel(option, locale)}</option>)}
                      </select>
                    </label>
                    <button type="button" disabled={isAnalyzing} onClick={() => onAnalyze(asset)} className="btn-secondary self-end">
                      {isAnalyzing ? text("GLM 提取中...", "Extracting with GLM...") : assetItems.length > 0 && roleMatches ? text("重新提取", "Extract again") : text("GLM 提取", "Extract with GLM")}
                    </button>
                  </div>
                  {!roleMatches ? <div className="mt-2 text-xs font-semibold text-amber-700">{text("参考角色已改变，请按新角色重新提取。", "The reference role changed. Extract again using the new role.")}</div> : null}
                </div>
              </div>
              {assetItems.length > 0 && roleMatches ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {assetItems.map((item) => {
                    const isSaving = savingItemIds.includes(item.id);
                    return (
                      <div key={item.id} className="min-w-0 rounded-lg border border-studio-border bg-studio-panelBg p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="break-words text-sm font-semibold text-studio-navy">{item.name}</div>
                            <div className="mt-1 break-words text-xs text-studio-mutedText">{item.category ?? text("参考特征", "Reference attribute")} · {item.material ?? text("材质未识别", "Material not identified")} · {item.color ?? text("颜色未识别", "Color not identified")}</div>
                          </div>
                          <span className="status-pill shrink-0">{item.selection_state === "keep" ? text("采用", "Use") : item.selection_state === "remove" ? text("忽略", "Ignore") : text("待确认", "Pending")}</span>
                        </div>
                        {item.bbox ? <AssetCropPreview assetId={asset.id} bbox={item.bbox} label={item.name} /> : null}
                        {item.color_hex ? (
                          <div className="mt-2 flex items-center gap-2 text-xs font-medium text-studio-mutedText">
                            <span className="h-5 w-5 rounded border border-studio-border" style={{ backgroundColor: item.color_hex }} />
                            {text("推断色号", "Inferred color")}: {item.color_hex}
                          </div>
                        ) : null}
                        {item.inference_reason ? <div className="mt-2 break-words text-xs text-studio-mutedText">{item.inference_reason}</div> : null}
                        <div className="mt-3 flex gap-2">
                          <button type="button" disabled={isSaving} onClick={() => onSelect(item, "keep")} className={item.selection_state === "keep" ? "btn-primary px-3 py-2 text-xs" : "btn-secondary px-3 py-2 text-xs"}>{text("采用", "Use")}</button>
                          <button type="button" disabled={isSaving} onClick={() => onSelect(item, "remove")} className={item.selection_state === "remove" ? "rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white" : "btn-secondary px-3 py-2 text-xs"}>{text("忽略", "Ignore")}</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AssetCropPreview({
  assetId,
  bbox,
  label,
}: {
  assetId: number;
  bbox: { x: number; y: number; width: number; height: number };
  label: string;
}) {
  const { text } = useLocale();
  const sourceUrl = useAssetContentUrl(assetId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!sourceUrl || !canvas) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const sx = Math.round(image.naturalWidth * bbox.x);
      const sy = Math.round(image.naturalHeight * bbox.y);
      const sw = Math.max(1, Math.round(image.naturalWidth * bbox.width));
      const sh = Math.max(1, Math.round(image.naturalHeight * bbox.height));
      const outputWidth = Math.min(480, sw);
      const outputHeight = Math.max(1, Math.round(outputWidth * sh / sw));
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        setError(text("浏览器无法创建裁切预览。", "The app could not create a crop preview."));
        return;
      }
      context.clearRect(0, 0, outputWidth, outputHeight);
      context.drawImage(image, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight);
      setError(undefined);
    };
    image.onerror = () => {
      if (!cancelled) setError(text("无法读取原图裁切区域。", "The crop region could not be read from the source image."));
    };
    image.src = sourceUrl;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [bbox.height, bbox.width, bbox.x, bbox.y, sourceUrl, text]);

  return (
    <div className="mt-3">
      <div className="mb-1 text-xs font-semibold text-studio-mutedText">{text("原图定位", "Source location")}: {label}</div>
      <canvas ref={canvasRef} className="max-h-40 w-full rounded-md border border-studio-border bg-white object-contain" />
      {error ? <div className="mt-1 text-xs font-semibold text-amber-700">{error}</div> : null}
    </div>
  );
}

function roleFromItems(items: ExtractedItemRecord[], assetId: number): ReferenceRole {
  const label = items.find((item) => item.asset_id === assetId)?.room_type?.replace(/^参考图：/, "");
  return REFERENCE_ROLES.includes(label as ReferenceRole) ? label as ReferenceRole : "风格与配色";
}

function describeReferenceReview(
  assets: AssetRecord[],
  items: ExtractedItemRecord[],
  roles: Record<number, ReferenceRole>,
  useReferenceImages: boolean,
  locale: "zh-CN" | "en",
): string | undefined {
  if (assets.length === 0) return undefined;
  if (!useReferenceImages) return locale === "zh-CN" ? "参考图已保留在项目中，但本次生成不会发送或使用这些图片。" : "References remain in the project, but this generation will not send or use them.";
  for (const asset of assets) {
    const role = roles[asset.id] ?? "风格与配色";
    const assetItems = items.filter((item) => item.asset_id === asset.id);
    if (assetItems.length === 0) return locale === "zh-CN" ? `参考图 #${asset.id} 将按“${role}”直接使用；GLM 提取是可选的精细控制。` : `Reference #${asset.id} will be used directly as ${localeLabel(role, locale)}; GLM extraction is optional.`;
    if (assetItems.some((item) => item.room_type !== `参考图：${role}`)) return locale === "zh-CN" ? `参考图 #${asset.id} 将按新角色“${role}”直接使用；如需精细控制，可重新提取。` : `Reference #${asset.id} will be used directly under its new ${localeLabel(role, locale)} role. Extract again for detailed control.`;
    if (assetItems.some((item) => !["keep", "remove"].includes(item.selection_state ?? "undecided"))) return locale === "zh-CN" ? `参考图 #${asset.id} 仍有未确认项；本次生成只会把已采用项写入提示词，未确认项不会阻止生成。` : `Reference #${asset.id} still has pending items. Only selected items enter the prompt; pending items do not block generation.`;
  }
  if (!items.some((item) => item.selection_state === "keep")) return locale === "zh-CN" ? "当前没有人工采用的提取项；参考图仍会按所选角色直接用于本次生成。" : "No extracted items were manually selected; references will still be used according to their selected roles.";
  return undefined;
}

function buildReferenceReviewSnapshot(
  assets: AssetRecord[],
  items: ExtractedItemRecord[],
  roles: Record<number, ReferenceRole>,
  useReferenceImages: boolean,
): string {
  return JSON.stringify({
    version: 1,
    use_reference_images: useReferenceImages,
    references: assets.map((asset) => ({
      asset_id: asset.id,
      role: roles[asset.id] ?? "风格与配色",
      items: items
        .filter((item) => item.asset_id === asset.id)
        .sort((left, right) => left.id - right.id)
        .map((item) => ({
          id: item.id,
          state: item.selection_state ?? "undecided",
          name: item.name,
          material: item.material ?? null,
          color: item.color ?? null,
          color_hex: item.color_hex ?? null,
          bbox: item.bbox ?? null,
        })),
    })),
  });
}

function buildReferenceSummary(
  assets: AssetRecord[],
  selectedItems: ExtractedItemRecord[],
  ignoredItems: ExtractedItemRecord[],
  roles: Record<number, ReferenceRole>,
  locale: "zh-CN" | "en",
): string {
  return assets.map((asset, index) => {
    const role = roles[asset.id] ?? "风格与配色";
    const descriptions = selectedItems
      .filter((item) => item.asset_id === asset.id)
      .map((item) => `${item.name}${item.material ? `，${item.material}` : ""}${item.color ? `，${item.color}` : ""}${item.color_hex ? `（${item.color_hex}）` : ""}`);
    const ignored = ignoredItems.filter((item) => item.asset_id === asset.id).map((item) => item.name);
    const adoptedText = descriptions.length > 0 ? descriptions.join(locale === "zh-CN" ? "；" : "; ") : (locale === "zh-CN" ? "未指定提取项，按参考角色整体参考" : "no extracted items specified; use the overall reference role");
    const ignoredText = ignored.length > 0 ? (locale === "zh-CN" ? `；明确忽略：${ignored.join("、")}` : `; explicitly ignore: ${ignored.join(", ")}`) : "";
    return locale === "zh-CN" ? `参考图 ${index + 1}（${role}）：${adoptedText}${ignoredText}` : `Reference ${index + 1} (${localeLabel(role, locale)}): ${adoptedText}${ignoredText}`;
  }).join(locale === "zh-CN" ? "。 " : ". ");
}
