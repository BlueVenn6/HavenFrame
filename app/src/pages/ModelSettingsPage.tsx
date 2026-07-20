import { useEffect, useMemo, useState } from "react";

import { useLocale } from "../i18n/locale";
import {
  defaultVisionModelForConfig,
  isConfiguredOpenAICompatibleRelay,
  isPotentialVisionProviderConfig,
  isSupportedInteriorImageModelConfig,
  isUsableVisionModelId,
  modelIdOf,
} from "../lib/model-selection";
import { routeAddressStatus, workflowRuntimeLabel } from "../lib/model-route-labels";
import { localeLabel } from "../lib/zh-labels";
import { useModelStore } from "../stores/useModelStore";
import type { CompatibilityMode, ModelConfig, ModelConnectivityTestResult, ModuleName, RoutingMode, WorkflowModelSlotKey } from "../types";

const WORKFLOW_MODULES: Array<{ label: string; value: ModuleName }> = [
  { label: "平面图", value: "floorplan" },
  { label: "方案板", value: "boards" },
  { label: "空间渲染", value: "space_render" },
  { label: "图片编辑", value: "image_editing" },
];

const EXTRACTION_WORKFLOW_SLOTS: Array<{ label: string; value: WorkflowModelSlotKey }> = [
  { label: "单房间提取", value: "room_board.extraction" },
  { label: "多房间提取", value: "multi_room_board.extraction" },
];
const EXTRACTION_MODULE_BY_SLOT: Record<"room_board.extraction" | "multi_room_board.extraction", ModuleName> = {
  "room_board.extraction": "room_board_extraction",
  "multi_room_board.extraction": "multi_room_board_extraction",
};

const IMAGE_MODEL_PRIORITY = ["gpt-image-2", "gemini-2.5-flash-image"];
const RUNNABLE_IMAGE_MODEL_IDS = [
  "gpt-image-2",
  "gemini-2.5-flash-image",
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image-preview",
];
const DEFAULT_EXTRACTION_MODEL_ID = "glm-4.5v";
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const ZHIPU_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const ZAI_BASE_URL = "https://api.z.ai/api/paas/v4";

type RouteTarget = "image" | "extraction";

interface WorkflowRouteOption {
  key: string;
  label: string;
  groupLabel: string;
  config: ModelConfig;
  target: RouteTarget;
  modelId: string;
  providerId: string;
  routingMode: RoutingMode;
  compatibilityMode: CompatibilityMode;
  baseUrl: string;
  endpointPath: string;
  apiKeyName: string;
  capability: string;
}

function titleOf(config?: ModelConfig): string {
  return config?.display_name ?? config?.model_label ?? config?.extra_config_json?.label ?? config?.model_name ?? "模型";
}

function providerIdOf(config?: ModelConfig): string {
  return config?.provider_id ?? config?.extra_config_json?.provider_id ?? "";
}

function capabilityOf(config?: ModelConfig): string {
  return config?.capability ?? config?.extra_config_json?.capability ?? "text";
}

function compatibilityOf(config?: ModelConfig): CompatibilityMode {
  return config?.compatibility_mode ?? config?.extra_config_json?.compatibility_mode ?? "native";
}

function keyRefFor(config?: ModelConfig, compatibilityMode?: CompatibilityMode): string {
  if (config?.api_key_name) return config.api_key_name;
  if (config?.extra_config_json?.api_key_name) return config.extra_config_json.api_key_name;
  const providerId = providerIdOf(config);
  if (compatibilityMode === "gemini_compatible" && config?.routing_mode === "relay_base_url") return "GEMINI_RELAY_API_KEY";
  if (providerId === "openai" && compatibilityMode !== "openai_compatible") return "OPENAI_API_KEY";
  if (compatibilityMode === "openai_compatible") return "OPENAI_RELAY_API_KEY";
  if (providerId === "google_gemini" || compatibilityMode === "gemini_compatible") return "GEMINI_API_KEY";
  if (providerId === "zhipu_glm") return "ZHIPU_API_KEY";
  if (providerId === "zai_glm") return "ZAI_API_KEY";
  if (providerId === "volcengine_ark") return "ARK_API_KEY";
  if (providerId === "custom_rest" || compatibilityMode === "custom_rest") return "CUSTOM_REST_API_KEY";
  return "OPENAI_RELAY_API_KEY";
}

function routeKey(providerId: string, modelId: string, routingMode: RoutingMode, compatibilityMode: CompatibilityMode, target: RouteTarget): string {
  return `${target}:${providerId}:${modelId}:${routingMode}:${compatibilityMode}`;
}

function exactRouteConfig(
  configs: ModelConfig[],
  providerId: string,
  modelId: string,
  routingMode: RoutingMode,
  compatibilityMode: CompatibilityMode,
): ModelConfig | undefined {
  return configs.find((config) =>
    providerIdOf(config) === providerId
    && modelIdOf(config) === modelId
    && config.routing_mode === routingMode
    && compatibilityOf(config) === compatibilityMode,
  );
}

function routeTemplateConfig(configs: ModelConfig[], providerId: string, preferredModelId: string): ModelConfig | undefined {
  return exactRouteConfig(configs, providerId, preferredModelId, "direct_api", "native")
    ?? configs.find((config) => providerIdOf(config) === providerId && modelIdOf(config) === preferredModelId)
    ?? configs.find((config) => providerIdOf(config) === providerId);
}

function relayTemplateConfig(configs: ModelConfig[], compatibilityMode: CompatibilityMode): ModelConfig | undefined {
  return configs.find((config) => config.routing_mode === "relay_base_url" && compatibilityOf(config) === compatibilityMode)
    ?? configs.find((config) => config.routing_mode === "relay_base_url");
}

