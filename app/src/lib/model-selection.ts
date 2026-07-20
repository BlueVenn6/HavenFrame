import type { ModelConfig, WorkflowModelOverride } from "../types";

const unusableImageModelIds = new Set(["studio-custom-image", "relay-text-smoke-test", "custom-rest-model"]);
const unusableVisionModelIds = new Set(["studio-custom-image", "relay-text-smoke-test", "custom-rest-model"]);
const defaultRelayVisionModelIds = ["glm-4.5v"];
const runnableGeminiImageModelIds = new Set([
  "gemini-2.5-flash-image",
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image-preview",
]);

export function findRunnableImageModelConfig(
  configs: ModelConfig[],
  selection: WorkflowModelOverride,
): ModelConfig | undefined {
  const candidates = configs
    .filter((config) => config.is_enabled && !config.hidden && !config.deprecated)
    .filter(isRunnableImageProviderConfig);

  return candidates.find((config) => config.id === selection.providerConfigId)
    ?? candidates.find((config) => config.provider_name === selection.provider && modelIdOf(config) === selection.model && isPreferredConfiguredRelayConfig(config))
    ?? candidates.find((config) => config.provider_name === selection.provider && modelIdOf(config) === selection.model)
    ?? candidates.find((config) => modelIdOf(config) === "gpt-image-2" && isPreferredConfiguredRelayConfig(config))
    ?? candidates.find((config) => modelIdOf(config) === "gpt-image-2")
    ?? candidates.find((config) => config.provider_name === selection.provider)
    ?? candidates[0];
}

export function resolveRunnableImageSelection(
  configs: ModelConfig[],
  selection: WorkflowModelOverride,
): WorkflowModelOverride {
  const selectedConfig = findRunnableImageModelConfig(configs, selection);
  if (!selectedConfig) {
    return selection;
  }
  return {
    provider: selectedConfig.provider_name,
    model: modelIdOf(selectedConfig),
    providerConfigId: selectedConfig.id,
  };
}

export function findRunnableVisionModelConfig(
  configs: ModelConfig[],
  selection: WorkflowModelOverride,
): ModelConfig | undefined {
  const candidates = configs
    .filter((config) => config.is_enabled && !config.hidden && !config.deprecated)
    .filter(isRunnableVisionProviderConfig);

  return candidates.find((config) => config.id === selection.providerConfigId && visionModelForSelection(config, selection))
    ?? candidates.find((config) => config.provider_name === selection.provider && modelIdOf(config) === selection.model && visionModelForSelection(config, selection))
    ?? candidates.find((config) => config.provider_name === selection.provider && visionModelForSelection(config, selection))
    ?? candidates.find(isOfficialGlmVisionConfig)
    ?? candidates.find(isPreferredConfiguredRelayConfig)
    ?? candidates.find((config) => visionModelForSelection(config, { provider: config.provider_name, model: modelIdOf(config), providerConfigId: config.id }));
}

export function resolveRunnableVisionSelection(
  configs: ModelConfig[],
  selection: WorkflowModelOverride,
): WorkflowModelOverride {
  const selectedConfig = findRunnableVisionModelConfig(configs, selection);
  if (!selectedConfig) {
    return selection;
  }
  const model = visionModelForSelection(selectedConfig, selection);
  return {
    provider: selectedConfig.provider_name,
    model: model || defaultVisionModelForConfig(selectedConfig),
    providerConfigId: selectedConfig.id,
  };
}

export function isRunnableVisionProviderConfig(config: ModelConfig): boolean {
  if (!isPotentialVisionProviderConfig(config)) {
    return false;
  }
  if (!hasConfiguredApiKey(config)) {
    return false;
  }
  if (config.routing_mode === "relay_base_url" && !config.base_url?.trim()) {
    return false;
  }
  return true;
}

export function isPotentialVisionProviderConfig(config: ModelConfig): boolean {
  const modelId = modelIdOf(config);
  if (unusableVisionModelIds.has(modelId)) {
    return false;
  }
  // A generation route must never double as an extraction route merely
  // because an older database attached a vision_model_id to it.
  if (isImageOnlyModelId(modelId)) {
    return false;
  }
  if (isOfficialGlmVisionConfig(config)) return true;
  return isConfiguredOpenAICompatibleRelay(config) && isGlmModelId(modelId);
}

export function isRunnableImageProviderConfig(config: ModelConfig): boolean {
  if (!isSupportedInteriorImageModelConfig(config)) {
    return false;
  }
  if (!hasConfiguredApiKey(config)) {
    return false;
  }
  if (config.routing_mode === "relay_base_url" && !config.base_url?.trim()) {
    return false;
  }
  return true;
}

