import { useState } from "react";

import { openExportFile, openExportFolder } from "../api/client";
import { useLocale } from "../i18n/locale";
import { useBoardStore } from "../stores/useBoardStore";

export function ExportDialog({
  reportFileName = "board-report.svg",
  mode = "single",
  sourceAssetIds,
  selectedItemIds,
  reviewSnapshot,
  generatedAssetId,
}: {
  reportFileName?: string;
  mode?: "single" | "multi";
  sourceAssetIds: number[];
  selectedItemIds: number[];
  reviewSnapshot: string;
  generatedAssetId?: number;
}) {
  const { locale, message, text } = useLocale();
  const exports = useBoardStore((state) => state.exports);
  const isExportingReport = useBoardStore((state) => state.isExportingReport);
  const error = useBoardStore((state) => state.error);
  const exportBoardReport = useBoardStore((state) => state.exportBoardReport);
  const exportBoardTable = useBoardStore((state) => state.exportBoardTable);
  const latestReport = exports.find((record) => record.type === "image_report" && matchesCurrentExport(record, mode, sourceAssetIds, selectedItemIds, reviewSnapshot));
  const latestTable = exports.find((record) => record.type === "structured_table" && matchesCurrentExport(record, mode, sourceAssetIds, selectedItemIds, reviewSnapshot));
  const [openMessage, setOpenMessage] = useState<{ exportId: number; text: string; tone?: "default" | "error" } | null>(null);
  const [busyAction, setBusyAction] = useState<{ exportId: number; action: "file" | "folder" } | null>(null);
  const title = mode === "multi" ? text("方案图片报告", "Project Board Report") : text("方案板图片报告", "Room Board Report");
  const description =
    mode === "multi"
      ? text("把当前整案方案板、分房间方案板和预算摘要保存成 A4 竖版 SVG 报告，方便打印、归档、回看或发给客户。", "Save the project board, room boards, and available budget details as an A4 portrait SVG report for printing, delivery, and archive.")
      : text("把当前房间方案板、提取元素、材质和报价摘要保存成 A4 竖版 SVG 报告，方便打印、归档、回看或发给客户。", "Save the room board, available extracted items, materials, and quote details as an A4 portrait SVG report for printing, delivery, and archive.");

  return (
    <div className="panel-surface p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <div className="eyebrow">{text("导出", "Export")}</div>
          <h3 className="section-title mt-2">{title}</h3>
          <p className="body-muted mt-1">{description}</p>
        </div>
        <div className="grid w-full gap-2 sm:grid-cols-2 xl:w-auto">
          <button type="button" disabled={isExportingReport || sourceAssetIds.length === 0} onClick={() => void exportBoardReport(reportFileName, { mode, sourceAssetIds, selectedItemIds, reviewSnapshot, generatedAssetId, outputLanguage: locale })} className="btn-primary">
            {isExportingReport ? text("生成中...", "Generating...") : text("生成正式报告", "Generate report")}
          </button>
          <button type="button" disabled={isExportingReport || sourceAssetIds.length === 0} onClick={() => void exportBoardTable(reportFileName.replace(/\.svg$/i, ".csv"), { mode, sourceAssetIds, selectedItemIds, reviewSnapshot, generatedAssetId, outputLanguage: locale })} className="btn-secondary">
            {text("导出结构化表格", "Export structured table")}
          </button>
        </div>
      </div>
      {!generatedAssetId ? <div className="panel-muted mt-4 p-3 text-sm text-studio-mutedText">{text("尚未生成方案板图片时，正式报告会明确使用当前上传源图作为主视觉依据；这不会阻塞报告导出，也不会把源图标成 AI 生成图。", "If no board image exists, the report clearly uses the current source image as its visual reference. Export remains available and the source is not labeled as AI-generated.")}</div> : null}
      {error ? (
        <div className="soft-alert mt-4">{message(error)}</div>
      ) : null}
      {latestReport ? (
        <div className="mt-4 rounded-lg border border-studio-border bg-studio-panelBg px-4 py-3 text-sm font-medium text-studio-mutedText">
          {text("最新图片报告：", "Latest report: ")}<span className="text-studio-navy">{latestReport.file_name}</span>
          <div className="mt-1 text-xs">{text("报告优先使用当前图片模型结果；没有生成图时使用当前源图。GLM 提取、人工确认和预算均按已有内容选用。", "The report uses the generated image when available, otherwise the current source image. Extraction, review, and budget data are included only when available.")}</div>
          <div className="mt-1 break-all text-xs">{latestReport.file_path}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary px-3 py-2 text-xs"
              disabled={busyAction !== null}
              onClick={() => void runOpenAction(latestReport.id, "file", text("图片报告", "report"))}
            >
              {busyAction?.exportId === latestReport.id && busyAction.action === "file" ? text("正在打开...", "Opening...") : text("打开图片报告", "Open report")}
            </button>
            <button
              type="button"
              className="btn-secondary px-3 py-2 text-xs"
              disabled={busyAction !== null}
              onClick={() => void runOpenAction(latestReport.id, "folder", text("图片报告", "report"))}
            >
              {busyAction?.exportId === latestReport.id && busyAction.action === "folder" ? text("正在打开...", "Opening...") : text("打开文件夹", "Open folder")}
            </button>
          </div>
          {openMessage?.exportId === latestReport.id ? (
            <div className={`mt-2 text-xs font-semibold ${openMessage.tone === "error" ? "text-amber-700" : "text-studio-mutedText"}`}>
              {openMessage.text}
            </div>
          ) : null}
        </div>
      ) : null}
      {latestTable ? (
        <div className="mt-4 rounded-lg border border-studio-border bg-studio-panelBg px-4 py-3 text-sm font-medium text-studio-mutedText">
          {text("最新结构化表格：", "Latest structured table: ")}<span className="text-studio-navy">{latestTable.file_name}</span>
          <div className="mt-1 text-xs">{text("UTF-8 BOM CSV，内容来自当前图片的提取项；预算和采购信息允许留空。", "UTF-8 BOM CSV built from the current image extraction. Budget and procurement fields may remain empty.")}</div>
          <div className="mt-1 break-all text-xs">{latestTable.file_path}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-secondary px-3 py-2 text-xs" disabled={busyAction !== null} onClick={() => void runOpenAction(latestTable.id, "file", text("采购表格", "table"))}>{text("打开表格", "Open table")}</button>
            <button type="button" className="btn-secondary px-3 py-2 text-xs" disabled={busyAction !== null} onClick={() => void runOpenAction(latestTable.id, "folder", text("采购表格", "table"))}>{text("打开文件夹", "Open folder")}</button>
          </div>
          {openMessage?.exportId === latestTable.id ? (
            <div className={`mt-2 text-xs font-semibold ${openMessage.tone === "error" ? "text-amber-700" : "text-studio-mutedText"}`}>
              {openMessage.text}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  async function runOpenAction(exportId: number, action: "file" | "folder", label: string) {
    if (busyAction) return;
    setOpenMessage(null);
    setBusyAction({ exportId, action });
    try {
      const result = action === "file" ? await openExportFile(exportId) : await openExportFolder(exportId);
      setOpenMessage({ exportId, text: `${action === "file" ? text("已打开", "Opened ") + label : text("已打开文件夹", "Opened folder")}: ${result.path}` });
    } catch (error) {
      setOpenMessage({ exportId, text: error instanceof Error ? error.message : text("打开失败。", "Could not open the file."), tone: "error" });
    } finally {
      setBusyAction(null);
    }
  }
}

function matchesCurrentExport(
  record: { export_config_json?: Record<string, unknown> },
  mode: "single" | "multi",
  sourceAssetIds: number[],
  selectedItemIds: number[],
  reviewSnapshot: string,
): boolean {
  const config = record.export_config_json ?? {};
  return config.mode === mode
    && config.review_snapshot === reviewSnapshot
    && sameNumberSet(config.source_asset_ids ?? config.asset_ids, sourceAssetIds)
    && sameNumberSet(config.selected_item_ids, selectedItemIds);
}

function sameNumberSet(value: unknown, expected: number[]): boolean {
  if (!Array.isArray(value)) return false;
  const actual = value.map(Number).filter(Number.isInteger).sort((a, b) => a - b);
  const normalizedExpected = [...new Set(expected)].sort((a, b) => a - b);
  return actual.length === normalizedExpected.length
    && actual.every((item, index) => item === normalizedExpected[index]);
}