function cloneRouteConfig({
  template,
  providerId,
  providerName,
  providerLabel,
  providerType,
  modelId,
  displayName,
  routingMode,
  compatibilityMode,
  baseUrl,
  endpointPath,
  apiKeyName,
  capability,
  priority,
}: {
  template?: ModelConfig;
  providerId: string;
  providerName: string;
  providerLabel: string;
  providerType: string;
  modelId: string;
  displayName: string;
  routingMode: RoutingMode;
  compatibilityMode: CompatibilityMode;
  baseUrl: string;
  endpointPath: string;
  apiKeyName: string;
  capability: string;
  priority: number;
}): ModelConfig {
  return {
    ...(template ?? {}),
    id: -Math.abs(hashRouteKey(`${providerId}:${modelId}:${routingMode}:${compatibilityMode}`)),
    provider_type: providerType,
    provider_name: providerName,
    provider_id: providerId,
    provider_label: providerLabel,
    routing_mode: routingMode,
    compatibility_mode: compatibilityMode,
    endpoint: baseUrl,
    base_url: baseUrl,
    api_key_name: apiKeyName,
    api_key: undefined,
    api_key_encrypted: undefined,
    has_api_key: false,
    model_name: modelId,
    model_id: modelId,
    model_label: displayName,
    display_name: displayName,
    capability,
    capabilities_json: capability === "image" ? ["image", "text_to_image", "image_to_image"] : ["vision"],
    timeout_sec: capability === "image" ? Math.max(template?.timeout_sec ?? 0, 900) : (template?.timeout_sec ?? 120),
    max_concurrency: template?.max_concurrency ?? 1,
    headers_json: template?.headers_json,
    query_params_json: template?.query_params_json,
    payload_template_json: template?.payload_template_json,
    response_mapping_json: template?.response_mapping_json,
    is_default: template?.is_default ?? false,
    is_enabled: template?.is_enabled ?? true,
    priority: template?.priority ?? priority,
    tags_json: template?.tags_json ?? ["interior_workflow"],
    required_auth_fields: routingMode === "relay_base_url" ? ["base_url", "api_key_or_headers"] : ["api_key"],
    default_endpoint_path: endpointPath,
    relay_supported: routingMode === "relay_base_url",
    direct_api_supported: routingMode === "direct_api",
    extra_config_json: {
      ...(template?.extra_config_json ?? {}),
      provider_id: providerId,
      provider_label: providerLabel,
      model_id: modelId,
      label: displayName,
      model_label: displayName,
      display_name: displayName,
      capability,
      compatibility_mode: compatibilityMode,
      api_key_name: apiKeyName,
      default_endpoint_path: endpointPath,
      relay_supported: routingMode === "relay_base_url",
      direct_api_supported: routingMode === "direct_api",
      costly: capability === "image",
      recommended: modelId === "gpt-image-2" || modelId === DEFAULT_EXTRACTION_MODEL_ID,
    },
  } as ModelConfig;
}

function hashRouteKey(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return hash || 1;
}

function displayNameForModel(modelId: string): string {
  const labels: Record<string, string> = {
    "gpt-image-2": "GPT Image 2",
    "gemini-2.5-flash-image": "Gemini 2.5 Flash Image (Nano Banana)",
    "gemini-3-pro-image-preview": "Gemini 3 Pro Image Preview (Nano Banana Pro)",
    "gemini-3.1-flash-image-preview": "Gemini 3.1 Flash Image Preview (Nano Banana 2)",
    "glm-4.5v": "GLM-4.5V 多模态",
  };
  return labels[modelId] ?? modelId;
}

function buildRouteOption(params: Omit<WorkflowRouteOption, "key" | "label"> & { labelPrefix: string }): WorkflowRouteOption {
  return {
    ...params,
    key: routeKey(params.providerId, params.modelId, params.routingMode, params.compatibilityMode, params.target),
    label: `${params.labelPrefix} · ${params.modelId}`,
  };
}

function buildWorkflowRouteOptions(configs: ModelConfig[], locale: "zh-CN" | "en"): WorkflowRouteOption[] {
  const options: WorkflowRouteOption[] = [];
  const openAiTemplate = routeTemplateConfig(configs, "openai", "gpt-image-2");
  const openAiRelayTemplate = exactRouteConfig(configs, "openai", "gpt-image-2", "relay_base_url", "openai_compatible")
    ?? relayTemplateConfig(configs, "openai_compatible")
    ?? openAiTemplate;
  const geminiTemplate = routeTemplateConfig(configs, "google_gemini", "gemini-2.5-flash-image");
  const geminiRelayTemplate = relayTemplateConfig(configs, "gemini_compatible") ?? geminiTemplate;
  const glmTemplate = routeTemplateConfig(configs, "zhipu_glm", DEFAULT_EXTRACTION_MODEL_ID);
  const zaiGlmTemplate = routeTemplateConfig(configs, "zai_glm", DEFAULT_EXTRACTION_MODEL_ID);

  const addImageRoute = (
    providerId: "openai" | "google_gemini",
    modelId: string,
    routingMode: RoutingMode,
    compatibilityMode: CompatibilityMode,
    template?: ModelConfig,
  ) => {
    const exact = exactRouteConfig(configs, providerId, modelId, routingMode, compatibilityMode);
    const providerLabel = providerId === "openai" ? "OpenAI" : "Google Gemini";
    const isRelay = routingMode === "relay_base_url";
    const baseUrl = exact?.base_url
      ?? (isRelay
        ? (template?.routing_mode === "relay_base_url" ? template.base_url ?? "" : "")
        : (providerId === "openai" ? OPENAI_BASE_URL : GEMINI_BASE_URL));
    const endpointPath = providerId === "openai" ? "/images/generations" : `/models/${modelId}:generateContent`;
    const config = exact ?? cloneRouteConfig({
      template,
      providerId,
      providerName: isRelay && providerId === "openai" ? "OpenAI-Compatible Relay" : providerLabel,
      providerLabel,
      providerType: isRelay && providerId === "openai" ? "openai_compatible" : "built_in_official",
      modelId,
      displayName: displayNameForModel(modelId),
      routingMode,
      compatibilityMode,
      baseUrl,
      endpointPath,
      apiKeyName: isRelay ? (providerId === "openai" ? "OPENAI_RELAY_API_KEY" : "GEMINI_RELAY_API_KEY") : (providerId === "openai" ? "OPENAI_API_KEY" : "GEMINI_API_KEY"),
      capability: "image",
      priority: providerId === "openai" ? 20 : 30,
    });
    options.push(buildRouteOption({
      labelPrefix: `${providerLabel} ${isRelay ? (locale === "zh-CN" ? "兼容中转" : "Compatible Relay") : (locale === "zh-CN" ? "原生 API" : "Native API")}`,
      groupLabel: locale === "zh-CN" ? "出图线路" : "Generation Routes",
      config,
      target: "image",
      modelId,
      providerId,
      routingMode,
      compatibilityMode,
      baseUrl: config.base_url ?? baseUrl,
      endpointPath,
      apiKeyName: keyRefFor(config, compatibilityMode),
      capability: "image",
    }));
  };

  addImageRoute("openai", "gpt-image-2", "relay_base_url", "openai_compatible", openAiRelayTemplate);
  addImageRoute("openai", "gpt-image-2", "direct_api", "native", openAiTemplate);
  for (const modelId of RUNNABLE_IMAGE_MODEL_IDS.filter((item) => item.startsWith("gemini"))) {
    addImageRoute("google_gemini", modelId, "relay_base_url", "gemini_compatible", geminiRelayTemplate);
    addImageRoute("google_gemini", modelId, "direct_api", "native", geminiTemplate);
  }

  const addGlmExtractionRoute = ({
    providerId,
    providerName,
    baseUrl,
    apiKeyName,
    template,
    priority,
  }: {
    providerId: "zhipu_glm" | "zai_glm";
    providerName: string;
    baseUrl: string;
    apiKeyName: string;
    template?: ModelConfig;
    priority: number;
  }) => {
    const modelId = DEFAULT_EXTRACTION_MODEL_ID;
    const exact = exactRouteConfig(configs, providerId, modelId, "direct_api", "native");
    const config = exact ?? cloneRouteConfig({
      template,
      providerId,
      providerName,
      providerLabel: providerName,
      providerType: "built_in_official",
      modelId,
      displayName: displayNameForModel(modelId),
      routingMode: "direct_api",
      compatibilityMode: "native",
      baseUrl,
      endpointPath: "/chat/completions",
      apiKeyName,
      capability: "vision",
      priority,
    });
    const labelPrefix = providerId === "zhipu_glm"
      ? (locale === "zh-CN" ? "智谱 GLM（中国大陆）" : "Zhipu GLM (Mainland China)")
      : (locale === "zh-CN" ? "Z.AI GLM（国际/海外）" : "Z.AI GLM (International)");
    options.push(buildRouteOption({
      labelPrefix,
      groupLabel: locale === "zh-CN" ? "元素提取线路" : "Extraction Routes",
      config,
      target: "extraction",
      modelId,
      providerId,
      routingMode: "direct_api",
      compatibilityMode: "native",
      baseUrl: config.base_url ?? baseUrl,
      endpointPath: "/chat/completions",
      apiKeyName,
      capability: "vision",
    }));
  };

  addGlmExtractionRoute({
    providerId: "zhipu_glm",
    providerName: "Zhipu GLM Mainland",
    baseUrl: ZHIPU_BASE_URL,
    apiKeyName: "ZHIPU_API_KEY",
    template: glmTemplate,
    priority: 10,
  });
  addGlmExtractionRoute({
    providerId: "zai_glm",
    providerName: "Z.AI International",
    baseUrl: ZAI_BASE_URL,
    apiKeyName: "ZAI_API_KEY",
    template: zaiGlmTemplate,
    priority: 11,
  });

  return options;
}