export function isImageOnlyModelId(modelId: string): boolean {
  return modelId.startsWith("gpt-image")
    || modelId.includes("flash-image")
    || modelId.includes("image-preview")
    || modelId.includes("seedream");
}

export function isUsableVisionModelId(modelId: string): boolean {
  const normalized = modelId.trim();
  return Boolean(normalized) && !isImageOnlyModelId(normalized) && !unusableVisionModelIds.has(normalized);
}

export function isSupportedInteriorImageModelConfig(config: ModelConfig): boolean {
  const modelId = modelIdOf(config);
  if (unusableImageModelIds.has(modelId)) {
    return false;
  }
  const providerId = (config.provider_id ?? config.extra_config_json?.provider_id ?? "").toLowerCase();
  const compatibilityMode = (config.compatibility_mode ?? config.extra_config_json?.compatibility_mode ?? "").toLowerCase();
  const providerText = `${config.provider_name} ${config.provider_type}`.toLowerCase();
  const isOpenAiImageAdapter = (
    providerId === "openai"
    || providerId === "custom_openai"
    || providerId === "openai_compatible_custom"
    || compatibilityMode === "openai_compatible"
    || providerText.includes("openai")
  ) && modelId === "gpt-image-2";
  const isGeminiImageAdapter = (
    providerId === "google_gemini"
    || compatibilityMode === "gemini_compatible"
    || providerText.includes("gemini")
  ) && runnableGeminiImageModelIds.has(modelId);
  if (!isOpenAiImageAdapter && !isGeminiImageAdapter) {
    return false;
  }
  return true;
}

export function modelIdOf(config: ModelConfig): string {
  return config.model_id ?? config.extra_config_json?.model_id ?? config.model_name;
}

export function visionModelForSelection(config: ModelConfig, selection: WorkflowModelOverride): string {
  const customModel = selection.model.trim();
  const configModel = modelIdOf(config);
  if (customModel === configModel) {
    return isGlmModelId(configModel) ? configModel : "";
  }
  if (
    isGlmModelId(customModel)
    && (
      config.routing_mode === "relay_base_url"
      || (config.provider_id ?? config.extra_config_json?.provider_id ?? "").toLowerCase().includes("custom")
    )
  ) {
    return customModel;
  }
  return isGlmModelId(configModel) ? configModel : "";
}

export function defaultVisionModelForConfig(config: ModelConfig): string {
  const configModel = modelIdOf(config);
  if (isGlmModelId(configModel) && !isConfiguredOpenAICompatibleRelay(config)) {
    return configModel;
  }
  if (isConfiguredOpenAICompatibleRelay(config)) {
    const existingModel = (config.extra_config_json?.vision_model_id ?? "").trim();
    if (isGlmModelId(existingModel)) {
      return existingModel;
    }
    return defaultRelayVisionModelIds[0];
  }
  return "";
}

function isGlmModelId(modelId: string): boolean {
  return modelId.trim().toLowerCase().startsWith("glm");
}

export function isConfiguredOpenAICompatibleRelay(config: ModelConfig): boolean {
  const providerId = (config.provider_id ?? config.extra_config_json?.provider_id ?? "").toLowerCase();
  const compatibilityMode = (config.compatibility_mode ?? config.extra_config_json?.compatibility_mode ?? "").toLowerCase();
  return Boolean(config.base_url?.trim())
    && config.routing_mode === "relay_base_url"
    && (
      compatibilityMode === "openai_compatible"
      || providerId === "openai"
      || providerId === "custom_openai"
      || providerId === "openai_compatible_custom"
      || config.provider_name.toLowerCase().includes("openai")
    );
}

function isOfficialGlmVisionConfig(config: ModelConfig): boolean {
  return ["zhipu_glm", "zai_glm"].includes(providerIdOf(config))
    && config.routing_mode === "direct_api"
    && modelIdOf(config).toLowerCase().startsWith("glm")
    && isUsableVisionModelId(modelIdOf(config));
}

function isPreferredConfiguredRelayConfig(config: ModelConfig): boolean {
  return isConfiguredOpenAICompatibleRelay(config) && Boolean(config.has_api_key || config.api_key || config.api_key_name);
}

function providerIdOf(config: ModelConfig): string {
  return (config.provider_id ?? config.extra_config_json?.provider_id ?? "").toLowerCase();
}

function hasConfiguredApiKey(config: ModelConfig): boolean {
  return Boolean(config.has_api_key || config.api_key);
}
