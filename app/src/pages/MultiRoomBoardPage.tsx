import { useEffect, useState } from "react";

import { AssetUploader } from "../components/AssetUploader";
import { BoardPreview } from "../components/BoardPreview";
import { ExtractedItemReview } from "../components/ExtractedItemReview";
import { ExportDialog } from "../components/ExportDialog";
import { GeneratedResultPanel } from "../components/GeneratedResultPanel";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { ProjectContextBar } from "../components/ProjectContextBar";
import { RoomTagger } from "../components/RoomTagger";
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
import { zhLabel } from "../lib/zh-labels";
import { latestInputsForSource, latestOutputForModule, outputMatchesBoardReview } from "../lib/workflow-history";
import { firstResultAsset } from "../lib/task-output";
import { useBoardStore } from "../stores/useBoardStore";
import { useAssetStore } from "../stores/useAssetStore";
import { useModelStore } from "../stores/useModelStore";
import { useProjectStore } from "../stores/useProjectStore";
import { useTaskStore } from "../stores/useTaskStore";
import type { AssetRecord } from "../types";
import { useLocale } from "../i18n/locale";

export function MultiRoomBoardPage() {
  const { locale, message, text } = useLocale();
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const selectedRoomIds = useBoardStore((state) => state.selectedRoomIds);
  const extractedItems = useBoardStore((state) => state.extractedItems);
  const boardDocuments = useBoardStore((state) => state.boardDocuments);
  const multiRoomFiles = useBoardStore((state) => state.multiRoomFiles);
  const isLoadingMultiRoom = useBoardStore((state) => state.isLoadingMultiRoom);
  const isLoadingExtractedItems = useBoardStore((state) => state.isLoadingExtractedItems);
  const savingSelectionItemIds = useBoardStore((state) => state.savingSelectionItemIds);
  const error = useBoardStore((state) => state.error);
  const setMultiRoomFiles = useBoardStore((state) => state.setMultiRoomFiles);
  const loadPersistedProjectBoardData = useBoardStore((state) => state.loadPersistedProjectBoardData);
  const extractItemsFromAsset = useBoardStore((state) => state.extractItemsFromAsset);
  const generateMultiRoomBoards = useBoardStore((state) => state.generateMultiRoomBoards);
  const saveExtractedItemSelection = useBoardStore((state) => state.saveExtractedItemSelection);
  const clearError = useBoardStore((state) => state.clearError);
  const queueProviderImageTask = useTaskStore((state) => state.queueProviderImageTask);
  const loadAssets = useAssetStore((state) => state.loadAssets);
  const assets = useAssetStore((state) => state.assets);
  const activeProvider = useModelStore((state) => state.activeProviderByModule.boards);
  const activeModel = useModelStore((state) => state.activeModelByModule.boards);
  const activeProviderConfigId = useModelStore((state) => state.activeProviderConfigIdByModule.boards);
  const extractionProvider = useModelStore((state) => state.activeProviderByModule.multi_room_board_extraction);
  const extractionModel = useModelStore((state) => state.activeModelByModule.multi_room_board_extraction);
  const extractionProviderConfigId = useModelStore((state) => state.activeProviderConfigIdByModule.multi_room_board_extraction);
  const workflowModelOverrides = useModelStore((state) => state.workflowModelOverrides);
  const providerConfigs = useModelStore((state) => state.providerConfigs);
  const [stylePrompt, setStylePrompt] = useState(locale === "zh-CN" ? "根据上传的多房间图片生成一张清晰的全案软装方案板。必须保留原图中的色彩、家具形体、材质色调、灯光和重点色元素。" : "Create a clear whole-project furnishing board from the uploaded room images. Preserve the original colors, furniture forms, material tones, lighting, and accent colors.");
  const [materialPalette, setMaterialPalette] = useState(locale === "zh-CN" ? "保留原图配色和可见材质" : "Preserve original colors and visible materials");
  const [budgetAllocation, setBudgetAllocation] = useState(locale === "zh-CN" ? "按各房间人工确认的元素预算汇总" : "Summarize budgets from human-confirmed items in each room");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [uploadedAssets, setUploadedAssets] = useState<AssetRecord[]>([]);
  const [resultAsset, setResultAsset] = useState<AssetRecord | undefined>();
  const [generationError, setGenerationError] = useState<string | undefined>();
  const [generationNotice, setGenerationNotice] = useState<string | undefined>();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  const imageModelFallback = { provider: activeProvider, model: activeModel, providerConfigId: activeProviderConfigId };
  const imageModelSelection = workflowModelOverrides["multi_room_board.image"] ?? imageModelFallback;
  const resolvedImageModelSelection = resolveRunnableImageSelection(providerConfigs, imageModelSelection);
  const extractionModelFallback = { provider: extractionProvider, model: extractionModel, providerConfigId: extractionProviderConfigId };
  const extractionModelSelection = workflowModelOverrides["multi_room_board.extraction"] ?? extractionModelFallback;
  const resolvedExtractionModelSelection = resolveRunnableVisionSelection(providerConfigs, extractionModelSelection);
  const selectedConfig = findRunnableImageModelConfig(providerConfigs, resolvedImageModelSelection);
  const extractionSelectedConfig = findRunnableVisionModelConfig(providerConfigs, resolvedExtractionModelSelection);
  const extractionUnavailableReason = !extractionSelectedConfig
    ? text("没有可用的 GLM 提取模型。请在“模型设置”中配置中国大陆或国际 GLM。", "No GLM extraction model is available. Configure a mainland or international GLM route in Model Settings.")
    : extractionSelectedConfig.routing_mode === "relay_base_url" && !extractionSelectedConfig.base_url?.trim()
      ? text("当前提取中转缺少 Base URL。请先在“模型设置”里保存 HTTPS 中转地址。", "The extraction relay has no Base URL. Save an HTTPS relay address in Model Settings.")
      : undefined;
  const currentAssetIds = new Set(uploadedAssets.map((asset) => asset.id));
  const currentExtractedItems = extractedItems.filter((item) => item.asset_id != null && currentAssetIds.has(item.asset_id));
  const keptItems = keptReviewedItems(currentExtractedItems);
  const budgetTotals = itemBudgetTotals(currentExtractedItems);
  const hasBudget = keptItems.some((item) => item.price_min != null || item.price_max != null);
  const activeRoomIds = uploadedAssets.map((_, index) => selectedRoomIds[index] ?? (index === 0 ? "living-room" : "dining-room"));
  const roomLabels = activeRoomIds.map(roomLabelFromId);
  const itemBrief = keptItems.length > 0
    ? keptItems.map((item) => {
      const budget = item.price_min != null || item.price_max != null
        ? `，预算 ${item.price_min ?? "未填"}-${item.price_max ?? "未填"}`
        : "";
      return `${item.room_type ?? "房间"}：${item.name}${item.material ? `，${item.material}` : ""}${item.color ? `，${item.color}` : ""}${budget}`;
    }).join("; ")
    : text("未指定强制保留元素，请以当前上传的全部房间图片和设计提示为依据。", "No mandatory retained items were specified; use all current room images and the design prompt as the source.");
  const selectedItemKey = keptItems.map((item) => item.id).sort((a, b) => a - b).join(",");
  const reviewSnapshot = itemReviewSnapshot(currentExtractedItems);
  const hasCurrentReport = boardDocuments.some((document) =>
    ["integrated_board", "split_room_board", "budget_summary"].includes(document.board_type)
      && hasSameAssetIds(document.data_json?.source_asset_ids, uploadedAssets.map((asset) => asset.id)),
  );

  useEffect(() => {
    void loadPersistedProjectBoardData(activeProjectId);
    if (activeProjectId) {
      void loadAssets(activeProjectId);
    }
  }, [activeProjectId, loadAssets, loadPersistedProjectBoardData]);

  useEffect(() => {
    if (!activeProjectId) return;
    const shouldHydrateHistory = uploadedAssets.length === 0 && multiRoomFiles.length === 0;
    const currentInputs = uploadedAssets.length > 0
      ? uploadedAssets
      : shouldHydrateHistory
        ? latestInputsForSource(assets, "multi_room_board", activeProjectId).slice(0, 6)
        : [];
    if (shouldHydrateHistory) setUploadedAssets(currentInputs);
    if (!resultAsset) {
      const historicalResult = latestOutputForModule(assets, "multi_room_board", activeProjectId, currentInputs.map((asset) => asset.id));
      setResultAsset(outputMatchesBoardReview(historicalResult, currentInputs.map((asset) => asset.id), keptItems.map((item) => item.id), reviewSnapshot) ? historicalResult : undefined);
    }
  }, [activeProjectId, assets, multiRoomFiles.length, resultAsset, reviewSnapshot, selectedItemKey, uploadedAssets.length]);

  useEffect(() => {
    if (resultAsset && !outputMatchesBoardReview(resultAsset, uploadedAssets.map((asset) => asset.id), keptItems.map((item) => item.id), reviewSnapshot)) {
      setResultAsset(undefined);
    }
  }, [resultAsset, reviewSnapshot, selectedItemKey, uploadedAssets]);

  const generateReport = async () => {
    if (isGeneratingReport) return;
    if (!activeProjectId || uploadedAssets.length < 2) {
      setGenerationError(text("生成多房间报告前请先创建或选择项目并上传至少两张房间图。", "Create or select a project and upload at least two room images before generating a multi-room report."));
      return;
    }
    setGenerationError(undefined);
    setGenerationNotice(undefined);
    setIsGeneratingReport(true);
    try {
      await generateMultiRoomBoards({
        projectId: activeProjectId,
        assetIds: uploadedAssets.map((asset) => asset.id),
        selectedItemIds: keptItems.map((item) => item.id),
        roomTags: roomTagsForAssets(uploadedAssets, activeRoomIds),
        styleConsistency: 0.82,
        integratedBoardTitle: text("整屋综合方案板", "Whole-home Design Board"),
        paramsSnapshot: {
          material_palette: materialPalette,
          budget_allocation: budgetAllocation,
          budget_min: budgetTotals.min,
          budget_max: budgetTotals.max,
          source_asset_ids: uploadedAssets.map((asset) => asset.id),
          selected_item_ids: keptItems.map((item) => item.id),
          review_schema_version: 2,
          delivery_prompt_version: "qigou-board-delivery-v2",
          review_snapshot: reviewSnapshot,
        },
        skipUpload: true,
        outputLanguage: locale,
      });
      setGenerationNotice(text("多房间报告内容已生成，可在下方预览或导出；没有调用图片模型。", "Multi-room report content was generated without calling an image model and can now be previewed or exported."));
    } catch (error) {
      setGenerationError(error instanceof Error ? text(`报告生成失败：${error.message}`, `Report generation failed: ${error.message}`) : text("报告生成失败。", "Report generation failed."));
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const queueMultiRoomImage = async () => {
    if (isGenerating) return;
    if (!activeProjectId) {
      setGenerationError(text("生成前请先创建或选择项目。", "Create or select a project before generating."));
      return;
    }
    if (uploadedAssets.length < 2) {
      setGenerationError(text("多房间方案板至少需要两张不同房间图片。", "A multi-room board requires at least two different room images."));
      return;
    }
    if (!selectedConfig) {
      setGenerationError(text("当前没有可运行的多房间方案板图片模型，请先保存并应用图片模型线路。", "No runnable image route is available for multi-room boards. Save and apply an image model route first."));
      return;
    }
    setGenerationError(undefined);
    setGenerationNotice(undefined);
    setResultAsset(undefined);
    setIsGenerating(true);
    try {
      const task = await queueProviderImageTask({
      project_id: activeProjectId,
      module: "multi_room_board",
      task_type: "provider_multi_room_board",
      capability: "image_to_image",
      provider: resolvedImageModelSelection.provider,
      model_name: resolvedImageModelSelection.model,
      provider_config_id: selectedConfig.id,
      payload_summary: `${uploadedAssets.length} 个房间 · ${keptItems.length} 个已确认元素 · ${aspectRatio}`,
      payload_json: {
        asset_ids: uploadedAssets.map((asset) => asset.id),
        rooms: roomLabels,
        style_prompt: stylePrompt,
        prompt: buildMultiRoomPrompt({
          stylePrompt,
          aspectRatio,
          materialPalette,
          budgetAllocation,
          budgetMin: budgetTotals.min,
          budgetMax: budgetTotals.max,
          hasBudget,
          itemBrief, locale,
        }),
        material_palette: materialPalette,
        budget_allocation: budgetAllocation,
        budget_range: hasBudget ? { min: budgetTotals.min, max: budgetTotals.max, currency: "人民币" } : undefined,
        extracted_items: keptItems.map((item) => ({
          name: item.name,
          category: item.category,
          room_type: item.room_type,
          material: item.material,
          color: item.color,
          price_min: item.price_min,
          price_max: item.price_max,
        })),
        selected_item_ids: keptItems.map((item) => item.id),
        review_schema_version: 2,
        delivery_prompt_version: "qigou-board-delivery-v2",
        review_snapshot: reviewSnapshot,
        require_source_images: true,
        output_count: 1,
        aspect_ratio: aspectRatio,
      },
        prompt_snapshot: { resolved_prompt: buildMultiRoomPrompt({
          stylePrompt,
          aspectRatio,
          materialPalette,
          budgetAllocation,
          budgetMin: budgetTotals.min,
          budgetMax: budgetTotals.max,
          hasBudget,
          itemBrief, locale,
        }), negative_prompt: text("风格漂移、配色偏移、替换为默认米色风格、改变原图重点色家具、虚构无关房间、忽略源图片、已删除元素、其他历史图片中的家具", "style drift, color shift, default beige replacement, changed accent furniture, invented rooms, ignored source images, removed items, furniture from historical images") },
        params_snapshot: { budget_allocation: budgetAllocation, budget_min: budgetTotals.min, budget_max: budgetTotals.max, selected_item_ids: keptItems.map((item) => item.id), delivery_prompt_version: "qigou-board-delivery-v2", review_snapshot: reviewSnapshot, output_count: 1, aspect_ratio: aspectRatio },
      });
      setResultAsset(firstResultAsset(task.output_payload_json));
      setGenerationNotice(text("多房间方案板图片已由当前图片模型生成并归档；报告内容可单独生成或导出。", "The multi-room board image was generated and archived. Report content can still be generated or exported independently."));
      void loadAssets(activeProjectId);
    } catch (error) {
      setGenerationError(error instanceof Error ? text(`多房间方案板图片生成失败：${error.message}`, `Multi-room board image generation failed: ${error.message}`) : text("多房间方案板图片生成失败。", "Multi-room board image generation failed."));
    } finally {
      setIsGenerating(false);
    }
  };

  const extractMultiRoomItems = async () => {
    if (uploadedAssets.length === 0 || isLoadingExtractedItems || !activeProjectId) return;
    if (extractionUnavailableReason) {
      setGenerationError(extractionUnavailableReason);
      return;
    }
    const confirmed = window.confirm(locale === "zh-CN" ? [
      "即将使用 GLM 提取多房间信息。", `素材数量：${uploadedAssets.length}`,
      `目标 Provider：${resolvedExtractionModelSelection.provider}`, `目标模型：${resolvedExtractionModelSelection.model}`,
      "全部所选项目图片和提取提示词会发送给服务商，结构化结果会保存到项目归档。", "请确认你有权上传这些客户图片和项目素材。",
    ].join("\n") : [
      "GLM will extract information from multiple rooms.", `Assets: ${uploadedAssets.length}`,
      `Provider: ${resolvedExtractionModelSelection.provider}`, `Model: ${resolvedExtractionModelSelection.model}`,
      "All selected project images and the extraction prompt will be sent to the Provider. Structured results will be saved in the project archive.",
      "Confirm that you have permission to upload these client images and project assets.",
    ].join("\n"));
    if (!confirmed) {
      setGenerationError(text("已取消：未确认 GLM 提取数据流。", "Cancelled: GLM extraction data transfer was not confirmed."));
      return;
    }
    setGenerationError(undefined);
    try {
      for (let index = 0; index < uploadedAssets.length; index += 1) {
        const asset = uploadedAssets[index];
        await extractItemsFromAsset({
          projectId: activeProjectId,
          assetId: asset.id,
          roomType: roomLabels[index] ?? `房间 ${index + 1}`,
          style: stylePrompt,
          providerName: resolvedExtractionModelSelection.provider,
          modelName: resolvedExtractionModelSelection.model,
          providerConfigId: extractionSelectedConfig?.id ?? null,
          workflowSlot: "multi_room_board.extraction",
          outputLanguage: locale,
          dataFlowConfirmed: true,
        });
      }
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : text("多房间元素提取失败。", "Multi-room item extraction failed."));
    }
  };

  return (
    <div className="page-stack min-w-0 overflow-x-hidden">
      <section className="page-hero">
        <div className="eyebrow">{text("多房间方案板", "Multi-Room Board")}</div>
        <h2 className="hero-title">{text("上传多张房间图，生成全案方案板。", "Upload multiple room images and create a whole-project board.")}</h2>
        <p className="body-muted mt-2 max-w-3xl">{text("用于生成整案方案板、分房间方案板和预算摘要。", "Create an integrated board, room-specific boards, and a budget summary.")}</p>
      </section>
      <ProjectContextBar label={text("多房间方案板项目", "Multi-room board project")} />

      {isLoadingMultiRoom || isGenerating ? <LoadingOverlay label={text("正在生成 1 张多房间方案板...", "Generating one multi-room board...")} /> : null}
      {error ? <div className="soft-alert">{message(error)}</div> : null}

      <section className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1.15fr)_420px]">
        <div className="min-w-0 space-y-5">
          <AssetUploader
            title={text("1. 上传多张房间图", "1. Upload multiple room images")}
            description={text("上传客厅、餐厅、卧室等房间图，用于生成统一的全案方案。", "Upload living room, dining room, bedroom, and other room images for a unified whole-project design.")}
            multiple
            selectedFiles={multiRoomFiles}
            existingAssets={uploadedAssets}
            onFilesSelected={(files) => {
              clearError();
              setMultiRoomFiles(files);
              setUploadedAssets([]);
              setResultAsset(undefined);
              setGenerationError(undefined);
              setGenerationNotice(undefined);
            }}
            uploadOptions={activeProjectId ? { projectId: activeProjectId, assetType: "render_input", source: "multi_room_board" } : undefined}
            onAssetsUploaded={(nextAssets) => {
              setUploadedAssets(nextAssets);
              setResultAsset(undefined);
              setGenerationError(undefined);
              setGenerationNotice(undefined);
            }}
            onAssetRemoved={(asset) => {
              setUploadedAssets((current) => current.filter((item) => item.id !== asset.id));
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
            <GeneratedResultPanel asset={resultAsset} title={text("已生成多房间方案板", "Generated multi-room board")} aspectRatio={aspectRatio} />
          ) : null}

          {hasCurrentReport ? (
            <BoardPreview
              mode="multi"
              heroAsset={resultAsset ?? uploadedAssets[0]}
              currentSourceAssets={uploadedAssets}
              selectedItemIds={keptItems.map((item) => item.id)}
              reviewSnapshot={reviewSnapshot}
            />
          ) : null}

          <RoomTagger assets={uploadedAssets} />
          <div className="panel-surface min-w-0 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="eyebrow">{text("元素与预算", "Items and budget")}</div>
                <h3 className="section-title mt-2">{text("提取室内元素", "Extract interior items")}</h3>
                <p className="body-muted mt-1">{text("从所有上传房间图里提取可见家具和材质，然后调整每个元素的预算范围。", "Extract visible furniture and materials from all uploaded rooms, then optionally adjust each item's budget range.")}</p>
              </div>
              <button
                type="button"
                disabled={uploadedAssets.length === 0 || isLoadingExtractedItems || !activeProjectId || Boolean(extractionUnavailableReason)}
                onClick={() => void extractMultiRoomItems()}
                className="btn-secondary"
              >
                {isLoadingExtractedItems ? text("提取中...", "Extracting...") : text("提取元素", "Extract items")}
              </button>
            </div>
            <div className="mt-3 rounded-lg border border-studio-border bg-studio-panelBg p-3 text-xs font-medium text-studio-mutedText">
              {text("当前提取模型", "Current extraction model")}: <span className="font-semibold text-studio-navy">{resolvedExtractionModelSelection.provider} / {resolvedExtractionModelSelection.model || text("未选择", "Not selected")}</span>
              {extractionSelectedConfig ? <span> · {text("配置", "Config")} #{extractionSelectedConfig.id}</span> : null}
              {extractionUnavailableReason ? <div className="mt-2 font-semibold text-amber-800">{extractionUnavailableReason}</div> : null}
            </div>

            <div className="mt-4 grid gap-3 xl:grid-cols-2">
              <ExtractedItemReview
                items={currentExtractedItems}
                savingItemIds={savingSelectionItemIds}
                emptyMessage={text("上传房间图后，可提取当前图片中的真实元素。旧图片的提取结果不会显示在这里。", "After uploading room images, you can extract real items from the current images. Results from old images are not shown here.")}
                onSave={(item, state, details) => saveExtractedItemSelection(item.id, state, item.replacement_notes, details)}
              />
            </div>
          </div>
          <ExportDialog
            reportFileName="multi-room-board-report.svg"
            mode="multi"
            sourceAssetIds={uploadedAssets.map((asset) => asset.id)}
            selectedItemIds={keptItems.map((item) => item.id)}
            reviewSnapshot={reviewSnapshot}
            generatedAssetId={resultAsset?.id}
          />
        </div>

        <aside className="panel-surface h-fit min-w-0 p-5">
          <div className="eyebrow">{text("2. 方案板设置", "2. Board settings")}</div>
          <h3 className="section-title mt-2">{text("全案方向", "Whole-project direction")}</h3>

          <div className="mt-4 space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("风格提示词", "Style prompt")}</span>
              <textarea value={stylePrompt} onChange={(event) => setStylePrompt(event.target.value)} className="textarea-field h-36 w-full" />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("材质与配色", "Materials and colors")}</span>
              <input value={materialPalette} onChange={(event) => setMaterialPalette(event.target.value)} className="form-field w-full" />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("预算分配", "Budget allocation")}</span>
              <input value={budgetAllocation} onChange={(event) => setBudgetAllocation(event.target.value)} className="form-field w-full" />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("画面比例", "Aspect ratio")}</span>
              <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)} className="form-field w-full">
                {aspectRatioOptions.map((ratio) => <option key={ratio}>{ratio}</option>)}
              </select>
            </label>
            <div className="rounded-lg border border-studio-border bg-studio-panelBg p-3 text-sm font-semibold text-studio-navy">
              {text(`当前房间：${uploadedAssets.length} 个 · 已保留元素：${keptItems.length} 个 · 预算合计：${hasBudget ? `人民币 ${budgetTotals.min.toLocaleString()} - ${budgetTotals.max.toLocaleString()}` : "未填写（可选）"}`, `Current rooms: ${uploadedAssets.length} · Retained items: ${keptItems.length} · Budget total: ${hasBudget ? `CNY ${budgetTotals.min.toLocaleString()} - ${budgetTotals.max.toLocaleString()}` : "Not provided (optional)"}`)}
            </div>
            <WorkflowModelStatusCard
              slotKey="multi_room_board.image"
              fallback={imageModelFallback}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => void generateReport()} disabled={uploadedAssets.length < 2 || isGeneratingReport || !activeProjectId} className="btn-secondary w-full">
                {isGeneratingReport ? text("正在生成报告...", "Generating report...") : text("生成报告内容", "Generate report content")}
              </button>
              <button type="button" onClick={() => void queueMultiRoomImage()} disabled={uploadedAssets.length < 2 || isGenerating || !activeProjectId} className="btn-primary w-full">
                {isGenerating ? text("正在生成图片...", "Generating image...") : text("生成多房间图片", "Generate multi-room image")}
              </button>
            </div>
            {currentExtractedItems.length === 0 ? <div className="panel-muted p-3 text-sm text-studio-mutedText">{text("GLM 提取是可选步骤；可直接使用当前图片生成方案板。", "GLM extraction is optional; you can generate a board directly from the current images.")}</div> : null}
          </div>
        </aside>
      </section>

      <WorkflowModelOverride
        slotKey="multi_room_board.image"
        title={text("多房间方案板模型", "Multi-room board model")}
        description={text("仅用于当前整案方案板工作流。", "Used only for the current whole-project board workflow.")}
        capability="image"
        fallback={imageModelFallback}
      />
      <WorkflowModelOverride
        slotKey="multi_room_board.extraction"
        title={text("多房间提取模型", "Multi-room extraction model")}
        description={text("仅用于本页面的“提取元素”，使用独立的 GLM 提取配置（中国大陆或国际），不受图片生成模型切换影响。", "Used only for item extraction on this page. It uses an independent mainland or international GLM configuration and is not affected by image model changes.")}
        capability="vision"
        fallback={extractionModelFallback}
      />
    </div>
  );
}