function statusTone(ok?: boolean, errorType?: string | null): string {
  if (ok) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (errorType === "model_lookup_unavailable") return "border-amber-200 bg-amber-50 text-amber-800";
  if (errorType) return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-studio-border bg-slate-100 text-studio-ink";
}

function statusToneByRelease(releaseStatus?: string | null): string {
  if (releaseStatus === "PASS") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (releaseStatus === "SKIPPED_COST" || releaseStatus === "BLOCKED_LIVE_VERIFICATION") return "border-amber-200 bg-amber-50 text-amber-800";
  if (releaseStatus) return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-studio-border bg-slate-100 text-studio-ink";
}

function routeAddressStatusForState(config: ModelConfig | undefined, routingMode: RoutingMode, baseUrl: string, locale: "zh-CN" | "en" = "zh-CN"): string {
  if (!config) return locale === "zh-CN" ? "未配置" : "Not configured";
  if (routingMode === "relay_base_url") {
    return baseUrl.trim()
      ? (locale === "zh-CN" ? "中转地址已配置" : "Relay address configured")
      : (locale === "zh-CN" ? "中转地址未配置" : "Relay address not configured");
  }
  return locale === "zh-CN" ? "原生官方接口" : "Official native API";
}

function releaseLabel(releaseStatus?: string | null, locale: "zh-CN" | "en" = "zh-CN"): string {
  const labels: Record<string, [string, string]> = {
    PASS: ["发布检查通过", "Release check passed"],
    BLOCKED_CREDENTIAL: ["凭证阻断", "Blocked by credentials"],
    BLOCKED_PROVIDER: ["供应商阻断", "Blocked by provider"],
    BLOCKED_NETWORK: ["网络阻断", "Blocked by network"],
    BLOCKED_UNSUPPORTED: ["暂不支持", "Unsupported"],
    BLOCKED_LIVE_VERIFICATION: ["待真实出图验证", "Live generation required"],
    CODE_FAILURE: ["代码/配置错误", "Code/configuration failure"],
    SKIPPED_COST: ["已跳过计费测试", "Billable test skipped"],
    NOT_TESTED: ["未测试", "Not tested"],
  };
  const label = labels[releaseStatus ?? ""];
  return label?.[locale === "zh-CN" ? 0 : 1] ?? releaseStatus ?? (locale === "zh-CN" ? "未测试" : "Not tested");
}

function isSkippedCostResult(result?: { error_type?: string | null; release_status?: string | null }): boolean {
  return result?.release_status === "SKIPPED_COST"
    || result?.error_type === "skipped_cost_risk"
    || result?.error_type === "cost_risk_skipped";
}

function requiresLiveGenerationVerification(result?: { error_type?: string | null; release_status?: string | null }): boolean {
  return result?.release_status === "BLOCKED_LIVE_VERIFICATION"
    || result?.error_type === "model_lookup_unavailable";
}

function testResultTitle(result?: ModelConnectivityTestResult, locale: "zh-CN" | "en" = "zh-CN"): string {
  if (!result) return locale === "zh-CN" ? "未测试" : "Not tested";
  if (result.ok) return locale === "zh-CN" ? "已连接" : "Connected";
  if (requiresLiveGenerationVerification(result)) return locale === "zh-CN" ? "中转已响应，待真实出图确认" : "Relay responded; live generation required";
  if (isSkippedCostResult(result)) return locale === "zh-CN" ? "已跳过真实出图测试" : "Live generation test skipped";
  return locale === "zh-CN" ? "失败" : "Failed";
}

function testResultBadge(result?: ModelConnectivityTestResult, locale: "zh-CN" | "en" = "zh-CN"): string {
  if (!result) return locale === "zh-CN" ? "未测试" : "Not tested";
  if (result.ok) return locale === "zh-CN" ? "已连接" : "Connected";
  if (requiresLiveGenerationVerification(result)) return locale === "zh-CN" ? "待真实出图验证" : "Live generation required";
  if (isSkippedCostResult(result)) return locale === "zh-CN" ? "非付费测试已跳过" : "Non-billable test skipped";
  return localeLabel(result.error_type ?? "失败", locale);
}

