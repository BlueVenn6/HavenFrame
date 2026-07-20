import { useMemo, useState } from "react";

import { localeLabel } from "../lib/zh-labels";
import { useLocale } from "../i18n/locale";
import { moduleOf } from "../lib/workflow-history";
import type { AssetRecord, Project } from "../types";
import { AssetOpenActions } from "./AssetOpenActions";
import { AssetImage } from "./AssetImage";
import { ImageExportAction } from "./ImageExportAction";

const moduleOptions = [
  { value: "all", zh: "全部模块", en: "All modules" },
  { value: "floorplan", zh: "平面图", en: "Floor Plan" },
  { value: "space_render", zh: "空间渲染", en: "Space Rendering" },
  { value: "single_room_board", zh: "单房间方案板", en: "Single-Room Board" },
  { value: "multi_room_board", zh: "多房间方案板", en: "Multi-Room Board" },
  { value: "custom_tasks", zh: "自定义任务", en: "Custom Tasks" },
];

const sourceOptions = [
  { value: "all", zh: "全部输出", en: "All outputs" },
  { value: "provider_generation", zh: "真实模型", en: "Provider generation" },
  { value: "board_preview_renderer", zh: "方案板预览", en: "Board preview" },
];

export function OutputGalleryPanel({
  title,
  assets,
  projects = [],
  maxItems,
  onAssetExported,
}: {
  title?: string;
  assets: AssetRecord[];
  projects?: Project[];
  maxItems?: number;
  onAssetExported?: (asset: AssetRecord) => void | Promise<void>;
}) {
  const { locale, text } = useLocale();
  const [moduleFilter, setModuleFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");

  const outputAssets = useMemo(
    () =>
      assets
        .filter((asset) => ["board_output", "render_output", "floorplan"].includes(asset.type))
        .filter((asset) => asset.source !== "demo_generation")
        .filter((asset) => moduleFilter === "all" || moduleOf(asset) === moduleFilter)
        .filter((asset) => sourceFilter === "all" || asset.source === sourceFilter)
        .slice(0, maxItems ?? assets.length),
    [assets, maxItems, moduleFilter, sourceFilter],
  );

  return (
    <section className="panel-surface p-5">
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="eyebrow">{text("结果", "Results")}</div>
          <h3 className="section-title mt-2">{title ?? text("输出图库", "Output gallery")}</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)} className="form-field min-w-40">
            {moduleOptions.map((option) => (
              <option key={option.value} value={option.value}>{text(option.zh, option.en)}</option>
            ))}
          </select>
          <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className="form-field min-w-40">
            {sourceOptions.map((option) => (
              <option key={option.value} value={option.value}>{text(option.zh, option.en)}</option>
            ))}
          </select>
          <span className="status-pill">{text(`${outputAssets.length} 个结果`, `${outputAssets.length} results`)}</span>
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        {outputAssets.length > 0 ? outputAssets.map((asset) => {
          const projectName = projects.find((project) => project.id === asset.project_id)?.name;
          const moduleName = moduleOf(asset);
          return (
            <article
              key={asset.id}
              className="overflow-hidden rounded-lg border border-studio-border bg-white transition hover:border-studio-primary"
            >
              <div className="thumbnail-placeholder flex h-36 items-center justify-center overflow-hidden bg-white">
                {asset.mime_type?.startsWith("image/") ? (
                  <AssetImage assetId={asset.id} alt={asset.file_name} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-xs font-semibold text-studio-mutedText">{text("暂无预览", "No preview")}</span>
                )}
              </div>
              <div className="p-3">
                <div className="truncate text-sm font-semibold text-studio-navy">{asset.file_name}</div>
                <div className="mt-1 text-xs font-medium text-studio-mutedText">
                  {localeLabel(moduleName, locale)} · {localeLabel(asset.source, locale) || asset.source || text("输出", "Output")}
                </div>
                {projectName ? <div className="mt-2 text-xs font-semibold text-studio-primary">{projectName}</div> : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <AssetOpenActions asset={asset} size="sm" />
                  <ImageExportAction asset={asset} size="sm" onExported={() => onAssetExported?.(asset)} />
                </div>
              </div>
            </article>
          );
        }) : (
          <div className="rounded-lg border border-dashed border-studio-border bg-studio-panelBg px-4 py-8 text-sm font-medium text-studio-mutedText">
            {text("当前筛选下还没有输出。生成结果后会自动出现在这里。", "No output matches the current filters. Generated results will appear here.")}
          </div>
        )}
      </div>
    </section>
  );
}
