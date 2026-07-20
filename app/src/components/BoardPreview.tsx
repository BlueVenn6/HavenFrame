import { useMemo } from "react";

import { useLocale, type AppLocale } from "../i18n/locale";
import { localeLabel } from "../lib/zh-labels";
import { useBoardStore } from "../stores/useBoardStore";
import { useProjectStore } from "../stores/useProjectStore";
import type { AssetRecord } from "../types";
import { AssetImage } from "./AssetImage";

export function BoardPreview({
  mode = "single",
  heroAsset,
  currentSourceAssets,
  selectedItemIds,
  reviewSnapshot,
}: {
  mode?: "single" | "multi";
  heroAsset?: AssetRecord;
  currentSourceAssets?: AssetRecord[];
  selectedItemIds?: number[];
  reviewSnapshot?: string;
}) {
  const { locale, text } = useLocale();
  const boardDocuments = useBoardStore((state) => state.boardDocuments);
  const extractedItems = useBoardStore((state) => state.extractedItems);
  const persistedSourceAssets = useBoardStore((state) => state.sourceAssets);
  const previewAssets = useBoardStore((state) => state.previewAssets);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const projects = useProjectStore((state) => state.projects);

  const currentDocuments = useMemo(
    () => currentBoardDocuments(boardDocuments, currentSourceAssets, selectedItemIds, reviewSnapshot),
    [boardDocuments, currentSourceAssets, reviewSnapshot, selectedItemIds],
  );
  const singlePreview = useMemo(
    () => buildSinglePreview(currentDocuments, extractedItems, locale, text),
    [currentDocuments, extractedItems, locale, text],
  );
  const multiPreview = useMemo(() => buildMultiPreview(currentDocuments, locale, text), [currentDocuments, locale, text]);
  const singlePreviewAsset = previewAssets.find((asset) => asset.id === singlePreview.previewAssetId);
  const multiPreviewAsset = previewAssets.find((asset) => asset.id === multiPreview.previewAssetId);
  const reportSourceAssets = currentSourceAssets ?? persistedSourceAssets;
  const reportHeroAsset = heroAsset ?? reportSourceAssets[0] ?? singlePreviewAsset ?? multiPreviewAsset;
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const projectName = activeProject?.name || text("未命名项目", "Untitled project");
  const clientName = activeProject?.client_name || text("客户项目", "Client project");
  const designDirection = activeProject?.style_tags || text("设计方向未填写", "Design direction not specified");
  const reportKind = mode === "multi" ? text("多房间方案板", "Multi-room Design Board") : text("单房间方案板", "Single-room Design Board");
  const selectedItemIdSet = new Set(selectedItemIds ?? []);
  const currentSelectedItems = selectedItemIds
    ? extractedItems.filter((item) => selectedItemIdSet.has(item.id))
    : mode === "single" ? singlePreview.items : extractedItems.filter((item) => item.selection_state === "keep");
  const reportItems = currentSelectedItems.slice(0, 8);
  const reportSources = reportSourceAssets.slice(0, 3);
  const budgetMin = currentSelectedItems.reduce((sum, item) => sum + Number(item.price_min ?? 0), 0);
  const budgetMax = currentSelectedItems.reduce((sum, item) => sum + Number(item.price_max ?? 0), 0);

  return (
    <div className="panel-surface min-w-0 max-w-full overflow-hidden p-5">
      <div className="mb-4">
        <div className="eyebrow">{text("方案板预览", "Board preview")}</div>
        <h3 className="section-title mt-2">
          {mode === "multi" ? text("全案整合方案板", "Integrated project board") : text("单房间方案板", "Single-room board")}
        </h3>
      </div>

      <div className="mx-auto flex w-full max-w-[794px] min-w-0 flex-col overflow-hidden rounded-lg bg-studio-panelBg shadow-panel md:aspect-[210/297]">
        <div className="shrink-0 bg-studio-navy px-6 py-5 text-white">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-teal-200">{text("栖构 · 客户正式交付", "HavenFrame · Client Delivery")}</div>
          <div className="mt-2 break-words text-3xl font-semibold">{projectName}</div>
          <div className="mt-2 break-words text-sm text-slate-300">{reportKind} · {clientName} · {designDirection}</div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
          <section className="grid min-h-0 grid-cols-[minmax(0,1.65fr)_minmax(180px,0.75fr)] gap-4">
            <div className="min-h-0 overflow-hidden rounded-lg bg-slate-200">
              {reportHeroAsset ? (
                <AssetImage assetId={reportHeroAsset.id} alt={projectName} className="h-full min-h-56 w-full object-cover" />
              ) : (
                <div className="flex h-full min-h-56 items-center justify-center px-5 text-center text-sm font-medium text-studio-mutedText">
                  {text("当前项目图片会显示在这里", "The current project image appears here")}
                </div>
              )}
            </div>
            <div className="min-w-0 rounded-lg border border-studio-border bg-white p-4">
              <div className="text-lg font-semibold text-studio-navy">{text("交付摘要", "Delivery Summary")}</div>
              <ReportSummaryRow label={text("预算范围", "Budget Range")} value={budgetMin || budgetMax ? `${text("人民币", "CNY")} ${budgetMin.toLocaleString()} - ${budgetMax.toLocaleString()}` : text("未填写（可选）", "Not provided (optional)")} />
              <ReportSummaryRow label={text("房间", "Rooms")} value={mode === "multi" ? multiPreview.rooms.join(" / ") || text("未提取", "Not extracted") : text("单房间", "Single Room")} />
              <ReportSummaryRow label={text("保留 / 采购", "Retained / Procurement")} value={`${reportItems.length} ${text("项", "items")}`} />
              <ReportSummaryRow label={text("主视觉来源", "Hero Source")} value={reportHeroAsset?.source === "provider_generation" ? text("图片模型结果", "Image-model result") : text("当前项目源图", "Current project source")} />
            </div>
          </section>

          <section className="shrink-0">
            <div className="eyebrow">{text("当前图片依据", "Current Image Basis")}</div>
            <div className="mt-2 grid min-w-0 grid-cols-3 gap-3">
              {(reportSources.length ? reportSources : reportHeroAsset ? [reportHeroAsset] : []).map((asset, index) => (
                <div key={asset.id} className="min-w-0 overflow-hidden rounded-lg border border-studio-border bg-white">
                  <AssetImage assetId={asset.id} alt={asset.file_name} className="h-20 w-full object-cover" />
                  <div className="truncate px-3 py-2 text-xs font-medium text-studio-mutedText">{text("来源", "Source")} {String(index + 1).padStart(2, "0")} · {asset.room_type || asset.file_name}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="min-h-0 flex-1">
            <div className="flex min-w-0 items-end justify-between gap-3">
              <div>
                <div className="eyebrow">{text("GLM 提取 + 人工确认", "GLM Extraction + Review")}</div>
                <div className="mt-1 text-lg font-semibold text-studio-navy">{text("保留元素与预算明细", "Retained Items and Budget")}</div>
              </div>
              {reportItems.length >= 8 ? <div className="text-xs text-studio-mutedText">{text("完整清单见结构化表格", "See the structured table for the full list")}</div> : null}
            </div>
            <div className="mt-3 grid min-w-0 gap-2 md:grid-cols-2">
              {reportItems.length ? reportItems.map((item, index) => (
                <div key={item.id} className="min-w-0 rounded-lg border border-studio-border border-l-4 border-l-teal-600 bg-white px-3 py-2">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <div className="min-w-0 truncate text-sm font-semibold text-studio-navy">{String(index + 1).padStart(2, "0")} {item.name}</div>
                    <span className={`${selectionPillClass(item.selection_state)} shrink-0`}>{localeLabel(item.selection_state, locale)}</span>
                  </div>
                  <div className="mt-1 truncate text-xs text-studio-mutedText">{item.room_type || text("房间未标注", "Room not specified")} · {item.material || text("材质未标注", "Material not specified")} · {item.color || text("颜色未标注", "Color not specified")}</div>
                </div>
              )) : (
                <div className="rounded-lg border border-studio-border bg-white px-4 py-3 text-sm text-studio-mutedText md:col-span-2">{text("未选择提取元素；报告仍保留当前图片和设计方向。", "No extracted items were selected; the image and design direction remain available.")}</div>
              )}
            </div>
          </section>
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-studio-border px-5 py-3 text-xs text-studio-mutedText">
          <span>{text("A4 竖版客户交付预览", "A4 portrait client-delivery preview")}</span>
          <span>{text("HAVENFRAME · A4 DELIVERY", "HAVENFRAME · A4 DELIVERY")}</span>
        </div>
      </div>
    </div>
  );
}

function ReportSummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-4 min-w-0">
      <div className="text-xs font-semibold text-studio-mutedText">{label}</div>
      <div className="mt-1 line-clamp-2 break-words text-sm font-semibold text-studio-navy">{value}</div>
    </div>
  );
}

function currentBoardDocuments(
  documents: ReturnType<typeof useBoardStore.getState>["boardDocuments"],
  sourceAssets?: AssetRecord[],
  selectedItemIds?: number[],
  reviewSnapshot?: string,
) {
  if (!sourceAssets || selectedItemIds == null || reviewSnapshot == null) return documents;
  const sourceAssetIds = sourceAssets.map((asset) => asset.id);
  const matching = documents.filter((document) => {
    const data = document.data_json ?? {};
    return data.review_schema_version === 2
      && data.delivery_prompt_version === "qigou-board-delivery-v2"
      && data.review_snapshot === reviewSnapshot
      && sameNumberSet(data.source_asset_ids, sourceAssetIds)
      && sameNumberSet(data.selected_item_ids, selectedItemIds);
  });
  const latestTaskId = Math.max(0, ...matching.map((document) => document.task_id ?? 0));
  return latestTaskId ? matching.filter((document) => document.task_id === latestTaskId) : matching;
}

function sameNumberSet(value: unknown, expected: number[]): boolean {
  if (!Array.isArray(value)) return false;
  const actual = value.map(Number).filter(Number.isInteger).sort((left, right) => left - right);
  const normalizedExpected = [...new Set(expected)].sort((left, right) => left - right);
  return actual.length === normalizedExpected.length
    && actual.every((item, index) => item === normalizedExpected[index]);
}

function buildSinglePreview(
  boardDocuments: ReturnType<typeof useBoardStore.getState>["boardDocuments"],
  extractedItems: ReturnType<typeof useBoardStore.getState>["extractedItems"],
  locale: AppLocale,
  text: (zh: string, en: string) => string,
) {
  const previewBoard =
    boardDocuments.find((board) => board.board_type === "board_preview") ?? boardDocuments[0];
  const materialBoard = boardDocuments.find((board) => board.board_type === "material_board");
  const colorBoard = boardDocuments.find((board) => board.board_type === "color_board");
  const previewData = previewBoard?.data_json ?? {};
  const materialData = materialBoard?.data_json ?? {};
  const colorData = colorBoard?.data_json ?? {};
  const items =
    (Array.isArray(previewData.selected_items) ? previewData.selected_items : extractedItems) ??
    extractedItems;

  return {
    heroTitle:
      typeof previewBoard?.title === "string" ? localeLabel(previewBoard.title, locale) : text("单房间方案板", "Single-room board"),
    heroSubtitle:
      typeof previewData.hero === "object" && previewData.hero && "style" in previewData.hero
        ? `${text("风格方向：", "Style: ")}${localeLabel(String(previewData.hero.style), locale)}`
        : text("根据已保存的方案板数据和元素选择生成预览。", "Preview based on saved board data and item selections."),
    referenceLabel:
      typeof previewData.reference_area === "object" && previewData.reference_area && "heading" in previewData.reference_area
        ? String(previewData.reference_area.heading)
        : text("已保存参考", "Saved reference"),
    previewAssetId: previewBoard?.preview_asset_id,
    items: (items as typeof extractedItems).slice(0, 8),
    materials: extractStringList(materialData.materials ?? previewData.materials, []),
    colors: extractStringList(colorData.colors ?? previewData.colors, []),
    keepCount: extractedItems.filter((item) => item.selection_state === "keep").length,
    removeCount: extractedItems.filter((item) => item.selection_state === "remove" || item.selection_state === "replace").length,
  };
}

function buildMultiPreview(
  boardDocuments: ReturnType<typeof useBoardStore.getState>["boardDocuments"],
  locale: AppLocale,
  text: (zh: string, en: string) => string,
) {
  const integratedBoard =
    boardDocuments.find((board) => board.board_type === "integrated_board") ?? boardDocuments[0];
  const budgetBoard = boardDocuments.find((board) => board.board_type === "budget_summary");
  const splitBoards = boardDocuments
    .filter((board) => board.board_type === "split_room_board")
    .map((board) => ({
      id: board.id,
      title: board.title,
      room:
        typeof board.data_json?.room === "string"
          ? board.data_json.room
          : board.title.replace(" Split Board", "").replace("分房间方案板", ""),
    }));

  return {
    title: integratedBoard?.title ? localeLabel(integratedBoard.title, locale) : text("整合设计方案板", "Integrated design board"),
    previewAssetId: integratedBoard?.preview_asset_id,
    rooms: extractStringList(integratedBoard?.data_json?.rooms, []).map((value) => localeLabel(value, locale)),
    sections: extractStringList(integratedBoard?.data_json?.sections, []).map((value) => localeLabel(value, locale)),
    rangeMin:
      typeof budgetBoard?.data_json?.range_min === "number" ? budgetBoard.data_json.range_min : 0,
    rangeMax:
      typeof budgetBoard?.data_json?.range_max === "number" ? budgetBoard.data_json.range_max : 0,
    currency:
      typeof budgetBoard?.data_json?.currency === "string" ? localeLabel(budgetBoard.data_json.currency, locale) : text("人民币", "CNY"),
    splitBoards: splitBoards.map((board) => ({ ...board, room: localeLabel(board.room, locale), title: localeLabel(board.title, locale) })),
  };
}

function extractStringList(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : fallback;
}

function selectionPillClass(selectionState?: string) {
  switch (selectionState) {
    case "keep":
      return "rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700";
    case "replace":
    case "remove":
      return "rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700";
    default:
      return "rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600";
  }
}
