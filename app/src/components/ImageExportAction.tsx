import { useState } from "react";

import { exportImageFile } from "../api/client";
import type { AssetRecord } from "../types";
import { useLocale } from "../i18n/locale";

export function ImageExportAction({
  asset,
  size = "md",
  onExported,
}: {
  asset: Pick<AssetRecord, "id" | "file_name" | "project_id" | "metadata_json">;
  size?: "sm" | "md";
  onExported?: () => void | Promise<void>;
}) {
  const { text } = useLocale();
  const [message, setMessage] = useState<{ text: string; tone?: "default" | "error" } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const buttonClass = size === "sm" ? "px-3 py-2 text-xs" : "";

  const exportImage = async () => {
    if (isExporting) return;
    setMessage(null);
    setIsExporting(true);
    try {
      const record = await exportImageFile({
        project_id: asset.project_id,
        asset_id: asset.id,
        file_name: asset.file_name,
        export_config_json: {
          source: "asset_output_action",
          module: asset.metadata_json?.module,
        },
      });
      setMessage({ text: text(`已导出图片：${record.file_name}`, `Image exported: ${record.file_name}`) });
      await onExported?.();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : text("图片导出失败。", "Image export failed."), tone: "error" });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        disabled={isExporting}
        onClick={() => void exportImage()}
        className={`btn-secondary ${buttonClass}`}
      >
        {isExporting ? text("正在导出...", "Exporting...") : text("导出图片", "Export image")}
      </button>
      {message ? (
        <div className={`mt-2 text-xs font-medium ${message.tone === "error" ? "text-amber-700" : "text-studio-mutedText"}`}>
          {message.text}
        </div>
      ) : null}
    </div>
  );
}
