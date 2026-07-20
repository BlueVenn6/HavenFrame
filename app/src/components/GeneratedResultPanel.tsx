import { aspectRatioToCss } from "../lib/aspect-ratio";
import type { AssetRecord } from "../types";
import { AssetOpenActions } from "./AssetOpenActions";
import { AssetImage } from "./AssetImage";
import { ImageExportAction } from "./ImageExportAction";
import { useLocale } from "../i18n/locale";

export function GeneratedResultPanel({
  asset,
  title,
  aspectRatio = "16:9",
}: {
  asset: AssetRecord;
  title: string;
  aspectRatio?: string;
}) {
  const { text } = useLocale();
  const actualSize = asset.width && asset.height ? `${asset.width}x${asset.height}` : undefined;
  const requestedSize = typeof asset.metadata_json?.requested_size === "string" ? asset.metadata_json.requested_size : aspectRatio;

  return (
    <div className="panel-surface min-w-0 p-5">
      <div className="eyebrow">{text("返回结果", "Result")}</div>
      <h3 className="section-title mt-2">{title}</h3>
      <AssetImage
        assetId={asset.id}
        alt={asset.file_name}
        className="mt-4 w-full rounded-lg border border-studio-border object-contain"
        style={{ aspectRatio: aspectRatioToCss(aspectRatio) }}
      />
      <div className="mt-3 rounded-lg border border-studio-border bg-studio-panelBg p-3 text-xs font-medium text-studio-mutedText">
        <div className="grid gap-2 sm:grid-cols-2">
          <span>{text("请求尺寸", "Requested size")}: {requestedSize}</span>
          <span>{text("实际尺寸", "Actual size")}: {actualSize ?? text("等待中", "Pending")}</span>
        </div>
        <div className="mt-2 break-all">{asset.file_path}</div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <AssetOpenActions asset={asset} />
        <ImageExportAction asset={asset} />
      </div>
    </div>
  );
}
