import { useEffect, useState } from "react";

import { AssetUploader } from "../components/AssetUploader";
import { BoardPreview } from "../components/BoardPreview";
import { ExtractedItemReview } from "../components/ExtractedItemReview";
import { ExportDialog } from "../components/ExportDialog";
import { GeneratedResultPanel } from "../components/GeneratedResultPanel";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { ProjectContextBar } from "../components/ProjectContextBar";
import { WorkflowModelOverride } from "../components/WorkflowModelOverride";
import { WorkflowModelStatusCard } from "../components/WorkflowModelStatusCard";
import { aspectRatioOptions } from "../lib/aspect-ratio";
import { itemBudgetTotals, itemReviewSnapshot, keptReviewedItems } from "../lib/board-item-review";
import {
  findRunnableImageModelConfig,
  findRunnableVisionModelConfig,
  resolveRunnableImageSelection,
  resolveRunnableVisionSelection,
} from "../lib/model-selection";
import { latestInputsForSource, latestOutputForModule, outputMatchesBoardReview } from "../lib/workflow-history";
import { firstResultAsset } from "../lib/task-output";
import { useBoardStore } from "../stores/useBoardStore";
import { useAssetStore } from "../stores/useAssetStore";
import { useModelStore } from "../stores/useModelStore";
import { useProjectStore } from "../stores/useProjectStore";
import { useTaskStore } from "../stores/useTaskStore";
import type { AssetRecord } from "../types";
import { useLocale } from "../i18n/locale";

