import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";

import { useLocale } from "../i18n/locale";
import {
  defaultVisionModelForConfig,
  isPotentialVisionProviderConfig,
  isRunnableImageProviderConfig,
  isSupportedInteriorImageModelConfig,
  isUsableVisionModelId,
  modelIdOf,
  resolveRunnableImageSelection,
  resolveRunnableVisionSelection,
  visionModelForSelection,
} from "../lib/model-selection";
import { routeAddressStatus, routeIdentityLabel, workflowConfigOptionLabel, workflowRuntimeLabel, workflowVisionOptionLabel } from "../lib/model-route-labels";
import { useModelStore } from "../stores/useModelStore";
import type { ModelConfig, WorkflowModelOverride as WorkflowModelOverrideValue, WorkflowModelSlotKey } from "../types";

type WorkflowCapability = "image" | "vision";

interface WorkflowModelOverrideProps {
  slotKey: WorkflowModelSlotKey;
  title: string;
  description: string;
  capability: WorkflowCapability;
  fallback: WorkflowModelOverrideValue;
  allowEndpointPath?: boolean;
}

export function WorkflowModelOverride({
  slotKey,
  title,
  description,
  capability,
  fallback,
  allowEndpointPath = false,
}: WorkflowModelOverrideProps) {
  const { locale, text } = useLocale();
  const loadProviderConfigs = useModelStore((state) => state.loadProviderConfigs);
  const providerConfigs = useModelStore((state) => state.providerConfigs);
  const workflowModelOverrides = useModelStore((state) => state.workflowModelOverrides);
  const setWorkflowModelOverride = useModelStore((state) => state.setWorkflowModelOverride);

  useEffect(() => {
    void loadProviderConfigs();
  }, [loadProviderConfigs]);

  const selection = workflowModelOverrides[slotKey] ?? fallback;
  const candidates = useMemo(
    () =>
      providerConfigs
        .filter((config) => config.is_enabled && !config.hidden && !config.deprecated)
        .filter((config) => supportsWorkflowCapability(config, capability))
        .filter((config) => capability !== "image" || isSupportedInteriorImageModelConfig(config)),
    [capability, providerConfigs],
  );
  const safeSelection = capability === "image"
    ? resolveRunnableImageSelection(providerConfigs, selection)
    : resolveRunnableVisionSelection(providerConfigs, selection);
  const selectedConfig = candidates.find((config) => config.id === safeSelection.providerConfigId)
    ?? candidates.find((config) => config.provider_name === safeSelection.provider && modelIdOf(config) === safeSelection.model)
    ?? candidates.find((config) => capability === "image" && modelIdOf(config) === "gpt-image-2")
    ?? candidates[0];
  const rawSelectedConfig = candidates.find((config) => config.id === selection.providerConfigId)
    ?? candidates.find((config) => config.provider_name === selection.provider && modelIdOf(config) === selection.model);
  const normalizedRawModel = rawSelectedConfig
    ? modelForNextConfig(selection.model, capability, rawSelectedConfig)
    : "";
  const selectionIsSupported = Boolean(
    rawSelectedConfig
      && rawSelectedConfig.id === selection.providerConfigId
      && rawSelectedConfig.provider_name === selection.provider
      && (
        capability === "image"
          ? modelIdOf(rawSelectedConfig) === selection.model
          : normalizedRawModel === selection.model
      ),
  );
  const effectiveSelection = selectedConfig ? safeSelection : selection;

  useEffect(() => {
    if (!selectedConfig || selectionIsSupported) {
      return;
    }
    setWorkflowModelOverride(slotKey, {
      provider: selectedConfig.provider_name,
      providerConfigId: selectedConfig.id,
      model: capability === "vision" ? (visionModelForSelection(selectedConfig, selection) || modelIdOf(selectedConfig)) : modelIdOf(selectedConfig),
    });
  }, [capability, selectedConfig, selection, selectionIsSupported, setWorkflowModelOverride, slotKey]);

  const updateSelection = (patch: Partial<WorkflowModelOverrideValue>) => {
    setWorkflowModelOverride(slotKey, {
      ...effectiveSelection,
      ...patch,
    });
  };

  return (
    <section className="panel-surface min-w-0 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow">{text("当前页面模型", "Page model")}</div>
          <h3 className="section-title mt-2">{title}</h3>
          <p className="body-muted mt-1 max-w-3xl">{description}</p>
        </div>
        <Link to="/model-settings" className="btn-secondary px-3 py-2 text-xs">
          {text("全局模型", "Global models")}
        </Link>
      </div>

      <div className="mt-4 grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,0.65fr)]">
        <label className="block min-w-0">
          <span className="mb-2 flex min-h-10 items-end text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">
            {text("模型线路（原生 / 中转）", "Model route (native / relay)")}
          </span>
          <select
            value={selectedConfig?.id ?? ""}
            onChange={(event) => {
              const nextConfig = candidates.find((config) => config.id === Number(event.target.value));
              if (!nextConfig) return;
              updateSelection({
                provider: nextConfig.provider_name,
                providerConfigId: nextConfig.id,
                model: modelForNextConfig(selection.model, capability, nextConfig),
              });
            }}
            className="form-field w-full"
          >
            {candidates.map((config) => (
              <option key={config.id} value={config.id}>
                {workflowOverrideOptionLabel(config, capability, effectiveSelection.model, locale)}
              </option>
            ))}
          </select>
        </label>

        <label className="block min-w-0">
          <span className="mb-2 flex min-h-10 items-end text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">
            {text("当前页面使用的模型 ID", "Model ID used on this page")}
          </span>
          <input
            value={effectiveSelection.model}
            disabled={capability === "vision" && selectedConfig ? !canEditVisionModelId(selectedConfig) : false}
            onChange={(event) => updateSelection({ model: event.target.value.trimStart() })}
            placeholder={capability === "vision" ? text("glm-4.5v 或中转实际 GLM 模型 ID", "glm-4.5v or the relay vision model ID") : "gpt-image-2"}
            className="form-field w-full"
          />
        </label>
      </div>

      {allowEndpointPath ? (
        <label className="mt-4 block min-w-0">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">
            {text("接口路径", "Endpoint path")}
          </span>
          <input
            value={selection.endpointPath ?? ""}
            onChange={(event) => updateSelection({ endpointPath: event.target.value.trim() })}
            placeholder="/images/generations"
            className="form-field w-full"
          />
        </label>
      ) : null}

      <div className="mt-3 rounded-lg border border-studio-border bg-studio-panelBg p-3 text-xs font-medium text-studio-mutedText">
        {text("当前调用：", "Current runtime: ")}<span className="break-all text-studio-navy">{workflowRuntimeLabel(selectedConfig, effectiveSelection.model, locale)}</span>
        {allowEndpointPath && effectiveSelection.endpointPath ? <span> · {effectiveSelection.endpointPath}</span> : null}
      </div>
      {selectedConfig ? (
        <div className={`mt-2 rounded-lg border p-3 text-xs font-semibold ${
          selectedConfig.routing_mode === "relay_base_url"
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-slate-200 bg-slate-50 text-slate-700"
        }`}>
          {text("当前页面线路：", "Page route: ")}{routeIdentityLabel(selectedConfig, locale)}
          {selectedConfig.routing_mode === "relay_base_url"
            ? ` · ${routeAddressStatus(selectedConfig, locale)} · ${text(`提交任务会携带配置 #${selectedConfig.id}，不会静默改发官方原生 API。`, `Tasks use configuration #${selectedConfig.id}; no silent fallback to an official API.`)}`
            : ` · ${text("配置", "configuration")} #${selectedConfig.id}`}
        </div>
      ) : null}
      {selectedConfig && capability === "image" && !isRunnableImageProviderConfig(selectedConfig) ? (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
          {text("该线路尚未保存 API Key；线路和模型已选定，保存 Key 后即可提交真实生成。", "This route has no saved API key. The route and model are selected; save a key before starting real generation.")}
        </div>
      ) : null}
      {capability === "image" ? (
        <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
          {text("当前生成按钮接入 OpenAI 原生、OpenAI 中转和 Google Gemini 图片线路；所有生成都会进入后端任务队列。", "Generation uses OpenAI native, OpenAI relay, or Google Gemini image routes. Every generation enters the task queue.")}
        </div>
      ) : null}
      {capability === "vision" && selectedConfig?.routing_mode === "relay_base_url" && !selectedConfig.base_url?.trim() ? (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
          {text("当前中转配置缺少 Base URL。请在全局模型里保存 HTTPS 中转地址，或改用原生视觉模型。", "This relay is missing a Base URL. Save an HTTPS relay URL in Global Models or use a native vision model.")}
        </div>
      ) : null}
    </section>
  );
}

