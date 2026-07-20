import type { AssetRecord, ModulePreference, ProviderConfig, TaskRecord } from "./types";

const runnableGeminiImageModelIds = new Set([
  "gemini-2.5-flash-image",
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image-preview",
]);

export function resolveRunnableModel(providers: ProviderConfig[], preferences: ModulePreference[], moduleName: string) {
  const preferenceName = moduleName === "single_room_board" || moduleName === "multi_room_board" || moduleName === "custom_tasks"
    ? "boards"
    : moduleName;
  const preference = preferences.find((item) => item.module_name === preferenceName);
  const candidates = providers
    .filter((provider) => provider.is_enabled && !provider.hidden && !provider.deprecated)
    .filter(hasStoredCredential)
    .filter(isRunnableImageProvider);
  const byConfigId = candidates.find((provider) => provider.id === preference?.default_provider_config_id);
  const byPriority = preference?.priority_order_json
    .map((model) => candidates.find((provider) => modelIdOf(provider) === model))
    .find(Boolean);
  const selected = byConfigId ?? byPriority ?? candidates.find((provider) => modelIdOf(provider) === "gpt-image-2") ?? candidates[0];
  return {
    provider: selected?.provider_name ?? "OpenAI",
    modelName: selected ? modelIdOf(selected) : "gpt-image-2",
    providerConfigId: selected?.id ?? null,
    isConfigured: Boolean(selected),
  };
}

export function resolveExtractionModel(
  providers: ProviderConfig[],
  preferences: ModulePreference[],
  moduleName: "single_room_board" | "multi_room_board" | "space_render",
) {
  const preferenceName = moduleName === "multi_room_board" ? "multi_room_board_extraction" : "room_board_extraction";
  const preference = preferences.find((item) => item.module_name === preferenceName);
  const candidates = providers
    .filter((provider) => provider.is_enabled && !provider.hidden && !provider.deprecated)
    .filter(hasStoredCredential)
    .filter((provider) => {
      const modelId = modelIdOf(provider).toLowerCase();
      const override = String(provider.extra_config_json?.vision_model_id ?? "").toLowerCase();
      const isGlm = modelId.startsWith("glm") || override.startsWith("glm");
      const hasRoute = provider.routing_mode !== "relay_base_url" || Boolean(provider.base_url?.trim());
      return isGlm && hasRoute;
    });
  const selected = candidates.find((provider) => provider.id === preference?.default_provider_config_id)
    ?? preference?.priority_order_json
      .map((model) => candidates.find((provider) => modelIdOf(provider) === model))
      .find(Boolean)
    ?? candidates[0];
  if (!selected) return undefined;
  return {
    provider: selected.provider_name,
    modelName: modelIdOf(selected),
    providerConfigId: selected.id,
  };
}

export function firstResultAsset(task: TaskRecord): AssetRecord | undefined {
  const assets = task.output_payload_json?.assets;
  return Array.isArray(assets) ? (assets[0] as AssetRecord | undefined) : undefined;
}

function isRunnableImageProvider(provider: ProviderConfig): boolean {
  const providerId = String(provider.provider_id ?? provider.extra_config_json?.provider_id ?? "").toLowerCase();
  const compatibility = String(provider.compatibility_mode ?? provider.extra_config_json?.compatibility_mode ?? "").toLowerCase();
  const text = `${provider.provider_name} ${provider.provider_type}`.toLowerCase();
  const modelId = modelIdOf(provider).toLowerCase();
  const isOpenAIImage = (
    providerId === "openai"
    || providerId === "custom_openai"
    || providerId === "openai_compatible_custom"
    || compatibility === "openai_compatible"
    || text.includes("openai")
  ) && modelId === "gpt-image-2";
  const isGeminiImage = (
    providerId === "google_gemini"
    || compatibility === "gemini_compatible"
    || text.includes("gemini")
  ) && runnableGeminiImageModelIds.has(modelId);
  if (!isOpenAIImage && !isGeminiImage) return false;
  if (provider.routing_mode === "relay_base_url" && !provider.base_url?.trim()) return false;
  return true;
}

function modelIdOf(provider: ProviderConfig): string {
  return provider.model_id || String(provider.extra_config_json?.model_id ?? "") || provider.model_name;
}

function hasStoredCredential(provider: ProviderConfig): boolean {
  return provider.has_api_key === true;
}
