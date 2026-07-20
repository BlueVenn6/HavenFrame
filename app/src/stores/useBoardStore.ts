import { create } from "zustand";

import { apiRequest, exportReportImage, exportStructuredTable } from "../api/client";
import { useAssetStore } from "./useAssetStore";
import { useProjectStore } from "./useProjectStore";
import { useReviewStore } from "./useReviewStore";
import { useTaskStore } from "./useTaskStore";
import type {
  AssetRecord,
  BoardDocumentRecord,
  ExportRecord,
  ExtractedItemRecord,
  QuoteCard,
} from "../types";

type BoardMode = "single" | "multi";
type SelectionState = "keep" | "remove" | "replace" | "undecided";

interface ExtractedItemReviewUpdate {
  priceMin: number | null;
  priceMax: number | null;
  procurementStatus: "pending" | "purchased";
  quantity: number | null;
  purchaseMethod: string;
  purchaseUrl: string;
}

const activeExtractionKeys = new Set<string>();

interface BoardStore {
  uploadedAssets: AssetRecord[];
  sourceAssets: AssetRecord[];
  previewAssets: AssetRecord[];
  extractedItems: ExtractedItemRecord[];
  boardDocuments: BoardDocumentRecord[];
  quoteCard?: QuoteCard;
  exports: ExportRecord[];
  selectedRoomIds: string[];
  singleRoomFiles: File[];
  multiRoomFiles: File[];
  currentSingleRoomAssetId?: number;
  isLoadingSingleRoom: boolean;
  isLoadingMultiRoom: boolean;
  isLoadingExtractedItems: boolean;
  savingSelectionItemIds: number[];
  isExportingReport: boolean;
  extractionSource?: string;
  error?: string;
  lastBackendMode?: "live" | "error";
  setSingleRoomFiles: (files: File[]) => void;
  setMultiRoomFiles: (files: File[]) => void;
  setSelectedRoomIds: (roomIds: string[]) => void;
  setCurrentSingleRoomAssetId: (assetId?: number) => void;
  clearError: () => void;
  loadPersistedProjectBoardData: (projectId?: number) => Promise<void>;
  loadExtractedItems: (options?: { projectId?: number; assetId?: number }) => Promise<void>;
  extractItemsFromAsset: (options: {
    projectId?: number;
    assetId: number;
    roomType?: string;
    style?: string;
    providerName?: string;
    modelName?: string;
    providerConfigId?: number | null;
    workflowSlot?: "room_board.extraction" | "multi_room_board.extraction" | "space_render.extraction";
    outputLanguage?: "zh-CN" | "en";
    dataFlowConfirmed?: boolean;
  }) => Promise<ExtractedItemRecord[]>;
  saveExtractedItemSelection: (
    itemId: number,
    selectionState: SelectionState,
    replacementNotes: string | undefined,
    details: ExtractedItemReviewUpdate,
  ) => Promise<void>;
  generateSingleRoomBoards: (options?: SingleRoomBoardGenerationOptions) => Promise<void>;
  generateMultiRoomBoards: (options?: MultiRoomBoardGenerationOptions) => Promise<void>;
  generateQuoteCard: () => Promise<void>;
  exportBoardReport: (fileName: string, context: BoardExportContext) => Promise<void>;
  exportBoardTable: (fileName: string, context: BoardExportContext) => Promise<void>;
  toggleSelectedRoom: (roomId: string) => void;
}

interface BoardExportContext {
  mode: BoardMode;
  sourceAssetIds: number[];
  selectedItemIds: number[];
  reviewSnapshot: string;
  generatedAssetId?: number;
  outputLanguage?: "zh-CN" | "en";
}

interface SingleRoomBoardGenerationOptions {
  projectId?: number;
  assetId?: number;
  roomType?: string;
  style?: string;
  selectedItemIds?: number[];
  keepItems?: string[];
  replaceItems?: string[];
  budgetLabel?: string;
  providerName?: string;
  modelName?: string;
  providerConfigId?: number | null;
  paramsSnapshot?: Record<string, unknown>;
  skipUpload?: boolean;
  outputLanguage?: "zh-CN" | "en";
}