export function SingleRoomBoardPage() {
  const { locale, message, text } = useLocale();
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const extractedItems = useBoardStore((state) => state.extractedItems);
  const boardDocuments = useBoardStore((state) => state.boardDocuments);
  const singleRoomFiles = useBoardStore((state) => state.singleRoomFiles);
  const isLoadingSingleRoom = useBoardStore((state) => state.isLoadingSingleRoom);
  const isLoadingExtractedItems = useBoardStore((state) => state.isLoadingExtractedItems);
  const savingSelectionItemIds = useBoardStore((state) => state.savingSelectionItemIds);
  const error = useBoardStore((state) => state.error);
  const extractionSource = useBoardStore((state) => state.extractionSource);
  const currentSingleRoomAssetId = useBoardStore((state) => state.currentSingleRoomAssetId);
  const setSingleRoomFiles = useBoardStore((state) => state.setSingleRoomFiles);
  const setCurrentSingleRoomAssetId = useBoardStore((state) => state.setCurrentSingleRoomAssetId);
  const loadPersistedProjectBoardData = useBoardStore((state) => state.loadPersistedProjectBoardData);
  const loadExtractedItems = useBoardStore((state) => state.loadExtractedItems);
  const extractItemsFromAsset = useBoardStore((state) => state.extractItemsFromAsset);
  const generateSingleRoomBoards = useBoardStore((state) => state.generateSingleRoomBoards);
  const saveExtractedItemSelection = useBoardStore((state) => state.saveExtractedItemSelection);
  const clearError = useBoardStore((state) => state.clearError);
  const queueProviderImageTask = useTaskStore((state) => state.queueProviderImageTask);
  const loadAssets = useAssetStore((state) => state.loadAssets);
  const assets = useAssetStore((state) => state.assets);
  const activeProvider = useModelStore((state) => state.activeProviderByModule.boards);
  const activeModel = useModelStore((state) => state.activeModelByModule.boards);
  const activeProviderConfigId = useModelStore((state) => state.activeProviderConfigIdByModule.boards);
  const extractionProvider = useModelStore((state) => state.activeProviderByModule.room_board_extraction);
  const extractionModel = useModelStore((state) => state.activeModelByModule.room_board_extraction);
  const extractionProviderConfigId = useModelStore((state) => state.activeProviderConfigIdByModule.room_board_extraction);
  const workflowModelOverrides = useModelStore((state) => state.workflowModelOverrides);
  const providerConfigs = useModelStore((state) => state.providerConfigs);
  const [referenceStyle, setReferenceStyle] = useState(locale === "zh-CN" ? "生成一张柔和极简风格的软装方案板，包含材质、色彩、家具和报价摘要。" : "Create a soft-minimal furnishing board with materials, colors, furniture, and a quotation summary.");
  const [materialDirection, setMaterialDirection] = useState(locale === "zh-CN" ? "胡桃木、羊羔绒、洞石" : "walnut, boucle, travertine");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [uploadedAssets, setUploadedAssets] = useState<AssetRecord[]>([]);
  const [resultAsset, setResultAsset] = useState<AssetRecord | undefined>();
  const [generationError, setGenerationError] = useState<string | undefined>();
  const [generationNotice, setGenerationNotice] = useState<string | undefined>();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  const imageModelFallback = { provider: activeProvider, model: activeModel, providerConfigId: activeProviderConfigId };
  const imageModelSelection = workflowModelOverrides["room_board.image"] ?? imageModelFallback;
  const resolvedImageModelSelection = resolveRunnableImageSelection(providerConfigs, imageModelSelection);
  const extractionModelFallback = { provider: extractionProvider, model: extractionModel, providerConfigId: extractionProviderConfigId };
  const extractionModelSelection = workflowModelOverrides["room_board.extraction"] ?? extractionModelFallback;
  const resolvedExtractionModelSelection = resolveRunnableVisionSelection(providerConfigs, extractionModelSelection);
  const selectedConfig = findRunnableImageModelConfig(providerConfigs, resolvedImageModelSelection);
  const extractionSelectedConfig = findRunnableVisionModelConfig(providerConfigs, resolvedExtractionModelSelection);
  const extractionAssetId = uploadedAssets[0]?.id ?? currentSingleRoomAssetId;
  const currentExtractedItems = extractedItems.filter((item) => item.asset_id === extractionAssetId);
  const keptItems = keptReviewedItems(currentExtractedItems);
  const budgetTotals = itemBudgetTotals(currentExtractedItems);
  const hasBudget = keptItems.some((item) => item.price_min != null || item.price_max != null);
  const budgetLabel = hasBudget
    ? text(`人民币 ${budgetTotals.min.toLocaleString()} - ${budgetTotals.max.toLocaleString()}`, `CNY ${budgetTotals.min.toLocaleString()} - ${budgetTotals.max.toLocaleString()}`)
    : text("未填写（可选）", "Not provided (optional)");
  const itemSummary = keptItems.length > 0
    ? keptItems.map((item) => `${item.name}${item.material ? ` (${item.material})` : ""}`).join("; ")
    : text("未指定强制保留元素，请以当前上传图片和设计提示为依据。", "No mandatory retained items were specified; use the current uploaded image and design prompt as the source.");
  const selectedItemKey = keptItems.map((item) => item.id).sort((a, b) => a - b).join(",");
  const reviewSnapshot = itemReviewSnapshot(currentExtractedItems);
  const hasCurrentReport = boardDocuments.some((document) =>
    ["material_board", "color_board", "board_preview", "quote_card"].includes(document.board_type)
      && hasSameAssetIds(document.data_json?.source_asset_ids, extractionAssetId ? [extractionAssetId] : []),
  );
  const boardPrompt = locale === "zh-CN" ? [
    "生成一张可直接嵌入客户正式交付报告的室内方案板主视觉。",
    `画布比例 ${aspectRatio}，以上传的当前房间图为唯一空间与风格依据，保持原建筑结构、视角、门窗和主要家具位置。`,
    "采用专业室内设计提案版式：左侧约 55% 至 60% 为高质量空间主视觉；右侧约 40% 至 45% 依次放置材质板、色彩板、家具与灯光；底部使用简洁的设计说明和报价摘要栏。所有分区必须留白充足、对齐严谨、层级清楚，不得拥挤、重叠或裁切。",
    "方案板必须包含清晰可读的简短中文标题“材质板”“色彩板”“家具与灯光”“设计说明”“报价摘要”，不得完全省略文字；每个标题下只允许短标签或一句短说明，不得生成段落。",
    "材质板最多展示 3 个代表性材质，色彩板最多展示 5 个色块，家具与灯光最多展示 4 个代表性样本。人工确认元素用于约束主视觉和选择代表性样本，不要把每个元素都做成独立缩略图。",
    `设计方向：${referenceStyle}。材质方向：${materialDirection}。`, `人工确认元素：${itemSummary}`,
    hasBudget ? `预算范围由报告程序准确排版为 ${budgetLabel}，不要在图片里生成价格。` : "预算未填写，不要在图片里生成价格、购买链接或采购信息。",
    "不要生成大段文字、文字重叠、文字裁切、乱码、虚构品牌、虚构产品、额外家具、额外房间、户型图或与当前图片无关的历史元素。",
  ].join(" ") : [
    "Create a primary interior board visual suitable for direct placement in a formal client delivery report.",
    `Canvas ratio: ${aspectRatio}. Use the current uploaded room image as the only spatial and stylistic source. Preserve its architecture, viewpoint, doors, windows, and main furniture positions.`,
    "Use a professional interior proposal layout: reserve approximately 55-60% for a high-quality room hero; organize the remaining 40-45% into Material Palette, Color Palette, and Furniture & Lighting sections; use a slim bottom strip for Design Notes and Quotation Summary. Every section must have generous whitespace, strict alignment, and clear hierarchy, with no crowding, overlap, or clipping.",
    "The board must include these concise, readable English headings: Material Palette, Color Palette, Furniture & Lighting, Design Notes, and Quotation Summary. Do not omit typography entirely. Use only short labels or one short sentence below a heading, never paragraphs.",
    "Show no more than 3 representative material swatches, 5 color chips, and 4 representative furniture or lighting samples. Use human-confirmed items to constrain the hero visual and choose representative samples; do not turn every item into a separate thumbnail.",
    `Design direction: ${referenceStyle}. Material direction: ${materialDirection}.`, `Human-confirmed items: ${itemSummary}`,
    hasBudget ? `The report renderer will typeset the budget as ${budgetLabel}; do not generate prices inside the image.` : "No budget was provided. Do not generate prices, purchase links, or procurement information in the image.",
    "Do not generate long text, overlapping text, clipped text, garbled text, invented brands or products, extra furniture or rooms, floor plans, historical project content, or unrelated elements.",
  ].join(" ");

  useEffect(() => {
    void loadPersistedProjectBoardData(activeProjectId);
    if (activeProjectId) {
      void loadAssets(activeProjectId);
    }
  }, [activeProjectId, loadAssets, loadPersistedProjectBoardData]);

  useEffect(() => {
    if (!activeProjectId) return;
    const shouldHydrateHistory = uploadedAssets.length === 0 && singleRoomFiles.length === 0;
    const currentInputs = uploadedAssets.length > 0
      ? uploadedAssets
      : shouldHydrateHistory
        ? latestInputsForSource(assets, "single_room_board", activeProjectId).slice(0, 1)
        : [];
    if (shouldHydrateHistory) {
      setUploadedAssets(currentInputs);
      if (currentInputs[0]?.id && !currentSingleRoomAssetId) {
        setCurrentSingleRoomAssetId(currentInputs[0].id);
      }
    }
    if (!resultAsset) {
      const historicalResult = latestOutputForModule(assets, "single_room_board", activeProjectId, currentInputs.map((asset) => asset.id));
      setResultAsset(outputMatchesBoardReview(historicalResult, currentInputs.map((asset) => asset.id), keptItems.map((item) => item.id), reviewSnapshot) ? historicalResult : undefined);
    }
  }, [activeProjectId, assets, currentSingleRoomAssetId, resultAsset, reviewSnapshot, selectedItemKey, setCurrentSingleRoomAssetId, singleRoomFiles.length, uploadedAssets.length]);

  useEffect(() => {
    if (resultAsset && !outputMatchesBoardReview(resultAsset, extractionAssetId ? [extractionAssetId] : [], keptItems.map((item) => item.id), reviewSnapshot)) {
      setResultAsset(undefined);
    }
  }, [extractionAssetId, resultAsset, reviewSnapshot, selectedItemKey]);

  useEffect(() => {
    if (currentSingleRoomAssetId) {
      void loadExtractedItems({ projectId: activeProjectId, assetId: currentSingleRoomAssetId });
    }
  }, [activeProjectId, currentSingleRoomAssetId, loadExtractedItems]);

  const generateReport = async () => {
    if (isGeneratingReport) return;
    if (!activeProjectId || !extractionAssetId) {
      setGenerationError(text("生成报告前请先创建或选择项目并上传房间图。", "Create or select a project and upload a room image before generating report content."));
      return;
    }
    setGenerationError(undefined);
    setGenerationNotice(undefined);
    setIsGeneratingReport(true);
    try {
      await generateSingleRoomBoards({
        projectId: activeProjectId,
        assetId: extractionAssetId,
        roomType: text("单房间", "Single Room"),
        style: referenceStyle,
        selectedItemIds: keptItems.map((item) => item.id),
        keepItems: keptItems.map((item) => item.name),
        replaceItems: [],
        budgetLabel,
        paramsSnapshot: {
          budget_min: budgetTotals.min,
          budget_max: budgetTotals.max,
          source_asset_ids: [extractionAssetId],
          selected_item_ids: keptItems.map((item) => item.id),
          review_schema_version: 2,
          delivery_prompt_version: "qigou-board-delivery-v2",
          review_snapshot: reviewSnapshot,
        },
        skipUpload: true,
        outputLanguage: locale,
      });
      setGenerationNotice(text("单房间报告内容已生成，可在下方预览或导出；没有调用图片模型。", "Single-room report content was generated without calling an image model and can now be previewed or exported."));
    } catch (error) {
      setGenerationError(error instanceof Error ? text(`报告生成失败：${error.message}`, `Report generation failed: ${error.message}`) : text("报告生成失败。", "Report generation failed."));
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const extractSingleRoomItems = async () => {
    if (!extractionAssetId || !activeProjectId) return;
    const confirmed = window.confirm(locale === "zh-CN" ? [
      "即将使用 GLM 提取房间信息。",
      `目标 Provider：${resolvedExtractionModelSelection.provider}`,
      `目标模型：${resolvedExtractionModelSelection.model}`,
      "所选项目图片和提取提示词会发送给服务商，结构化结果会保存到项目归档。",
      "请确认你有权上传这些客户图片和项目素材。",
    ].join("\n") : [
      "GLM will extract information from the room image.",
      `Provider: ${resolvedExtractionModelSelection.provider}`,
      `Model: ${resolvedExtractionModelSelection.model}`,
      "The selected image and extraction prompt will be sent to the provider. Structured results will be saved in the project archive.",
      "Confirm that you have permission to upload this client image and project material.",
    ].join("\n"));
    if (!confirmed) return;
    await extractItemsFromAsset({
      projectId: activeProjectId,
      assetId: extractionAssetId,
      roomType: locale === "zh-CN" ? "单房间" : "Single Room",
      style: referenceStyle,
      providerName: resolvedExtractionModelSelection.provider,
      modelName: resolvedExtractionModelSelection.model,
      providerConfigId: extractionSelectedConfig?.id ?? null,
      workflowSlot: "room_board.extraction",
      outputLanguage: locale,
      dataFlowConfirmed: true,
    });
  };

  const queueBoardImage = async () => {
    if (isGenerating) return;
    if (!activeProjectId) {
      setGenerationError(text("生成前请先创建或选择项目。", "Create or select a project before generating."));
      return;
    }
    if (!extractionAssetId) {
      setGenerationError(text("请先上传单张房间图。", "Upload one room image first."));
      return;
    }
    if (!selectedConfig) {
      setGenerationError(text("当前没有可运行的方案板图片模型，请先保存并应用图片模型线路。", "No runnable board image route is available. Save and apply an image model route first."));
      return;
    }
    setGenerationError(undefined);
    setGenerationNotice(undefined);
    setResultAsset(undefined);
    setIsGenerating(true);
    try {
      const task = await queueProviderImageTask({
        project_id: activeProjectId,
        module: "single_room_board",
        task_type: "provider_single_room_board",
        capability: "image_to_image",
        provider: resolvedImageModelSelection.provider,
        model_name: resolvedImageModelSelection.model,
        provider_config_id: selectedConfig.id,
        payload_summary: `${keptItems.length} 个已确认元素 · ${budgetLabel} · ${aspectRatio}`,
        payload_json: {
          asset_ids: [extractionAssetId],
          room_type: "单房间",
          budget_range: hasBudget ? { min: budgetTotals.min, max: budgetTotals.max, currency: "人民币" } : undefined,
          style_prompt: referenceStyle,
          prompt: boardPrompt,
          material_direction: materialDirection,
          output_count: 1,
          aspect_ratio: aspectRatio,
          selected_items: keptItems.map((item) => ({ id: item.id, name: item.name, price_min: item.price_min, price_max: item.price_max })),
          selected_item_ids: keptItems.map((item) => item.id),
          review_schema_version: 2,
          delivery_prompt_version: "qigou-board-delivery-v2",
          review_snapshot: reviewSnapshot,
          require_source_images: true,
        },
          prompt_snapshot: {
          resolved_prompt: boardPrompt,
          negative_prompt: text("画面拥挤、分区重叠、文字重叠、文字裁切、乱码、标签混乱、已删除元素、其他历史图片中的家具", "crowded layout, overlapping sections, overlapping text, clipped text, garbled text, confusing labels, removed items, furniture from historical images"),
        },
        params_snapshot: { budget_min: budgetTotals.min, budget_max: budgetTotals.max, selected_item_ids: keptItems.map((item) => item.id), delivery_prompt_version: "qigou-board-delivery-v2", review_snapshot: reviewSnapshot, output_count: 1, aspect_ratio: aspectRatio },
      });
      setResultAsset(firstResultAsset(task.output_payload_json));
      setGenerationNotice(text("方案板图片已由当前图片模型生成并归档；报告内容可单独生成或导出。", "The board image was generated and archived. Report content can still be generated or exported independently."));
      void loadAssets(activeProjectId);
    } catch (error) {
      setGenerationError(error instanceof Error ? text(`方案板图片生成失败：${error.message}`, `Board image generation failed: ${error.message}`) : text("方案板图片生成失败。", "Board image generation failed."));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="page-stack min-w-0 overflow-x-hidden">
      <section className="page-hero">
        <div className="eyebrow">{text("单房间方案板", "Single-Room Board")}</div>
        <h2 className="hero-title">{text("上传单张房间图，生成软装方案板。", "Upload one room image and create a furnishing board.")}</h2>
        <p className="body-muted mt-2 max-w-3xl">{text("从一张房间图生成材质板、色彩板、家具清单和报价摘要。", "Create material and color boards, a furniture list, and a quotation summary from one room image.")}</p>
      </section>
      <ProjectContextBar label={text("单房间方案板项目", "Single-room board project")} />

      {isLoadingSingleRoom || isGenerating ? <LoadingOverlay label={text("正在生成 1 张房间方案板...", "Generating one room board...")} /> : null}
      {error ? <div className="soft-alert">{message(error)}</div> : null}

      <section className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1.15fr)_420px]">
        <div className="min-w-0 space-y-5">
          <AssetUploader
            title={text("1. 上传单张房间图", "1. Upload one room image")}
            description={text("上传需要生成方案板、材质、清单和报价结果的房间渲染图。", "Upload the room rendering used for the board, materials, list, and quotation output.")}
            selectedFiles={singleRoomFiles}
            existingAssets={uploadedAssets}
            onFilesSelected={(files) => {
              clearError();
              setSingleRoomFiles(files);
              setUploadedAssets([]);
              setCurrentSingleRoomAssetId(undefined);
              setResultAsset(undefined);
              setGenerationError(undefined);
              setGenerationNotice(undefined);
            }}
            uploadOptions={activeProjectId ? { projectId: activeProjectId, assetType: "render_input", source: "single_room_board" } : undefined}
            onAssetsUploaded={(assets) => {
              const nextAssets = assets.slice(0, 1);
              setUploadedAssets(nextAssets);
              setCurrentSingleRoomAssetId(nextAssets[0]?.id);
              setResultAsset(undefined);
              setGenerationError(undefined);
              setGenerationNotice(undefined);
            }}
            onAssetRemoved={(asset) => {
              setUploadedAssets((current) => current.filter((item) => item.id !== asset.id));
              if (currentSingleRoomAssetId === asset.id) setCurrentSingleRoomAssetId(undefined);
              setResultAsset(undefined);
              setGenerationError(undefined);
              setGenerationNotice(undefined);
              if (activeProjectId) void loadPersistedProjectBoardData(activeProjectId);
            }}
          />
          {generationError ? <div className="soft-alert">{message(generationError)}</div> : null}
          {generationNotice ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
              {generationNotice}
            </div>
          ) : null}

          {resultAsset ? (
            <GeneratedResultPanel asset={resultAsset} title={text("已生成方案板", "Generated board")} aspectRatio={aspectRatio} />
          ) : null}

          {hasCurrentReport ? (
            <BoardPreview
              mode="single"
              heroAsset={resultAsset ?? uploadedAssets[0]}
              currentSourceAssets={uploadedAssets}
              selectedItemIds={keptItems.map((item) => item.id)}
              reviewSnapshot={reviewSnapshot}
            />
          ) : null}

          <div className="panel-surface min-w-0 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="eyebrow">{text("元素", "Items")}</div>
                <h3 className="section-title mt-2">{text("检查提取到的家具和材质", "Review extracted furniture and materials")}</h3>
                {extractionSource ? <div className="mt-1 text-xs font-semibold text-studio-mutedText">{text("来源", "Source")}: {extractionSource}</div> : null}
              </div>
              <button
                type="button"
                disabled={isLoadingExtractedItems || !extractionAssetId || !activeProjectId}
                onClick={() => void extractSingleRoomItems().catch((error) => setGenerationError(error instanceof Error ? error.message : text("元素提取失败。", "Item extraction failed.")))}
                className="btn-secondary"
              >
                {isLoadingExtractedItems ? text("分析中...", "Analyzing...") : text("提取元素", "Extract items")}
              </button>
            </div>

            <div className="mt-4 grid gap-3 xl:grid-cols-2">
              <ExtractedItemReview
                items={currentExtractedItems}
                savingItemIds={savingSelectionItemIds}
                emptyMessage={text("上传房间图后，点击“提取元素”分析当前图片中可见的家具和材质。", "After uploading a room image, select Extract items to analyze visible furniture and materials.")}
                onSave={(item, state, details) => saveExtractedItemSelection(item.id, state, item.replacement_notes, details)}
              />
            </div>
          </div>
          <ExportDialog
            reportFileName="single-room-board-report.svg"
            mode="single"
            sourceAssetIds={extractionAssetId ? [extractionAssetId] : []}
            selectedItemIds={keptItems.map((item) => item.id)}
            reviewSnapshot={reviewSnapshot}
            generatedAssetId={resultAsset?.id}
          />
        </div>

        <aside className="panel-surface h-fit min-w-0 p-5">
          <div className="eyebrow">{text("2. 方案板设置", "2. Board settings")}</div>
          <h3 className="section-title mt-2">{text("提示词、风格和预算", "Prompt, style, and budget")}</h3>

          <div className="mt-4 space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("方案板提示词", "Board prompt")}</span>
              <textarea value={referenceStyle} onChange={(event) => setReferenceStyle(event.target.value)} className="textarea-field h-36 w-full" />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("材质方向", "Material direction")}</span>
              <input value={materialDirection} onChange={(event) => setMaterialDirection(event.target.value)} className="form-field w-full" />
            </label>
            <div className="rounded-lg border border-studio-border bg-studio-panelBg p-3 text-sm font-semibold text-studio-navy">
              {text(`已保留 ${keptItems.length} 个元素 · 预算合计：${budgetLabel}`, `${keptItems.length} retained items · Budget total: ${budgetLabel}`)}
            </div>
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("画面比例", "Aspect ratio")}</span>
              <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)} className="form-field w-full">
                {aspectRatioOptions.map((ratio) => <option key={ratio}>{ratio}</option>)}
              </select>
            </label>
            <WorkflowModelStatusCard
              slotKey="room_board.image"
              fallback={imageModelFallback}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" disabled={uploadedAssets.length === 0 || isGeneratingReport || !activeProjectId} onClick={() => void generateReport()} className="btn-secondary w-full">
                {isGeneratingReport ? text("正在生成报告...", "Generating report...") : text("生成报告内容", "Generate report content")}
              </button>
              <button type="button" disabled={uploadedAssets.length === 0 || isGenerating || !activeProjectId} onClick={() => void queueBoardImage()} className="btn-primary w-full">
                {isGenerating ? text("正在生成图片...", "Generating image...") : text("生成方案板图片", "Generate board image")}
              </button>
            </div>
          </div>
        </aside>
      </section>

      <div className="grid gap-5">
        <WorkflowModelOverride
          slotKey="room_board.image"
          title={text("方案板图像模型", "Board image model")}
          description={text("仅在点击“生成方案板图片”创建最终方案板图片时使用。", "Used only when Generate board image creates the final board image.")}
          capability="image"
          fallback={imageModelFallback}
        />
        <WorkflowModelOverride
          slotKey="room_board.extraction"
          title={text("多模态提取模型", "Multimodal extraction model")}
          description={text("仅用于“提取元素”，使用独立的 GLM 提取配置（中国大陆或国际），不受方案板图片模型切换影响。", "Used only for item extraction. It uses an independent mainland or international GLM configuration and is not affected by board image model changes.")}
          capability="vision"
          fallback={extractionModelFallback}
        />
      </div>
    </div>
  );
}

function hasSameAssetIds(value: unknown, expected: number[]): boolean {
  if (!Array.isArray(value) || expected.length === 0) return false;
  const actual = [...new Set(value.map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  const normalizedExpected = [...new Set(expected)].sort((a, b) => a - b);
  return actual.length === normalizedExpected.length && actual.every((item, index) => item === normalizedExpected[index]);
}
