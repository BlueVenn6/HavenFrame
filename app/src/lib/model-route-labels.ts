import type { ModelConfig, TaskRecord } from "../types";
import { modelIdOf } from "./model-selection";
import { localeLabel } from "./zh-labels";

type Locale = "zh-CN" | "en";

export function routeKindLabel(config?: ModelConfig | null, locale: Locale = "zh-CN"): string {
  if (!config) return locale === "zh-CN" ? "未配置" : "Not configured";
  if (config.routing_mode === "relay_base_url") return locale === "zh-CN" ? "中转 Base URL" : "Relay Base URL";
  return locale === "zh-CN" ? "原生 API" : "Native API";
}

export function routeIdentityLabel(config?: ModelConfig | null, locale: Locale = "zh-CN"): string {
  if (!config) return locale === "zh-CN" ? "未配置线路" : "Route not configured";
  return `${providerDisplayName(config, locale)} ${routeKindLabel(config, locale)}`;
}

export function shortBaseUrl(value?: string | null, locale: Locale = "zh-CN"): string {
  const raw = value?.trim();
  if (!raw) return locale === "zh-CN" ? "Base URL 待配置" : "Base URL pending";
  try {
    const parsed = new URL(raw);
    const path = parsed.pathname.replace(/\/$/, "");
    return `${parsed.origin}${path}`;
  } catch {
    return raw;
  }
}

export function providerDisplayName(config?: ModelConfig | null, locale: Locale = "zh-CN"): string {
  if (!config) return locale === "zh-CN" ? "未配置供应商" : "Provider not configured";
  return localeLabel(config.provider_label ?? config.provider_name, locale);
}

export function configModelDisplayName(config?: ModelConfig | null, locale: Locale = "zh-CN"): string {
  if (!config) return locale === "zh-CN" ? "未选择模型" : "No model selected";
  return config.display_name
    ?? config.model_label
    ?? config.extra_config_json?.display_name
    ?? config.extra_config_json?.model_label
    ?? config.extra_config_json?.label
    ?? config.model_name;
}

export function workflowConfigOptionLabel(config: ModelConfig, locale: Locale = "zh-CN"): string {
  const model = modelIdOf(config);
  return `${routeIdentityLabel(config, locale)} · ${model} · ${locale === "zh-CN" ? "配置" : "Config"} #${config.id}`;
}

export function workflowVisionOptionLabel(config: ModelConfig, model: string, locale: Locale = "zh-CN"): string {
  const activeModel = model.trim() || modelIdOf(config);
  return `${routeIdentityLabel(config, locale)} · ${activeModel} · ${locale === "zh-CN" ? "配置" : "Config"} #${config.id}`;
}

export function workflowRuntimeLabel(config?: ModelConfig | null, model?: string | null, locale: Locale = "zh-CN"): string {
  if (!config) return model?.trim() || (locale === "zh-CN" ? "未选择模型" : "No model selected");
  const activeModel = model?.trim() || modelIdOf(config);
  return `${routeIdentityLabel(config, locale)} · ${activeModel} · ${locale === "zh-CN" ? "配置" : "Config"} #${config.id}`;
}

export function routeAddressStatus(config?: ModelConfig | null, locale: Locale = "zh-CN"): string {
  if (!config) return locale === "zh-CN" ? "未配置" : "Not configured";
  if (config.routing_mode === "relay_base_url") {
    return config.base_url?.trim()
      ? (locale === "zh-CN" ? "中转地址已配置" : "Relay address configured")
      : (locale === "zh-CN" ? "中转地址未配置" : "Relay address not configured");
  }
  return locale === "zh-CN" ? "原生官方接口" : "Official native API";
}

export function taskRuntimeLabel(task: TaskRecord, config?: ModelConfig | null, locale: Locale = "zh-CN"): string {
  if (config) return workflowRuntimeLabel(config, task.model_name, locale);
  return `${localeLabel(task.provider, locale)} · ${task.model_name}`;
}