function endpointPathFor(modelId: string, config?: ModelConfig): string {
  if (modelId.trim() === "gpt-image-2") return "/images/generations";
  if (modelId.includes("image") && providerIdOf(config) === "google_gemini") return `/models/${modelId}:generateContent`;
  return config?.default_endpoint_path ?? config?.extra_config_json?.default_endpoint_path ?? "/responses";
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function joinUrl(baseUrl: string, path: string): string {
  if (!baseUrl.trim()) return "";
  return `${trimTrailingSlash(baseUrl)}/${path.replace(/^\/+/, "")}`;
}

function stripOpenAIEndpoint(baseUrl: string): string {
  const normalized = trimTrailingSlash(baseUrl);
  for (const suffix of ["/chat/completions", "/responses", "/images/generations", "/images/edits"]) {
    if (normalized.endsWith(suffix)) return normalized.slice(0, -suffix.length);
  }
  return normalized;
}

function stripGeminiEndpoint(baseUrl: string): string {
  const normalized = trimTrailingSlash(baseUrl);
  const modelsIndex = normalized.indexOf("/models/");
  if (modelsIndex >= 0) return normalized.slice(0, modelsIndex);
  if (normalized.endsWith("/models")) return normalized.slice(0, -"/models".length);
  return normalized;
}

function endpointUrlsFor({
  routingMode,
  compatibilityMode,
  baseUrl,
  endpointPath,
  modelId,
  providerId,
  locale,
}: {
  routingMode: RoutingMode;
  compatibilityMode: CompatibilityMode;
  baseUrl: string;
  endpointPath: string;
  modelId: string;
  providerId: string;
  locale: "zh-CN" | "en";
}): { probeUrl: string; generationUrl: string; note: string } {
  const isGemini = providerId === "google_gemini" || compatibilityMode === "gemini_compatible";
  const officialBase = providerId === "zhipu_glm"
    ? ZHIPU_BASE_URL
    : providerId === "zai_glm"
      ? ZAI_BASE_URL
    : (isGemini ? GEMINI_BASE_URL : OPENAI_BASE_URL);
  const effectiveBase = routingMode === "relay_base_url" ? trimTrailingSlash(baseUrl) : officialBase;
  if (routingMode === "relay_base_url" && !effectiveBase) {
    const emptyLabel = locale === "zh-CN" ? "Base URL 为空" : "Base URL is empty";
    return { probeUrl: emptyLabel, generationUrl: emptyLabel, note: locale === "zh-CN" ? "请先填写 HTTPS 中转 Base URL。" : "Enter an HTTPS relay Base URL first." };
  }

  if (isGemini) {
    const apiBase = stripGeminiEndpoint(effectiveBase);
    const probeUrl = joinUrl(apiBase, `/models/${modelId}`);
    const generationUrl = effectiveBase.endsWith(":generateContent")
      ? effectiveBase
      : joinUrl(apiBase, endpointPath || `/models/${modelId}:generateContent`);
    return {
      probeUrl,
      generationUrl,
      note: locale === "zh-CN"
        ? "测试连接默认请求模型查询接口，不执行真实出图；真实生成通过任务队列请求 generateContent。"
        : "The connection test queries the model endpoint without generating an image. Real generation uses generateContent through the task queue.",
    };
  }

  const apiBase = stripOpenAIEndpoint(effectiveBase);
  const isVisionTextModel = !modelId.startsWith("gpt-image");
  const generationPath = isVisionTextModel ? "/chat/completions" : "/images/generations";
  const generationUrl = effectiveBase.endsWith(generationPath)
    ? effectiveBase
    : joinUrl(apiBase, endpointPath || generationPath);
  return {
    probeUrl: joinUrl(apiBase, `/models/${modelId}`),
    generationUrl,
    note: isVisionTextModel
      ? (locale === "zh-CN" ? "测试连接默认走轻量连通性验证；元素提取通过任务队列请求视觉 Chat API。" : "The connection test performs a lightweight reachability check. Item extraction uses the vision Chat API through the task queue.")
      : (locale === "zh-CN" ? "测试连接默认请求模型查询接口，不执行真实出图；真实生成通过任务队列请求 Image API。" : "The connection test queries the model endpoint without generating an image. Real generation uses the Image API through the task queue."),
  };
}

export function ModelSettingsPage() {
  const { locale, message, text } = useLocale();
  const loadProviderConfigs = useModelStore((state) => state.loadProviderConfigs);
  const providerConfigs = useModelStore((state) => state.providerConfigs);
  const modulePreferences = useModelStore((state) => state.modulePreferences);
  const setModuleSelection = useModelStore((state) => state.setModuleSelection);
  const updateModulePriority = useModelStore((state) => state.updateModulePriority);
  const workflowModelOverrides = useModelStore((state) => state.workflowModelOverrides);
  const setWorkflowModelOverride = useModelStore((state) => state.setWorkflowModelOverride);
  const saveProviderConfig = useModelStore((state) => state.saveProviderConfig);
  const clearProviderApiKey = useModelStore((state) => state.clearProviderApiKey);
  const testModelConnection = useModelStore((state) => state.testModelConnection);
  const selectedTestResult = useModelStore((state) => state.selectedTestResult);
  const isLoadingConfigs = useModelStore((state) => state.isLoadingConfigs);
  const isSavingConfig = useModelStore((state) => state.isSavingConfig);
  const isTestingConnection = useModelStore((state) => state.isTestingConnection);
  const modelError = useModelStore((state) => state.modelError);

  const visibleConfigs = useMemo(
    () => providerConfigs.filter((config) => !config.hidden && !config.deprecated),
    [providerConfigs],
  );
  const imageWorkflowConfigs = useMemo(
    () => visibleConfigs.filter(isSupportedInteriorImageModelConfig),
    [visibleConfigs],
  );
  const extractionWorkflowConfigs = useMemo(
    () => visibleConfigs.filter(isPotentialVisionProviderConfig),
    [visibleConfigs],
  );
  const workflowRouteOptions = useMemo(
    () => buildWorkflowRouteOptions(visibleConfigs, locale),
    [locale, visibleConfigs],
  );

  const defaultRouteOption = useMemo(
    () => {
      const activeImageConfigIds = modulePreferences
        .filter((preference) => WORKFLOW_MODULES.some((module) => module.value === preference.module_name))
        .map((preference) => preference.default_provider_config_id)
        .filter((id): id is number => typeof id === "number");
      return workflowRouteOptions.find((option) => option.target === "image" && activeImageConfigIds.includes(option.config.id))
      ?? workflowRouteOptions.find((option) => option.key === routeKey("openai", "gpt-image-2", "direct_api", "native", "image"))
      ?? workflowRouteOptions.find((option) => option.target === "image" && option.config.id > 0)
      ?? workflowRouteOptions[0];
    },
    [modulePreferences, workflowRouteOptions],
  );

  const [selectedRouteKey, setSelectedRouteKey] = useState("");
  const selectedRouteOption = useMemo(
    () => workflowRouteOptions.find((option) => option.key === selectedRouteKey) ?? defaultRouteOption,
    [defaultRouteOption, selectedRouteKey, workflowRouteOptions],
  );
  const selectedConfig = selectedRouteOption?.config;

  const [routingMode, setRoutingMode] = useState<RoutingMode>("direct_api");
  const [compatibilityMode, setCompatibilityMode] = useState<CompatibilityMode>("native");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyName, setApiKeyName] = useState("OPENAI_RELAY_API_KEY");
  const [modelId, setModelId] = useState("gpt-image-2");
  const [timeoutSec, setTimeoutSec] = useState(240);
  const [endpointPath, setEndpointPath] = useState("/images/generations");
  const [selectedModules, setSelectedModules] = useState<ModuleName[]>(WORKFLOW_MODULES.map((module) => module.value));
  const [selectedExtractionSlots, setSelectedExtractionSlots] = useState<WorkflowModelSlotKey[]>(EXTRACTION_WORKFLOW_SLOTS.map((slot) => slot.value));
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    void loadProviderConfigs();
  }, [loadProviderConfigs]);

  useEffect(() => {
    if (!defaultRouteOption || selectedRouteKey) return;
    setSelectedRouteKey(defaultRouteOption.key);
  }, [defaultRouteOption, selectedRouteKey]);

  useEffect(() => {
    if (!selectedRouteOption) return;
    const nextCompatibility = selectedRouteOption.compatibilityMode;
    const nextRouting = selectedRouteOption.routingMode;
    setRoutingMode(nextRouting);
    setCompatibilityMode(nextCompatibility);
    setBaseUrl(selectedRouteOption.baseUrl || "");
    setModelId(selectedRouteOption.modelId);
    setEndpointPath(selectedRouteOption.endpointPath || endpointPathFor(selectedRouteOption.modelId, selectedRouteOption.config));
    setApiKey("");
    setApiKeyName(selectedRouteOption.apiKeyName);
    setTimeoutSec(Math.max(selectedRouteOption.config.timeout_sec || 0, selectedRouteOption.capability === "image" ? 900 : 120));
    setSaveMessage("");
  }, [selectedRouteOption?.key]);

  const providerId = selectedRouteOption?.providerId ?? providerIdOf(selectedConfig);
  const capability = selectedRouteOption?.capability ?? capabilityOf(selectedConfig);
  const supportedModelIds = new Set(RUNNABLE_IMAGE_MODEL_IDS);
  const isImageConfig = selectedRouteOption?.target === "image"
    || Boolean(selectedConfig && imageWorkflowConfigs.some((config) => config.id === selectedConfig.id));
  const isExtractionConfig = selectedRouteOption?.target === "extraction"
    || Boolean(selectedConfig && extractionWorkflowConfigs.some((config) => config.id === selectedConfig.id));
  const canApplyToModules = Boolean(selectedConfig && selectedRouteOption?.target === "image" && isImageConfig && supportedModelIds.has(modelId.trim()));
  const endpointUrls = endpointUrlsFor({ routingMode, compatibilityMode, baseUrl, endpointPath, modelId: modelId.trim(), providerId, locale });

  const moduleRows = WORKFLOW_MODULES.map((module) => {
    const preference = modulePreferences.find((item) => item.module_name === module.value);
    const currentModel = preference?.priority_order_json[0];
    const currentConfig = providerConfigs.find((config) => config.id === preference?.default_provider_config_id)
      ?? providerConfigs.find((config) => currentModel && modelIdOf(config) === currentModel);
    return {
      ...module,
      selected: selectedModules.includes(module.value),
      currentModel: currentConfig ? workflowRuntimeLabel(currentConfig, currentModel, locale) : (currentModel ?? text("未设置", "Not set")),
    };
  });
  const extractionRows = EXTRACTION_WORKFLOW_SLOTS.map((slot) => ({
    ...slot,
    selected: selectedExtractionSlots.includes(slot.value),
    currentModel: workflowModelOverrides[slot.value]?.providerConfigId
      ? workflowRuntimeLabel(providerConfigs.find((config) => config.id === workflowModelOverrides[slot.value]?.providerConfigId), workflowModelOverrides[slot.value]?.model, locale)
      : (workflowModelOverrides[slot.value]?.model ?? text("未单独设置", "No override")),
  }));
  const isExtractionEditableRelayChannel = Boolean(selectedConfig && isConfiguredOpenAICompatibleRelay(selectedConfig));
  const extractionModelId = isUsableVisionModelId(modelId.trim())
    ? modelId.trim()
    : (selectedConfig ? defaultVisionModelForConfig(selectedConfig) : "");
  const canApplyToExtractionSlots = Boolean(
    selectedConfig
      && isExtractionConfig
      && (
        isUsableVisionModelId(modelId.trim())
        || isUsableVisionModelId(extractionModelId)
      ),
  );
  const displayedTestResult =
    selectedTestResult &&
    selectedTestResult.provider_id === providerId &&
    (
      selectedTestResult.model_id === modelId
      || selectedTestResult.model_id_used === modelId
      || selectedTestResult.model_id === extractionModelId
      || selectedTestResult.model_id_used === extractionModelId
    )
      ? selectedTestResult
      : undefined;

  const saveProviderRuntimeConfig = async ({
    preserveModelName = false,
    visionModelId,
  }: {
    preserveModelName?: boolean;
    visionModelId?: string;
  } = {}): Promise<ModelConfig | undefined> => {
    if (!selectedConfig) return undefined;
    if (routingMode === "relay_base_url" && !baseUrl.trim()) {
      setSaveMessage(text("中转 Base URL 不能为空。请填写完整的 HTTPS 地址后再保存。", "Relay Base URL is required. Enter a complete HTTPS URL before saving."));
      return undefined;
    }
    if (!canApplyToModules && !canApplyToExtractionSlots) {
      setSaveMessage(text("当前模型不能应用到出图或提取入口。出图支持 gpt-image-2 和 Google Gemini 图片模型；提取需要视觉/多模态文本模型。", "This model cannot be used for generation or extraction. Generation supports gpt-image-2 and Google Gemini image models; extraction requires a vision/multimodal model."));
      return undefined;
    }
    setSaveMessage("");
    const configModelId = preserveModelName ? modelIdOf(selectedConfig) : (modelId.trim() || selectedConfig.model_name);
    const shouldUpdateSelectedConfig = selectedConfig.id > 0
      && modelIdOf(selectedConfig) === configModelId
      && selectedConfig.routing_mode === routingMode
      && compatibilityOf(selectedConfig) === compatibilityMode
      && providerIdOf(selectedConfig) === providerId;
    const configPayload = {
      ...selectedConfig,
      id: shouldUpdateSelectedConfig ? selectedConfig.id : undefined,
      model_name: configModelId,
      model_id: configModelId,
      display_name: titleOf(selectedConfig),
      routing_mode: routingMode,
      compatibility_mode: compatibilityMode,
      base_url: baseUrl.trim(),
      api_key: apiKey || undefined,
      timeout_sec: timeoutSec,
      api_key_name: apiKeyName,
      extra_config_json: {
        ...(selectedConfig.extra_config_json ?? {}),
        provider_id: providerId,
        provider_label: selectedConfig.provider_label ?? selectedConfig.provider_name,
        model_id: configModelId,
        model_label: titleOf(selectedConfig),
        display_name: titleOf(selectedConfig),
        compatibility_mode: compatibilityMode,
        capability,
        api_key_name: apiKeyName,
        ...(visionModelId ? { vision_model_id: visionModelId } : {}),
        default_endpoint_path: endpointPath,
        relay_supported: routingMode === "relay_base_url" || selectedConfig.relay_supported,
      },
    } as ModelConfig;
    const saved = await saveProviderConfig(configPayload);
    if (saved) {
      if (routingMode === "relay_base_url" && !saved.base_url?.trim()) {
        setSaveMessage(text("保存失败：后端没有持久化中转 Base URL。", "Save failed: the backend did not persist the relay Base URL."));
        return undefined;
      }
      if (apiKey.trim() && !saved.has_api_key) {
        setSaveMessage(text("保存失败：后端没有确认 API Key 已进入安全存储。", "Save failed: the backend did not confirm secure API key storage."));
        return undefined;
      }
      setSelectedRouteKey(routeKey(providerId, modelIdOf(saved), saved.routing_mode, compatibilityOf(saved), canApplyToModules ? "image" : "extraction"));
      setSaveMessage(text("已保存。", "Saved."));
    }
    return saved;
  };

  const saveCurrentConfig = async (): Promise<ModelConfig | undefined> =>
    saveProviderRuntimeConfig({
      preserveModelName: isExtractionEditableRelayChannel && !canApplyToModules && canApplyToExtractionSlots,
      visionModelId: canApplyToExtractionSlots ? extractionModelId : undefined,
    });

  const saveAndApplyCurrentConfig = async () => {
    const saved = await saveCurrentConfig();
    if (!saved) return;
    const appliedTargets: string[] = [];
    if (canApplyToModules && selectedModules.length > 0) {
      const configId = saved.id;
      const priority = modelId === "gpt-image-2" ? IMAGE_MODEL_PRIORITY : [modelId, ...IMAGE_MODEL_PRIORITY.filter((item) => item !== modelId)];
      const providerName = saved.provider_name ?? selectedConfig?.provider_name ?? "";
      selectedModules.forEach((moduleName) => setModuleSelection(moduleName, providerName, modelId, configId));
      await Promise.all(selectedModules.map((moduleName) => updateModulePriority(moduleName, priority, configId)));
      appliedTargets.push(`${selectedModules.length} ${text("个出图工作流", "generation workflows")}`);
    }
    if (canApplyToExtractionSlots && selectedExtractionSlots.length > 0) {
      selectedExtractionSlots.forEach((slotKey) => {
        setWorkflowModelOverride(slotKey, {
          provider: saved.provider_name,
          model: extractionModelId,
          providerConfigId: saved.id,
        });
      });
      await Promise.all(selectedExtractionSlots.map((slotKey) => {
        const moduleName = EXTRACTION_MODULE_BY_SLOT[slotKey as keyof typeof EXTRACTION_MODULE_BY_SLOT];
        return updateModulePriority(moduleName, [extractionModelId], saved.id);
      }));
      appliedTargets.push(`${selectedExtractionSlots.length} ${text("个提取入口", "extraction routes")}`);
    }
    setSaveMessage(appliedTargets.length > 0 ? `${text("已保存并应用到", "Saved and applied to")} ${appliedTargets.join(locale === "zh-CN" ? "、" : ", ")}。` : text("已保存配置，但没有勾选应用目标。", "Configuration saved, but no target was selected."));
  };

  const clearCurrentApiKey = async () => {
    if (!selectedConfig || selectedConfig.id <= 0) return;
    setSaveMessage("");
    const saved = await clearProviderApiKey(selectedConfig.id);
    if (saved) {
      setApiKey("");
      setSaveMessage(text("已清除保存的 API Key。", "Saved API key cleared."));
    }
  };

  const testCurrentConfig = async () => {
    if (!selectedConfig || (!canApplyToModules && !canApplyToExtractionSlots)) return;
    const testModelId = canApplyToExtractionSlots && !canApplyToModules ? extractionModelId : (modelId.trim() || selectedConfig.model_name);
    const testCapability = canApplyToExtractionSlots && !canApplyToModules ? "vision" : capability;
    const testEndpointPath = canApplyToExtractionSlots && !canApplyToModules ? "/chat/completions" : endpointPath;
    setSaveMessage("");
    await testModelConnection({
      provider_config_id: selectedConfig.id > 0 ? selectedConfig.id : undefined,
      provider_id: providerId,
      provider_label: selectedConfig.provider_label ?? selectedConfig.provider_name,
      model_id: testModelId,
      model_label: titleOf(selectedConfig),
      display_name: titleOf(selectedConfig),
      capability: testCapability,
      routing_mode: routingMode,
      compatibility_mode: compatibilityMode,
      base_url: baseUrl.trim() || null,
      endpoint_path: testEndpointPath,
      api_key: apiKey,
      timeout_sec: timeoutSec,
      include_costly: false,
    });
  };

  const applyToModules = async () => {
    if (!selectedConfig || !canApplyToModules) return;
    const saved = await saveCurrentConfig();
    if (!saved) return;
    const configId = saved.id;
    const priority = modelId === "gpt-image-2" ? IMAGE_MODEL_PRIORITY : [modelId, ...IMAGE_MODEL_PRIORITY.filter((item) => item !== modelId)];
    const providerName = saved?.provider_name ?? selectedConfig.provider_name;
    selectedModules.forEach((moduleName) => setModuleSelection(moduleName, providerName, modelId, configId));
    await Promise.all(selectedModules.map((moduleName) => updateModulePriority(moduleName, priority, configId)));
    setSaveMessage(`${text("已应用到", "Applied to")} ${selectedModules.length} ${text("个工作流模块。", "workflow modules.")}`);
  };

  const applyToExtractionSlots = async () => {
    if (!selectedConfig || !canApplyToExtractionSlots || selectedExtractionSlots.length === 0) return;
    const saved = await saveProviderRuntimeConfig({
      preserveModelName: isExtractionEditableRelayChannel,
      visionModelId: extractionModelId,
    });
    if (!saved) return;
    const configId = saved.id;
    const providerName = saved.provider_name;
    selectedExtractionSlots.forEach((slotKey) => {
      setWorkflowModelOverride(slotKey, {
        provider: providerName,
        model: extractionModelId,
        providerConfigId: configId,
      });
    });
    await Promise.all(selectedExtractionSlots.map((slotKey) => {
      const moduleName = EXTRACTION_MODULE_BY_SLOT[slotKey as keyof typeof EXTRACTION_MODULE_BY_SLOT];
      return updateModulePriority(moduleName, [extractionModelId], configId);
    }));
    setSaveMessage(`${text("已应用到", "Applied to")} ${selectedExtractionSlots.length} ${text("个提取模型入口。", "extraction routes.")}`);
  };

  const toggleModule = (moduleName: ModuleName) => {
    setSelectedModules((current) =>
      current.includes(moduleName) ? current.filter((item) => item !== moduleName) : [...current, moduleName],
    );
  };

  const toggleExtractionSlot = (slotKey: WorkflowModelSlotKey) => {
    setSelectedExtractionSlots((current) =>
      current.includes(slotKey) ? current.filter((item) => item !== slotKey) : [...current, slotKey],
    );
  };

  return (
    <div className="page-stack min-w-0 overflow-x-hidden">
      <section className="page-hero">
        <div className="flex flex-col gap-2">
          <div className="eyebrow">{text("模型设置", "Model settings")}</div>
          <h2 className="hero-title">{text("默认模型、Base URL 和 API Key", "Default models, Base URLs, and API keys")}</h2>
          <p className="body-muted max-w-3xl">
            {text("这里设置室内真实出图和元素提取线路。出图支持 OpenAI GPT Image 2 与 Google Gemini 图片模型；提取支持 GLM 和兼容中转视觉模型。", "Configure production image generation and extraction routes. Generation supports OpenAI GPT Image 2 and Google Gemini image models; extraction supports GLM and compatible relay vision models.")}
          </p>
        </div>
      </section>

      {isLoadingConfigs ? <div className="panel-muted p-3 text-sm font-medium text-studio-mutedText">{text("正在加载模型配置...", "Loading model configurations...")}</div> : null}

      <section className="panel-surface p-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("模型线路", "Model route")}</span>
                <select
                  value={selectedRouteOption?.key ?? ""}
                  onChange={(event) => setSelectedRouteKey(event.target.value)}
                  className="form-field w-full"
                >
                  {workflowRouteOptions.map((option, index) => (
                    <option key={option.key} value={option.key}>
                      {index === 0 || workflowRouteOptions[index - 1]?.groupLabel !== option.groupLabel ? `${option.groupLabel} / ` : ""}
                      {option.label}
                    </option>
                  ))}
                </select>
                {!workflowRouteOptions.length ? (
                  <div className="mt-2 text-xs font-semibold text-rose-800">{text("没有可用于出图或元素提取的模型配置。", "No model configuration is available for generation or extraction.")}</div>
                ) : null}
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("模型 ID", "Model ID")}</span>
                <input value={modelId} onChange={(event) => setModelId(event.target.value)} className="form-field w-full" />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("API 模式", "API mode")}</span>
                <input value={routingMode === "relay_base_url" ? text("中转 Base URL", "Relay Base URL") : text("原生 API", "Native API")} readOnly className="form-field w-full bg-slate-50" />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("兼容模式", "Compatibility mode")}</span>
                <input value={localeLabel(compatibilityMode, locale)} readOnly className="form-field w-full bg-slate-50" />
              </label>
              <label className="block lg:col-span-2">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">Base URL</span>
                <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://relay.your-company.cn/v1" className="form-field w-full" />
              </label>
              <label className="block lg:col-span-2">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("接口路径", "Endpoint path")}</span>
                <input value={endpointPath} onChange={(event) => setEndpointPath(event.target.value)} placeholder={text("/images/generations 或 /responses", "/images/generations or /responses")} className="form-field w-full" />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">API Key</span>
                <input
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  type="password"
                  placeholder={selectedConfig?.has_api_key ? text("已保存，留空不会覆盖", "Saved; leave empty to keep it") : text("粘贴 API Key 后保存", "Paste an API key, then save")}
                  className="form-field w-full"
                />
                <div className="mt-2 text-xs font-semibold text-studio-mutedText">
                  {selectedConfig?.has_api_key
                    ? text("密钥已保存并会继续用于生成；出于安全不会回显原文。输入新 Key 并保存才会替换。", "The key is stored securely and will continue to be used. Enter and save a new key only to replace it.")
                    : text("还没有保存密钥。", "No API key is saved.")}
                </div>
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("超时时间", "Timeout (seconds)")}</span>
                <input type="number" min={5} max={1800} value={timeoutSec} onChange={(event) => setTimeoutSec(Number(event.target.value))} className="form-field w-full" />
              </label>
              <label className="block lg:col-span-2">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{text("密钥引用", "Key reference")}</span>
                <input value={apiKeyName} onChange={(event) => setApiKeyName(event.target.value)} className="form-field w-full" />
              </label>
            </div>

            <div className="rounded-lg border border-studio-border bg-studio-panelBg p-3 text-sm text-studio-mutedText">
              <div>
                {text("非付费测试线路：", "Non-billable test route: ")}<span className="break-all font-semibold text-studio-navy">{routeAddressStatusForState(selectedConfig, routingMode, baseUrl, locale)}</span>
              </div>
              <div className="mt-1">
                {canApplyToExtractionSlots && !canApplyToModules ? text("提取调用线路", "Extraction route") : text("真实出图线路", "Generation route")}:
                <span className="break-all font-semibold text-studio-navy">{routeAddressStatusForState(selectedConfig, routingMode, baseUrl, locale)}</span>
              </div>
              {canApplyToExtractionSlots ? (
                <div className="mt-1 text-xs font-semibold text-emerald-800">
                  {text(`当前线路可用于元素提取；实际提取模型 ID：${extractionModelId}。出图模型和提取模型会分开保存。`, `This route supports extraction. Extraction model ID: ${extractionModelId}. Generation and extraction models are stored separately.`)}
                </div>
              ) : null}
              <div className="mt-1 text-xs font-medium text-studio-mutedText">{endpointUrls.note}</div>
              {routingMode === "relay_base_url" && compatibilityMode === "openai_compatible" && modelId.trim().startsWith("gpt-image") ? (
                <div className="mt-1 text-xs font-medium text-studio-mutedText">{text(`OpenAI 图片中转会先测中转的 /models/${modelId.trim()}；不支持模型查询时只报告中转可达，不会改发官方 OpenAI。`, `The OpenAI image relay probes /models/${modelId.trim()} on the relay. If model lookup is unavailable, it reports relay reachability and never silently calls official OpenAI.`)}</div>
              ) : null}
              {routingMode === "relay_base_url" && compatibilityMode === "gemini_compatible" && modelId.includes("image") ? (
                <div className="mt-1 text-xs font-medium text-studio-mutedText">{text(`Gemini 图片中转会测中转的 /models/${modelId.trim()}；真实出图使用同一 Base URL 下的 generateContent。`, `The Gemini relay probes /models/${modelId.trim()}; generation uses generateContent under the same Base URL.`)}</div>
              ) : null}
              {capability.includes("image") ? (
                <div className="mt-1 text-xs font-medium text-amber-800">
                  {text("默认测试只做安全连通性验证，不执行真实出图；需要真实生成时必须通过任务队列发起。", "The default test checks connectivity without generating a billable image. Use a workflow task for real generation.")}
                </div>
              ) : null}
              {!canApplyToModules ? (
                <div className="mt-1 text-xs font-semibold text-rose-800">
                  {canApplyToExtractionSlots
                    ? text("这是元素提取专用线路，请使用“应用到提取模型”；它不会覆盖独立的出图线路。", "This is an extraction-only route. Use Apply to extraction; it does not overwrite the independent generation route.")
                    : text("当前模型不能应用到出图工作流。出图支持 gpt-image-2 和 Google Gemini 图片模型。", "This model cannot be used for image workflows. Use gpt-image-2 or a supported Google Gemini image model.")}
                </div>
              ) : null}
              {!canApplyToExtractionSlots ? (
                <div className="mt-1 text-xs font-semibold text-studio-mutedText">
                  {text("当前模型不能应用到元素提取；提取需要 GLM、Gemini、OpenAI 视觉模型或已配置的 OpenAI 兼容中转视觉模型。", "This model cannot extract items. Use GLM, Gemini, an OpenAI vision model, or a configured OpenAI-compatible relay vision model.")}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void testCurrentConfig()} disabled={isTestingConnection || (!canApplyToModules && !canApplyToExtractionSlots) || (routingMode === "relay_base_url" && !baseUrl.trim())} className="btn-primary">
                {isTestingConnection ? `${text("测试中", "Testing")} ${timeoutSec}s...` : text("测试连接", "Test connection")}
              </button>
              <button type="button" onClick={() => void saveAndApplyCurrentConfig()} disabled={isSavingConfig || !selectedConfig || (!canApplyToModules && !canApplyToExtractionSlots) || (routingMode === "relay_base_url" && !baseUrl.trim())} className="btn-secondary">
                {isSavingConfig ? text("保存中...", "Saving...") : text("保存并应用", "Save and apply")}
              </button>
              <button type="button" onClick={() => void clearCurrentApiKey()} disabled={isSavingConfig || !selectedConfig?.has_api_key} className="btn-secondary">
                {text("清除已保存 Key", "Clear saved key")}
              </button>
              <button type="button" onClick={() => void applyToModules()} disabled={isSavingConfig || !selectedConfig || !canApplyToModules || selectedModules.length === 0 || (routingMode === "relay_base_url" && !baseUrl.trim())} className="btn-secondary">
                {text("应用到出图工作流", "Apply to generation")}
              </button>
              <button type="button" onClick={() => void applyToExtractionSlots()} disabled={isSavingConfig || !selectedConfig || !canApplyToExtractionSlots || selectedExtractionSlots.length === 0 || (routingMode === "relay_base_url" && !baseUrl.trim())} className="btn-secondary">
                {text("应用到提取模型", "Apply to extraction")}
              </button>
            </div>

            {saveMessage ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">{saveMessage}</div> : null}
            {modelError ? <div className="soft-alert">{message(modelError)}</div> : null}
          </div>

          <aside className="rounded-lg border border-studio-border bg-studio-panelBg p-4">
            <div className="eyebrow">{text("应用到", "Apply to")}</div>
            <div className="mt-2 text-xs font-semibold text-studio-mutedText">{text("出图工作流", "Generation workflows")}</div>
            <div className="mt-3 space-y-2">
              {moduleRows.map((row) => (
                <label key={row.value} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-studio-border bg-white px-3 py-2">
                  <div>
                    <div className="text-sm font-semibold text-studio-navy">{localeLabel(row.label, locale)}</div>
                    <div className="text-xs text-studio-mutedText">{row.currentModel}</div>
                  </div>
                  <input type="checkbox" checked={row.selected} onChange={() => toggleModule(row.value)} className="h-4 w-4 accent-studio-primary" />
                </label>
              ))}
            </div>
            <div className="mt-5 text-xs font-semibold text-studio-mutedText">{text("元素提取", "Item extraction")}</div>
            <div className="mt-3 space-y-2">
              {extractionRows.map((row) => (
                <label key={row.value} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-studio-border bg-white px-3 py-2">
                  <div>
                    <div className="text-sm font-semibold text-studio-navy">{localeLabel(row.label, locale)}</div>
                    <div className="text-xs text-studio-mutedText">{row.currentModel}</div>
                  </div>
                  <input type="checkbox" checked={row.selected} onChange={() => toggleExtractionSlot(row.value)} className="h-4 w-4 accent-studio-primary" />
                </label>
              ))}
            </div>
            <div className="mt-3 rounded-lg border border-studio-border bg-white p-3 text-xs font-medium text-studio-mutedText">
              {text("提取模型只用于“提取元素”。GLM / Gemini / OpenAI 原生线路会使用各自默认模型；OpenAI 兼容中转可以填写实际视觉/多模态模型 ID，系统不会把提取模型覆盖到出图模型。", "Extraction models are used only for item extraction. Native GLM, Gemini, and OpenAI routes use their own defaults; an OpenAI-compatible relay may use its actual vision model ID. Extraction never overwrites the generation model.")}
            </div>
          </aside>
        </div>
      </section>

      {displayedTestResult ? (
        <section className="panel-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="eyebrow">{text("连接测试", "Connection test")}</div>
              <h3 className="section-title mt-1">{testResultTitle(displayedTestResult, locale)}</h3>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              isSkippedCostResult(displayedTestResult)
                ? statusToneByRelease("SKIPPED_COST")
                : statusTone(displayedTestResult.ok, displayedTestResult.error_type)
            }`}>
              {testResultBadge(displayedTestResult, locale)}
            </span>
          </div>
          <div className="mt-4 grid gap-2 text-sm text-studio-mutedText md:grid-cols-2">
            <div>{text("模型：", "Model: ")}<span className="font-semibold text-studio-navy">{displayedTestResult.model_id}</span></div>
            <div>{text("超时：", "Timeout: ")}<span className="font-semibold text-studio-navy">{displayedTestResult.timeout_sec ?? timeoutSec}s</span></div>
            <div className="break-all md:col-span-2">{text("测试线路：", "Test route: ")}<span className="font-semibold text-studio-navy">{routeAddressStatus(selectedConfig, locale)}</span></div>
            <div>{text("状态码：", "Status: ")}<span className="font-semibold text-studio-navy">{displayedTestResult.status_code ?? text("暂无", "N/A")}</span></div>
            <div>{text("延迟：", "Latency: ")}<span className="font-semibold text-studio-navy">{displayedTestResult.latency_ms ?? text("暂无", "N/A")} ms</span></div>
            <div>{text("请求发出：", "Request sent: ")}<span className="font-semibold text-studio-navy">{displayedTestResult.request_attempted ? text("是", "Yes") : text("否", "No")}</span></div>
            <div>{text("收到响应：", "Response received: ")}<span className="font-semibold text-studio-navy">{displayedTestResult.response_received ? text("是", "Yes") : text("否", "No")}</span></div>
            <div className="md:col-span-2">
              {text("发布状态：", "Release status: ")}
              <span className={`ml-2 rounded-full border px-2 py-1 text-xs font-semibold ${statusToneByRelease(displayedTestResult.release_status)}`}>
                {releaseLabel(displayedTestResult.release_status, locale)}
              </span>
            </div>
            {displayedTestResult.normalized_output ? <div className="md:col-span-2">{text("结果：", "Result: ")}<span className="font-semibold text-studio-navy">{displayedTestResult.normalized_output}</span></div> : null}
            {displayedTestResult.error ? (
              <div className={`${isSkippedCostResult(displayedTestResult) || requiresLiveGenerationVerification(displayedTestResult) ? "text-amber-800" : "text-rose-800"} md:col-span-2`}>
                {isSkippedCostResult(displayedTestResult) || requiresLiveGenerationVerification(displayedTestResult) ? text("说明", "Note") : text("错误", "Error")}: {displayedTestResult.error}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
