import * as SecureStore from "expo-secure-store";

import { isGlmExtractionProvider, mobileExtractionRoutePresets, mobileImageRoutePresets } from "./constants";
import { isReachableUnverified, isVerifiedConnectivity } from "./connectivity";
import { normalizeProviderNetworkError } from "./provider-errors";
import type { MobileModelRouteDraft, ModelConnectivityResult, ProviderConfig } from "./types";

const ROUTES_STORAGE_KEY = "qigou.mobile.byok-model-routes.v2";
const ACTIVE_ROUTES_STORAGE_KEY = "qigou.mobile.active-model-routes.v1";

type RoutePreset = (typeof mobileImageRoutePresets)[number] | (typeof mobileExtractionRoutePresets)[number];

interface StoredRoute {
  key: string;
  baseUrl: string;
  apiKey: string;
  savedAt: string;
  lastTest?: ModelConnectivityResult;
}

const presets: readonly RoutePreset[] = [...mobileImageRoutePresets, ...mobileExtractionRoutePresets];

export async function loadLocalModelRoutes(): Promise<ProviderConfig[]> {
  const stored = await readStoredRoutes();
  const active = await readActiveRoutes();
  return presets.flatMap((preset, index) => {
    const route = stored[preset.key];
    if (!route) return [];
    const target = isGlmExtractionProvider(preset.provider_id) ? "extraction" : "image";
    return [providerConfigFromRoute(preset, route, index + 1, active[target] === preset.key)];
  });
}