function workflowOverrideOptionLabel(config: ModelConfig, capability: WorkflowCapability, currentModel: string, locale: "zh-CN" | "en"): string {
  if (capability === "image") {
    return workflowConfigOptionLabel(config, locale);
  }
  const visionModel = modelForNextConfig(currentModel, "vision", config);
  return workflowVisionOptionLabel(config, visionModel || (locale === "zh-CN" ? "视觉模型未设置" : "Vision model not set"), locale);
}

function supportsWorkflowCapability(config: ModelConfig, capability: WorkflowCapability): boolean {
  if (capability === "vision") {
    return isPotentialVisionProviderConfig(config);
  }
  return isSupportedInteriorImageModelConfig(config);
}

function modelForNextConfig(model: string, capability: WorkflowCapability, config: ModelConfig): string {
  if (capability === "vision") {
    if (model.trim().toLowerCase().startsWith("glm") && isUsableVisionModelId(model) && canEditVisionModelId(config) && !isOpenAIImageRelayConfig(config)) {
      return model;
    }
    return defaultVisionModelForConfig(config);
  }
  return modelIdOf(config);
}

function canEditVisionModelId(config: ModelConfig): boolean {
  const providerId = (config.provider_id ?? config.extra_config_json?.provider_id ?? "").toLowerCase();
  return config.routing_mode === "relay_base_url" || providerId.includes("custom");
}

function isOpenAIImageRelayConfig(config: ModelConfig): boolean {
  const providerId = (config.provider_id ?? config.extra_config_json?.provider_id ?? "").toLowerCase();
  const compatibilityMode = (config.compatibility_mode ?? config.extra_config_json?.compatibility_mode ?? "").toLowerCase();
  return config.routing_mode === "relay_base_url"
    && modelIdOf(config) === "gpt-image-2"
    && (
      compatibilityMode === "openai_compatible"
      || providerId === "openai"
      || providerId === "custom_openai"
      || providerId === "openai_compatible_custom"
    );
}
