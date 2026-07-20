import { Link } from "react-router-dom";

import { findRunnableImageModelConfig, modelIdOf, resolveRunnableImageSelection } from "../lib/model-selection";
import { routeAddressStatus, routeKindLabel, workflowRuntimeLabel } from "../lib/model-route-labels";
import { useModelStore } from "../stores/useModelStore";
import type { WorkflowModelOverride, WorkflowModelSlotKey } from "../types";
import { useLocale } from "../i18n/locale";

export function WorkflowModelStatusCard({
  slotKey,
  fallback,
}: {
  slotKey: WorkflowModelSlotKey;
  fallback: WorkflowModelOverride;
}) {
  const { locale, text } = useLocale();
  const workflowModelOverrides = useModelStore((state) => state.workflowModelOverrides);
  const providerConfigs = useModelStore((state) => state.providerConfigs);
  const selection = workflowModelOverrides[slotKey] ?? fallback;
  const runtimeSelection = resolveRunnableImageSelection(providerConfigs, selection);
  const runtimeConfig = findRunnableImageModelConfig(providerConfigs, selection);
  const selectedConfig = providerConfigs.find((config) => config.id === selection.providerConfigId)
    ?? providerConfigs.find((config) => config.provider_name === selection.provider && modelIdOf(config) === selection.model)
    ?? providerConfigs.find((config) => config.provider_name === selection.provider);
  const displayConfig = runtimeConfig ?? selectedConfig;
  const selectionDiffers = runtimeSelection.provider !== selection.provider || runtimeSelection.model !== selection.model;

  return (
    <div className="rounded-lg border border-studio-border bg-studio-panelBg p-3 text-xs font-medium text-studio-mutedText">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="eyebrow">{text("模型入口", "Model route")}</div>
          <div className="mt-1 break-words font-semibold text-studio-navy">
            {displayConfig ? workflowRuntimeLabel(displayConfig, runtimeSelection.model, locale) : (selection.model || text("未选择模型", "No model selected"))}
          </div>
          <div className="mt-1">{text("实际调用", "Actual route")}: {displayConfig ? workflowRuntimeLabel(displayConfig, runtimeSelection.model, locale) : (runtimeSelection.model || text("未选择模型", "No model selected"))}</div>
          {selectionDiffers ? <div className="mt-1 text-amber-800">{text("当前选择会回退到可运行图片模型。", "The current selection falls back to a runnable image model.")}</div> : null}
          {displayConfig ? <div className="mt-1 break-all">{text("线路", "Route")}: {routeKindLabel(displayConfig, locale)} · {text("配置", "Config")} #{displayConfig.id}</div> : null}
          {displayConfig?.routing_mode === "relay_base_url" ? (
            <div className="mt-1 break-all text-emerald-800">{routeAddressStatus(displayConfig, locale)}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link to="/model-settings" className="btn-secondary px-3 py-2 text-xs">{text("模型设置", "Model settings")}</Link>
        </div>
      </div>
    </div>
  );
}