export async function saveLocalModelRoute(payload: MobileModelRouteDraft): Promise<ProviderConfig> {
  const preset = findPreset(payload);
  if (!preset) throw new Error("当前模型线路不在移动端支持列表中。");
  const baseUrl = normalizeBaseUrl(payload.base_url || preset.base_url || "");
  if (!baseUrl) throw new Error("Base URL 不能为空。");
  if (!/^https:\/\//i.test(baseUrl)) throw new Error("手机正式版只允许 HTTPS Provider 地址。");

  const routes = await readStoredRoutes();
  const current = routes[preset.key];
  const apiKey = payload.api_key?.trim() || current?.apiKey || "";
  if (!apiKey) throw new Error("请填写 API Key 后保存。");
  const saved: StoredRoute = {
    key: preset.key,
    baseUrl,
    apiKey,
    savedAt: new Date().toISOString(),
    lastTest: current?.lastTest,
  };
  routes[preset.key] = saved;
  await writeStoredRoutes(routes);
  const active = await readActiveRoutes();
  active[isGlmExtractionProvider(preset.provider_id) ? "extraction" : "image"] = preset.key;
  await SecureStore.setItemAsync(ACTIVE_ROUTES_STORAGE_KEY, JSON.stringify(active));
  return providerConfigFromRoute(preset, saved, presets.indexOf(preset) + 1, true);
}

export async function testLocalModelRoute(payload: {
  providerId: string;
  modelId: string;
  routingMode: "direct_api" | "relay_base_url";
  compatibilityMode: string;
  baseUrl?: string | null;
  apiKey?: string;
  capability?: string;
}): Promise<ModelConnectivityResult> {
  const preset = presets.find((item) => (
    item.provider_id === payload.providerId
    && item.model_name === payload.modelId
    && item.routing_mode === payload.routingMode
  ));
  if (!preset) throw new Error("当前模型线路不在移动端支持列表中。");
  const routes = await readStoredRoutes();
  const stored = routes[preset.key];
  const baseUrl = normalizeBaseUrl(payload.baseUrl || stored?.baseUrl || preset.base_url || "");
  const apiKey = payload.apiKey?.trim() || stored?.apiKey || "";
  if (!baseUrl || !apiKey) throw new Error("请先保存 Base URL 和 API Key。");

  const started = Date.now();
  const result = await runConnectivityRequest(preset, baseUrl, apiKey, started);
  if (stored) {
    routes[preset.key] = { ...stored, lastTest: result };
    await writeStoredRoutes(routes);
  }
  return result;
}

export async function clearLocalModelRoute(key: string): Promise<void> {
  const routes = await readStoredRoutes();
  delete routes[key];
  await writeStoredRoutes(routes);
}

export async function getLocalModelRuntime(configId: number): Promise<{ config: ProviderConfig; apiKey: string }> {
  const routes = await readStoredRoutes();
  const preset = presets[configId - 1];
  if (!preset) throw new Error("当前任务引用的手机模型线路不存在。");
  const stored = routes[preset.key];
  if (!stored?.apiKey) throw new Error("当前任务引用的 API Key 尚未保存。");
  return {
    config: providerConfigFromRoute(preset, stored, configId),
    apiKey: stored.apiKey,
  };
}

async function runConnectivityRequest(
  preset: RoutePreset,
  baseUrl: string,
  apiKey: string,
  started: number,
): Promise<ModelConnectivityResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const isGlm = isGlmExtractionProvider(preset.provider_id);
    const isGemini = preset.provider_id === "google_gemini";
    const endpoint = isGlm
      ? `${baseUrl}/chat/completions`
      : isGemini
        ? `${baseUrl}/models/${preset.model_name}`
        : `${baseUrl}/models/${preset.model_name}`;
    const response = isGlm
      ? await fetch(endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: preset.model_name,
            messages: [{ role: "user", content: "Return OK." }],
            temperature: 0,
            max_tokens: 4,
            thinking: { type: "disabled" },
          }),
        })
      : await fetch(isGemini ? `${endpoint}?key=${encodeURIComponent(apiKey)}` : endpoint, {
          method: "GET",
          signal: controller.signal,
          headers: isGemini ? undefined : { Authorization: `Bearer ${apiKey}` },
        });
    const latency = Date.now() - started;
    const responseText = await response.text();
    const relayLookupUnsupported = preset.routing_mode === "relay_base_url" && [404, 405].includes(response.status);
    const validGlmEnvelope = !isGlm || validJsonEnvelope(responseText);
    const ok = (response.ok && validGlmEnvelope) || relayLookupUnsupported;
    const credentialsOnly = isGlm && ok;
    return {
      ok,
      provider_id: preset.provider_id,
      model_id: preset.model_name,
      display_name: preset.display_name,
      capability: isGlmExtractionProvider(preset.provider_id) ? "vision" : "image",
      routing_mode: preset.routing_mode,
      compatibility_mode: preset.compatibility_mode,
      base_url_used: baseUrl,
      endpoint_used: endpoint,
      status_code: response.status,
      latency_ms: latency,
      error_type: ok ? null : response.ok && !validGlmEnvelope ? "invalid_response" : errorTypeForStatus(response.status),
      error: ok
        ? relayLookupUnsupported
          ? "中转可访问，但未提供模型查询接口；真实生图需在工作流中验证。"
          : credentialsOnly
            ? "端点和凭据已通过文本检测；多模态图片提取尚未验证。"
            : null
        : safeProviderError(responseText, response.status),
      release_status: relayLookupUnsupported ? "REACHABLE_UNVERIFIED" : credentialsOnly ? "CREDENTIALS_CONNECTED" : ok ? "CONNECTED" : "FAILED",
      live_tested: !relayLookupUnsupported && !credentialsOnly,
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      provider_id: preset.provider_id,
      model_id: preset.model_name,
      display_name: preset.display_name,
      capability: isGlmExtractionProvider(preset.provider_id) ? "vision" : "image",
      routing_mode: preset.routing_mode,
      compatibility_mode: preset.compatibility_mode,
      base_url_used: baseUrl,
      latency_ms: Date.now() - started,
      error_type: timedOut ? "timeout" : "network_error",
      error: timedOut ? "连接测试等待 90 秒后超时。" : normalizeProviderNetworkError(error, baseUrl).message,
      release_status: "FAILED",
      live_tested: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function providerConfigFromRoute(preset: RoutePreset, route: StoredRoute, id: number, isDefault = false): ProviderConfig {
  return {
    id,
    provider_name: preset.providerLabel,
    provider_id: preset.provider_id,
    provider_label: preset.providerLabel,
    provider_type: preset.routing_mode === "direct_api" ? "built_in_official" : "openai_compatible",
    routing_mode: preset.routing_mode,
    compatibility_mode: preset.compatibility_mode,
    base_url: route.baseUrl,
    api_key_name: preset.api_key_name,
    has_api_key: Boolean(route.apiKey),
    model_name: preset.model_name,
    model_id: preset.model_name,
    model_label: preset.display_name,
    display_name: preset.display_name,
    capability: isGlmExtractionProvider(preset.provider_id) ? "vision" : "image",
    capabilities_json: isGlmExtractionProvider(preset.provider_id) ? ["text", "vision"] : ["image"],
    default_endpoint_path: preset.endpoint,
    is_enabled: true,
    priority: preset.priority,
    last_test_status: isVerifiedConnectivity(route.lastTest)
      ? "connected"
      : isReachableUnverified(route.lastTest)
        ? "unverified"
        : route.lastTest
          ? "failed"
          : "saved",
    last_latency_ms: route.lastTest?.latency_ms,
    last_error_summary: route.lastTest?.error,
    extra_config_json: {
      provider_id: preset.provider_id,
      model_id: preset.model_name,
      capability: isGlmExtractionProvider(preset.provider_id) ? "vision" : "image",
      mobile_route: true,
      local_byok: true,
      mobile_default: isDefault,
    },
  };
}

async function readActiveRoutes(): Promise<Record<"image" | "extraction", string>> {
  const fallback = { image: "openai-relay", extraction: "glm-direct" };
  const raw = await SecureStore.getItemAsync(ACTIVE_ROUTES_STORAGE_KEY);
  if (!raw) return fallback;
  try {
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

function findPreset(payload: MobileModelRouteDraft): RoutePreset | undefined {
  return presets.find((item) => (
    item.provider_id === payload.provider_id
    && item.model_name === payload.model_name
    && item.routing_mode === payload.routing_mode
  ));
}

async function readStoredRoutes(): Promise<Record<string, StoredRoute>> {
  const raw = await SecureStore.getItemAsync(ROUTES_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const metadata = parsed as Record<string, Omit<StoredRoute, "apiKey">>;
    const entries = await Promise.all(Object.entries(metadata).map(async ([key, route]) => {
      const apiKey = await SecureStore.getItemAsync(secretStorageKey(key)) || "";
      return [key, { ...route, apiKey }] as const;
    }));
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

async function writeStoredRoutes(routes: Record<string, StoredRoute>): Promise<void> {
  const metadata: Record<string, Omit<StoredRoute, "apiKey">> = {};
  for (const [key, route] of Object.entries(routes)) {
    const { apiKey, ...rest } = route;
    metadata[key] = rest;
    if (apiKey) await SecureStore.setItemAsync(secretStorageKey(key), apiKey);
    else await SecureStore.deleteItemAsync(secretStorageKey(key));
  }
  for (const preset of presets) {
    if (!routes[preset.key]) await SecureStore.deleteItemAsync(secretStorageKey(preset.key));
  }
  await SecureStore.setItemAsync(ROUTES_STORAGE_KEY, JSON.stringify(metadata));
}

function secretStorageKey(routeKey: string): string {
  return `qigou.mobile.byok-model-secret.${routeKey}`;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/(chat\/completions|images\/generations|images\/edits)\/?$/i, "").replace(/\/+$/, "");
}

function safeProviderError(value: string, status: number): string {
  try {
    const parsed = JSON.parse(value);
    const message = parsed?.error?.message || parsed?.error || parsed?.message || parsed?.detail;
    if (typeof message === "string") return `HTTP ${status}: ${message.slice(0, 500)}`;
  } catch {
    // Use a bounded provider response below.
  }
  return `HTTP ${status}: ${value.slice(0, 500) || "Provider 请求失败。"}`;
}

function validJsonEnvelope(value: string): boolean {
  try {
    const payload = JSON.parse(value);
    return Boolean(payload && typeof payload === "object" && (Array.isArray(payload.choices) || typeof payload.output_text === "string"));
  } catch {
    return false;
  }
}

function errorTypeForStatus(status: number): string {
  if (status === 401 || status === 403) return "authentication_error";
  if (status === 429) return "rate_limit";
  return "provider_error";
}