function roomLabelFromId(roomId: string): string {
  const labels: Record<string, string> = {
    "living-room": "客厅",
    "dining-room": "餐厅",
    bedroom: "卧室",
    kitchen: "厨房",
    bathroom: "卫生间",
    "home-office": "书房",
    entryway: "玄关",
    lobby: "大堂",
    lounge: "休闲区",
    "meeting-room": "会议室",
  };
  return labels[roomId] ?? zhLabel(roomId);
}

function roomTagsForAssets(assets: AssetRecord[], roomIds: string[]): Record<string, string> {
  return Object.fromEntries(
    assets.map((asset, index) => [
      String(asset.id),
      roomLabelFromId(roomIds[index] ?? (index === 0 ? "living-room" : "dining-room")),
    ]),
  );
}

function hasSameAssetIds(value: unknown, expected: number[]): boolean {
  if (!Array.isArray(value) || expected.length === 0) return false;
  const actual = [...new Set(value.map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  const normalizedExpected = [...new Set(expected)].sort((a, b) => a - b);
  return actual.length === normalizedExpected.length && actual.every((item, index) => item === normalizedExpected[index]);
}

function buildMultiRoomPrompt({
  stylePrompt,
  aspectRatio,
  materialPalette,
  budgetAllocation,
  budgetMin,
  budgetMax,
  hasBudget,
  itemBrief,
  locale,
}: {
  stylePrompt: string;
  aspectRatio: string;
  materialPalette: string;
  budgetAllocation: string;
  budgetMin: number;
  budgetMax: number;
  hasBudget: boolean;
  itemBrief: string;
  locale: "zh-CN" | "en";
}): string {
  return locale === "zh-CN" ? [
    "生成一张可直接嵌入客户正式交付报告的整屋方案板主视觉。",
    `画布比例 ${aspectRatio}，严格使用全部当前上传房间图，并且只表现这些图片对应的房间。`,
    "采用专业室内设计全案提案版式：统一主视觉占主要画面，每个房间使用清晰但不过度细分的方向区，材质板、色彩板、家具与灯光以及报价摘要按固定网格排列；留白充足、网格对齐、视觉层级明确，不得拥挤、重叠或裁切。",
    "方案板必须包含清晰可读的简短中文标题“整案主视觉”“房间方向”“材质板”“色彩板”“家具与灯光”“报价摘要”，不得完全省略文字；标题下只允许短标签或一句短说明，不得生成段落。",
    "每个房间最多展示 2 个代表性视觉重点；整张方案板最多展示 4 个材质样本、6 个色块和 6 个代表性家具或灯光样本。人工确认元素用于约束主视觉和选择代表性样本，不要把每个元素都做成独立缩略图。",
    "必须保留各原图的建筑结构、配色、重点色、墙地面色调、家具轮廓、灯光色温和材质对比，不得把不同房间错误合并。",
    `设计方向：${stylePrompt}`,
    `材质与配色方向：${materialPalette}。`,
    `人工确认元素：${itemBrief}。`,
    hasBudget
      ? `预算由报告程序准确排版为人民币 ${budgetMin.toLocaleString()} - ${budgetMax.toLocaleString()}，分配依据为“${budgetAllocation}”；不要在图片里生成价格。`
      : "预算未填写，不要在图片里生成价格、购买链接或采购信息。",
    "不要生成大段文字、文字重叠、文字裁切、乱码、虚构品牌、虚构产品、额外家具、额外卧室、户型图、其他历史项目或已删除元素。",
  ].join(" ") : [
    "Create a whole-project board visual suitable for direct placement in a formal client delivery report.",
    `Canvas ratio: ${aspectRatio}. Use every currently uploaded room image and show only the rooms represented by those images.`,
    "Use a professional whole-project proposal layout with one dominant unified hero, clearly separated but not over-fragmented room-direction sections, and a fixed grid for Material Palette, Color Palette, Furniture & Lighting, and Quotation Summary. Keep generous whitespace, grid alignment, and clear hierarchy, with no crowding, overlap, or clipping.",
    "The board must include these concise, readable English headings: Whole-project Visual, Room Directions, Material Palette, Color Palette, Furniture & Lighting, and Quotation Summary. Do not omit typography entirely. Use only short labels or one short sentence below a heading, never paragraphs.",
    "Show no more than 2 representative visual priorities per room, 4 material samples, 6 color chips, and 6 representative furniture or lighting samples across the full board. Use human-confirmed items to constrain the hero and choose representative samples; do not turn every item into a separate thumbnail.",
    "Preserve each source image's architecture, palette, accent colors, wall and floor tones, furniture silhouettes, lighting temperature, and material contrast. Do not merge different rooms incorrectly.",
    `Design direction: ${stylePrompt}.`, `Material and color direction: ${materialPalette}.`, `Human-confirmed items: ${itemBrief}.`,
    hasBudget ? `The report renderer will typeset the CNY ${budgetMin.toLocaleString()} - ${budgetMax.toLocaleString()} budget using this allocation: ${budgetAllocation}. Do not generate prices inside the image.` : "No budget was provided. Do not generate prices, purchase links, or procurement information in the image.",
    "Do not generate long text, overlapping text, clipped text, garbled text, invented brands or products, extra furniture or bedrooms, floor plans, historical project content, or removed items.",
  ].join(" ");
}