interface MultiRoomBoardGenerationOptions {
  projectId?: number;
  assetIds?: number[];
  selectedItemIds?: number[];
  roomTags?: Record<string, string>;
  styleConsistency?: number;
  integratedBoardTitle?: string;
  providerName?: string;
  modelName?: string;
  providerConfigId?: number | null;
  paramsSnapshot?: Record<string, unknown>;
  skipUpload?: boolean;
  outputLanguage?: "zh-CN" | "en";
}

export const useBoardStore = create<BoardStore>((set, get) => ({
  uploadedAssets: [],
  sourceAssets: [],
  previewAssets: [],
  extractedItems: [],
  boardDocuments: [],
  quoteCard: undefined,
  exports: [],
  selectedRoomIds: ["living-room", "dining-room"],
  singleRoomFiles: [],
  multiRoomFiles: [],
  currentSingleRoomAssetId: undefined,
  isLoadingSingleRoom: false,
  isLoadingMultiRoom: false,
  isLoadingExtractedItems: false,
  savingSelectionItemIds: [],
  isExportingReport: false,
  extractionSource: undefined,
  error: undefined,
  lastBackendMode: undefined,
  setSingleRoomFiles: (files) => set({ singleRoomFiles: files }),
  setMultiRoomFiles: (files) => set({ multiRoomFiles: files }),
  setSelectedRoomIds: (roomIds) => set({ selectedRoomIds: roomIds }),
  setCurrentSingleRoomAssetId: (assetId) =>
    set({
      currentSingleRoomAssetId: assetId,
      extractedItems: [],
      quoteCard: undefined,
      extractionSource: undefined,
      error: undefined,
    }),
  clearError: () => set({ error: undefined }),
  loadPersistedProjectBoardData: async (projectId) => {
    const targetProjectId = projectId ?? getActiveProjectId();

    try {
      const [assets, boardDocuments, exports, extractedItems] = await Promise.all([
        apiRequest<AssetRecord[]>(`/api/assets?project_id=${targetProjectId}`),
        apiRequest<BoardDocumentRecord[]>(
          `/api/workflows/softboard/documents?project_id=${targetProjectId}`,
        ),
        apiRequest<ExportRecord[]>(`/api/exports?project_id=${targetProjectId}`),
        apiRequest<ExtractedItemRecord[]>(
          `/api/workflows/softboard/extracted-items?project_id=${targetProjectId}`,
        ),
      ]);

      const sourceAssets = filterSourceAssets(assets);
      const previewAssets = filterPreviewAssets(assets);
      const currentSingleRoomAssetId =
        get().currentSingleRoomAssetId ?? getLatestSingleRoomAssetId(sourceAssets);
      const quoteCard = deriveQuoteCard(boardDocuments, extractedItems) ?? get().quoteCard;

      set({
        uploadedAssets: sourceAssets,
        sourceAssets,
        previewAssets,
        extractedItems,
        boardDocuments,
        exports,
        currentSingleRoomAssetId,
        quoteCard,
        extractionSource: resolveExtractionSource(extractedItems),
        error: undefined,
      });
    } catch (error) {
      set((state) => ({
        error: error instanceof Error ? error.message : "方案板归档数据加载失败。",
        uploadedAssets: state.uploadedAssets.length > 0 ? state.uploadedAssets : [],
        lastBackendMode: "error",
      }));
    }
  },
  loadExtractedItems: async (options) => {
    const projectId = options?.projectId ?? getActiveProjectId();
    const assetId = options?.assetId ?? get().currentSingleRoomAssetId;
    set({ isLoadingExtractedItems: true, error: undefined });

    try {
      const query = new URLSearchParams();
      query.set("project_id", String(projectId));
      if (assetId) {
        query.set("asset_id", String(assetId));
      }

      const items = await apiRequest<ExtractedItemRecord[]>(
        `/api/workflows/softboard/extracted-items?${query.toString()}`,
      );
      const scopedItems = filterExtractedItemsByAsset(items, assetId);
      set({
        extractedItems: scopedItems,
        currentSingleRoomAssetId: assetId ?? get().currentSingleRoomAssetId,
        quoteCard: deriveQuoteCard(get().boardDocuments, scopedItems) ?? get().quoteCard,
        isLoadingExtractedItems: false,
        extractionSource: resolveExtractionSource(scopedItems),
        lastBackendMode: "live",
      });
    } catch (error) {
      set({
        isLoadingExtractedItems: false,
        error: error instanceof Error ? error.message : "已保存的元素记录无法重新加载。",
        lastBackendMode: "error",
      });
    }
  },
  extractItemsFromAsset: async (options) => {
    const projectId = options.projectId ?? getActiveProjectId();
    if (options.dataFlowConfirmed !== true) {
      throw new Error("GLM extraction requires explicit data-flow confirmation from the calling page.");
    }
    const extractionKey = [
      projectId,
      options.assetId,
      options.providerName ?? "",
      options.modelName ?? "",
      options.providerConfigId ?? "",
    ].join(":");
    if (activeExtractionKeys.has(extractionKey)) {
      return get().extractedItems.filter((item) => item.asset_id === options.assetId);
    }
    activeExtractionKeys.add(extractionKey);
    set((state) => ({
      isLoadingExtractedItems: true,
      error: undefined,
      ...(options.workflowSlot === "room_board.extraction" ? { currentSingleRoomAssetId: options.assetId } : {}),
      extractedItems: options.workflowSlot === "room_board.extraction" ? [] : state.extractedItems,
      quoteCard: undefined,
    }));
    try {
      const response = await apiRequest<{ items: ExtractedItemRecord[] }>(
        "/api/workflows/softboard/extract-items",
        {
          method: "POST",
          timeoutMs: 240000,
          body: JSON.stringify({
            project_id: projectId,
            asset_id: options.assetId,
            room_type: options.roomType ?? "客厅",
            style: options.style ?? "柔和极简",
            provider_name: options.providerName,
            model_name: options.modelName,
            provider_config_id: options.providerConfigId ?? undefined,
            workflow_slot: options.workflowSlot,
            output_language: options.outputLanguage ?? "zh-CN",
            data_flow_confirmed: options.dataFlowConfirmed,
          }),
        },
      );
      const items = response.items ?? [];
      await Promise.all([
        useTaskStore.getState().loadTasks(projectId),
        useReviewStore.getState().fetchSnapshot(projectId),
      ]);
      set((state) => ({
        extractedItems: [
          ...state.extractedItems.filter((item) => item.asset_id !== options.assetId),
          ...items,
        ],
        quoteCard: deriveQuoteCard(get().boardDocuments, items),
        extractionSource: resolveExtractionSource(items),
        isLoadingExtractedItems: activeExtractionKeys.size > 1,
        lastBackendMode: "live",
      }));
      activeExtractionKeys.delete(extractionKey);
      if (activeExtractionKeys.size === 0) set({ isLoadingExtractedItems: false });
      return items;
    } catch (error) {
      const message = error instanceof Error ? error.message : "元素提取失败。";
      set({
        isLoadingExtractedItems: activeExtractionKeys.size > 1,
        extractionSource: undefined,
        error: `元素提取失败：${message}`,
        lastBackendMode: "error",
      });
      activeExtractionKeys.delete(extractionKey);
      if (activeExtractionKeys.size === 0) set({ isLoadingExtractedItems: false });
      throw error;
    }
  },
  saveExtractedItemSelection: async (itemId, selectionState, replacementNotes, details) => {
    const previousItem = get().extractedItems.find((item) => item.id === itemId);
    if (!previousItem) {
      throw new Error("当前提取元素不存在，请刷新后重试。");
    }
    set((state) => ({
      extractedItems: state.extractedItems.map((item) =>
        item.id === itemId
          ? {
              ...item,
              selection_state: selectionState,
              selection_updated_at: new Date().toISOString(),
              review_schema_version: 2,
              replacement_notes: replacementNotes ?? item.replacement_notes,
              price_min: details.priceMin ?? undefined,
              price_max: details.priceMax ?? undefined,
              procurement_status: details.procurementStatus,
              quantity: details.quantity ?? undefined,
              purchase_method: details.purchaseMethod,
              purchase_url: details.purchaseUrl,
            }
          : item,
      ),
      savingSelectionItemIds: state.savingSelectionItemIds.includes(itemId)
        ? state.savingSelectionItemIds
        : [...state.savingSelectionItemIds, itemId],
      error: undefined,
    }));

    try {
      const updated = await apiRequest<ExtractedItemRecord>(
        `/api/workflows/softboard/extracted-items/${itemId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            selection_state: selectionState,
            replacement_notes: replacementNotes,
            price_min: details.priceMin,
            price_max: details.priceMax,
            procurement_status: details.procurementStatus,
            quantity: details.quantity,
            purchase_method: details.purchaseMethod,
            purchase_url: details.purchaseUrl,
          }),
        },
      );

      const projectId = getActiveProjectId();

      await useReviewStore.getState().fetchSnapshot(projectId);

      set((state) => {
        const syncedItems = state.extractedItems.map((item) => (item.id === itemId ? updated : item));
        return {
          extractedItems: syncedItems,
          quoteCard: deriveQuoteCard(state.boardDocuments, syncedItems) ?? state.quoteCard,
          extractionSource: resolveExtractionSource(syncedItems),
          savingSelectionItemIds: state.savingSelectionItemIds.filter((id) => id !== itemId),
          lastBackendMode: "live" as const,
        };
      });
    } catch (error) {
      set((state) => {
        const restoredItems = state.extractedItems.map((item) => (item.id === itemId ? previousItem : item));
        return {
          extractedItems: restoredItems,
          quoteCard: deriveQuoteCard(state.boardDocuments, restoredItems) ?? state.quoteCard,
          savingSelectionItemIds: state.savingSelectionItemIds.filter((id) => id !== itemId),
          error: error instanceof Error ? error.message : "选择状态未能保存到本地归档，界面已恢复为保存前状态。",
          lastBackendMode: "error" as const,
        };
      });
      throw error;
    }
  },
  generateSingleRoomBoards: async (options) => {
    set({ isLoadingSingleRoom: true, error: undefined });
    const projectId = options?.projectId ?? getActiveProjectId();

    try {
      const uploadedAssets =
        options?.skipUpload
          ? []
          : await useAssetStore.getState().uploadAssets(get().singleRoomFiles, {
              projectId,
              assetType: "render_input",
              roomType: options?.roomType ?? "客厅",
              source: "single_room_board",
            });

      const primaryAsset =
        (options?.assetId ? ({ id: options.assetId } as AssetRecord) : undefined) ??
        uploadedAssets[0] ??
        useAssetStore
          .getState()
          .assets.filter((asset) => asset.project_id === projectId && asset.type === "render_input")
          .sort(sortByCreatedAt)[0];

      const currentSingleRoomAssetId =
        primaryAsset?.id && primaryAsset.id > 0 ? primaryAsset.id : get().currentSingleRoomAssetId;

      const extractResponse =
        !options?.skipUpload && currentSingleRoomAssetId && currentSingleRoomAssetId > 0
          ? await apiRequest<{ items: ExtractedItemRecord[] }>(
              "/api/workflows/softboard/extract-items",
              {
                method: "POST",
                body: JSON.stringify({
                  project_id: projectId,
                  asset_id: currentSingleRoomAssetId,
                  room_type: options?.roomType ?? "客厅",
                  style: options?.style ?? "柔和极简",
                  provider_name: options?.providerName,
                  model_name: options?.modelName,
                  provider_config_id: options?.providerConfigId ?? undefined,
                }),
              },
            )
          : undefined;

      const extractedItems = extractResponse?.items ?? get().extractedItems;
      const response = await apiRequest<{
        task: { id: number };
        board_documents: BoardDocumentRecord[];
        quote_card: QuoteCard;
      }>("/api/workflows/softboard/single-room", {
        method: "POST",
        body: JSON.stringify({
          project_id: projectId,
          asset_id: currentSingleRoomAssetId,
          room_type: options?.roomType ?? "客厅",
          style: options?.style ?? "柔和极简",
          selected_item_ids: options?.selectedItemIds ?? getSelectedItemIds(extractedItems),
          keep_items: options?.keepItems ?? getSelectedItemNames(extractedItems, "keep"),
          replace_items: options?.replaceItems ?? getSelectedItemNames(extractedItems, "replace"),
          provider_name: options?.providerName,
          model_name: options?.modelName,
          provider_config_id: options?.providerConfigId ?? undefined,
          params_snapshot: {
            output_language: options?.outputLanguage ?? "zh-CN",
            budget_label: options?.budgetLabel,
            persisted_asset_ids:
              options?.assetId
                ? [options.assetId]
                : uploadedAssets.filter((asset) => asset.id > 0).map((asset) => asset.id),
            ...(options?.paramsSnapshot ?? {}),
          },
        }),
      });

      await Promise.all([
        useAssetStore.getState().loadAssets(projectId),
        useReviewStore.getState().fetchSnapshot(projectId),
        useTaskStore.getState().loadTasks(projectId),
      ]);
      await get().loadPersistedProjectBoardData(projectId);

      set((state) => ({
        uploadedAssets:
          state.uploadedAssets.length > 0 ? state.uploadedAssets : filterSourceAssets(uploadedAssets),
        sourceAssets:
          state.sourceAssets.length > 0 ? state.sourceAssets : filterSourceAssets(uploadedAssets),
        extractedItems: extractedItems.length > 0 ? extractedItems : state.extractedItems,
        quoteCard: response.quote_card ?? state.quoteCard,
        currentSingleRoomAssetId,
        extractionSource: resolveExtractionSource(extractedItems),
        isLoadingSingleRoom: false,
        lastBackendMode: "live",
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "单房间方案板生成失败。";
      set({
        isLoadingSingleRoom: false,
        error: message,
        lastBackendMode: "error",
      });
      throw error;
    }
  },
  generateMultiRoomBoards: async (options) => {
    set({ isLoadingMultiRoom: true, error: undefined });
    const projectId = options?.projectId ?? getActiveProjectId();

    try {
      const uploadedAssets =
        options?.skipUpload
          ? []
          : await useAssetStore.getState().uploadAssets(get().multiRoomFiles, {
              projectId,
              assetType: "render_input",
              source: "multi_room_board",
            });

      const persistedAssetIds = options?.assetIds ?? uploadedAssets.filter((asset) => asset.id > 0).map((asset) => asset.id);
      await apiRequest<{
        task: { id: number };
        board_documents: BoardDocumentRecord[];
        budget_summary?: Record<string, unknown>;
      }>("/api/workflows/softboard/multi-room", {
        method: "POST",
        body: JSON.stringify({
          project_id: projectId,
          asset_ids: persistedAssetIds,
          selected_item_ids: options?.selectedItemIds ?? [],
          room_tags: options?.roomTags ?? deriveRoomTags(get().selectedRoomIds),
          style_consistency: options?.styleConsistency ?? 0.82,
          integrated_board_title: options?.integratedBoardTitle ?? "整屋综合方案板",
          provider_name: options?.providerName,
          model_name: options?.modelName,
          provider_config_id: options?.providerConfigId ?? undefined,
          params_snapshot: {
            output_language: options?.outputLanguage ?? "zh-CN",
            persisted_asset_ids: persistedAssetIds,
            ...(options?.paramsSnapshot ?? {}),
          },
        }),
      });

      await Promise.all([
        useAssetStore.getState().loadAssets(projectId),
        useReviewStore.getState().fetchSnapshot(projectId),
        useTaskStore.getState().loadTasks(projectId),
      ]);
      await get().loadPersistedProjectBoardData(projectId);

      set({
        isLoadingMultiRoom: false,
        lastBackendMode: "live",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "多房间方案板生成失败。";
      set({
        isLoadingMultiRoom: false,
        error: message,
        lastBackendMode: "error",
      });
      throw error;
    }
  },
  generateQuoteCard: async () => {
    const projectId = getActiveProjectId();
    const currentSingleRoomAssetId = get().currentSingleRoomAssetId;
    const selectedItemIds = getSelectedItemIds(get().extractedItems);

    try {
      const response = await apiRequest<{ quote_card: QuoteCard }>(
        "/api/workflows/softboard/generate-quote",
        {
          method: "POST",
          body: JSON.stringify({
            project_id: projectId,
            asset_id: currentSingleRoomAssetId,
            room_type: "客厅",
            selected_item_ids: selectedItemIds,
            budget_label: "中档",
          }),
        },
      );

      await useReviewStore.getState().fetchSnapshot(projectId);
      await useTaskStore.getState().loadTasks(projectId);
      await get().loadPersistedProjectBoardData(projectId);

      set({
        quoteCard: response.quote_card,
        lastBackendMode: "live",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "报价卡生成失败。";
      set(() => ({
        quoteCard: undefined,
        error: message,
        lastBackendMode: "error",
      }));
    }
  },
  exportBoardReport: async (fileName, context) => {
    set({ isExportingReport: true, error: undefined });
    const projectId = getActiveProjectId();
    const boardDocuments = currentBoardDocuments(get().boardDocuments, context);

    try {
      if (boardDocuments.length === 0 || !boardDocuments[0]?.task_id) {
        throw new Error("当前图片还没有报告内容，请先点击“生成报告内容”。");
      }
      const response = await exportReportImage({
        project_id: projectId,
        task_id: boardDocuments[0].task_id,
        file_name: fileName,
        title: context.mode === "single" ? "单房间方案板正式交付" : "多房间方案板正式交付",
        board_document_ids: boardDocuments.map((board) => board.id),
        mode: context.mode,
        source_asset_ids: context.sourceAssetIds,
        selected_item_ids: context.selectedItemIds,
        review_snapshot: context.reviewSnapshot,
        generated_asset_id: context.generatedAssetId,
        delivery_prompt_version: "qigou-board-delivery-v2",
        output_language: context.outputLanguage ?? "zh-CN",
        export_config_json: {
          mode: context.mode,
          board_count: boardDocuments.length,
          source_asset_ids: context.sourceAssetIds,
          selected_item_ids: context.selectedItemIds,
          review_snapshot: context.reviewSnapshot,
          generated_asset_id: context.generatedAssetId,
        },
      });

      await useReviewStore.getState().fetchSnapshot(projectId);

      set((state) => ({
        exports: [response, ...state.exports.filter((item) => item.id !== response.id)],
        isExportingReport: false,
        lastBackendMode: "live",
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "图片报告导出失败。";
      set(() => ({
        isExportingReport: false,
        error: message,
        lastBackendMode: "error",
      }));
    }
  },
  exportBoardTable: async (fileName, context) => {
    set({ isExportingReport: true, error: undefined });
    const projectId = getActiveProjectId();
    const boardDocuments = currentBoardDocuments(get().boardDocuments, context);
    try {
      if (context.sourceAssetIds.length === 0) {
        throw new Error("没有当前图片，无法导出对应的结构化表格。");
      }
      const response = await exportStructuredTable({
        project_id: projectId,
        task_id: boardDocuments[0]?.task_id,
        file_name: fileName,
        asset_ids: context.sourceAssetIds,
        selected_item_ids: context.selectedItemIds,
        review_snapshot: context.reviewSnapshot,
        selected_only: context.selectedItemIds.length > 0,
        output_language: context.outputLanguage ?? "zh-CN",
        export_config_json: {
          mode: context.mode,
          source: "board_export_v2",
          source_asset_ids: context.sourceAssetIds,
          selected_item_ids: context.selectedItemIds,
          review_snapshot: context.reviewSnapshot,
        },
      });
      await useReviewStore.getState().fetchSnapshot(projectId);
      set((state) => ({
        exports: [response, ...state.exports.filter((item) => item.id !== response.id)],
        isExportingReport: false,
        lastBackendMode: "live",
      }));
    } catch (error) {
      set({
        isExportingReport: false,
        error: error instanceof Error ? error.message : "结构化表格导出失败。",
        lastBackendMode: "error",
      });
    }
  },
  toggleSelectedRoom: (roomId) =>
    set((state) => ({
      selectedRoomIds: state.selectedRoomIds.includes(roomId)
        ? state.selectedRoomIds.filter((id) => id !== roomId)
        : [...state.selectedRoomIds, roomId],
    })),
}));

function currentBoardDocuments(
  documents: BoardDocumentRecord[],
  context: BoardExportContext,
): BoardDocumentRecord[] {
  const allowedTypes = context.mode === "single"
    ? new Set(["material_board", "color_board", "board_preview", "quote_card"])
    : new Set(["integrated_board", "budget_summary", "split_room_board"]);
  const matching = documents.filter((board) => {
    const data = board.data_json ?? {};
    return allowedTypes.has(board.board_type)
      && data.review_schema_version === 2
      && data.delivery_prompt_version === "qigou-board-delivery-v2"
      && data.review_snapshot === context.reviewSnapshot
      && sameNumberSet(data.source_asset_ids, context.sourceAssetIds)
      && sameNumberSet(data.selected_item_ids, context.selectedItemIds);
  });
  const taskId = Math.max(0, ...matching.map((board) => board.task_id ?? 0));
  return taskId > 0 ? matching.filter((board) => board.task_id === taskId) : [];
}

function sameNumberSet(value: unknown, expected: number[]): boolean {
  if (!Array.isArray(value)) return false;
  const actual = value.map(Number).filter(Number.isInteger).sort((a, b) => a - b);
  const normalizedExpected = [...new Set(expected)].sort((a, b) => a - b);
  return actual.length === normalizedExpected.length
    && actual.every((item, index) => item === normalizedExpected[index]);
}

function deriveRoomTags(roomIds: string[]): Record<string, string> {
  if (roomIds.length === 0) {
    return {};
  }

  return Object.fromEntries(
    roomIds.map((roomId, index) => [
      `room_${index + 1}`,
      roomLabelFromId(roomId),
    ]),
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
  };
  return labels[roomId] ?? roomId;
}

function deriveQuoteCard(
  boardDocuments: BoardDocumentRecord[],
  extractedItems: ExtractedItemRecord[],
): QuoteCard | undefined {
  const quoteBoard = [...boardDocuments]
    .filter((board) => board.board_type === "quote_card")
    .sort((left, right) => (right.updated_at ?? "").localeCompare(left.updated_at ?? ""))[0];

  if (!quoteBoard) {
    if (extractedItems.length === 0) {
      return undefined;
    }

    return {
      items: extractedItems.filter((item) => !isRemovedItem(item)),
      total_min: sumItemPrice(extractedItems, "min"),
      total_max: sumItemPrice(extractedItems, "max"),
      currency: "人民币",
    };
  }

  const data = quoteBoard.data_json ?? {};
  const items = Array.isArray(data.items)
    ? (data.items as ExtractedItemRecord[])
    : extractedItems.filter((item) => !isRemovedItem(item));

  return {
    board_document: quoteBoard,
    items,
    total_min: typeof data.total_min === "number" ? data.total_min : sumItemPrice(items, "min"),
    total_max: typeof data.total_max === "number" ? data.total_max : sumItemPrice(items, "max"),
    currency: typeof data.currency === "string" ? data.currency : "人民币",
  };
}

function getActiveProjectId(): number {
  return useProjectStore.getState().activeProjectId;
}

function filterExtractedItemsByAsset(
  items: ExtractedItemRecord[],
  assetId?: number,
): ExtractedItemRecord[] {
  if (!assetId) {
    return items;
  }

  return items.filter((item) => item.asset_id === assetId);
}

function getLatestSingleRoomAssetId(assets: AssetRecord[]): number | undefined {
  return [...assets]
    .filter((asset) => asset.type === "render_input" && asset.source === "single_room_board")
    .sort(sortByCreatedAt)[0]?.id;
}

function filterSourceAssets(assets: AssetRecord[]): AssetRecord[] {
  return assets.filter((asset) =>
    ["render_input", "reference_image", "space_input", "su_view", "logo"].includes(asset.type),
  );
}

function filterPreviewAssets(assets: AssetRecord[]): AssetRecord[] {
  return assets.filter((asset) => asset.type === "board_output");
}

function sortByCreatedAt(left: { created_at?: string }, right: { created_at?: string }): number {
  return (right.created_at ?? "").localeCompare(left.created_at ?? "");
}

function getSelectedItemIds(items: ExtractedItemRecord[]): number[] {
  return items
    .filter((item) => !isRemovedItem(item))
    .map((item) => item.id);
}

function getSelectedItemNames(
  items: ExtractedItemRecord[],
  selectionState: SelectionState,
): string[] {
  return items.filter((item) => item.selection_state === selectionState).map((item) => item.name);
}

function sumItemPrice(
  items: ExtractedItemRecord[],
  bound: "min" | "max",
): number {
  return items
    .filter((item) => !isRemovedItem(item))
    .reduce((total, item) => total + (bound === "min" ? item.price_min ?? 0 : item.price_max ?? 0), 0);
}

function isRemovedItem(item: ExtractedItemRecord): boolean {
  return item.selection_state === "remove" || item.selection_state === "replace";
}

function resolveExtractionSource(items: ExtractedItemRecord[]): string | undefined {
  const sources = [...new Set(items.map((item) => item.extraction_source).filter(Boolean))];
  if (sources.length === 0) {
    return undefined;
  }
  return sources.length === 1 ? sources[0] : "mixed";
}
