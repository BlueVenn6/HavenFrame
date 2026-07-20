import { create } from "zustand";

import { apiRequest } from "../api/client";
import {
  isRunnableImageProviderConfig,
  isRunnableVisionProviderConfig,
} from "../lib/model-selection";
import type {
  Capability,
  CompatibilityMode,
  ModelConfig,
  ModelConnectivityTestRequest,
  ModelConnectivityTestResult,
  ModuleModelPreference,
  ModuleName,
  RoutingMode,
  WorkflowModelOverride,
  WorkflowModelSlotKey,
} from "../types";

interface ModelStore {
  providerConfigs: ModelConfig[];
  modulePreferences: ModuleModelPreference[];
  editorModule: ModuleName;
  routingMode: RoutingMode;
  compatibilityMode: CompatibilityMode;
  capabilityFilter?: Capability;
  validationState: Record<number, "idle" | "validating" | "valid" | "error">;
  selectedTestResult?: ModelConnectivityTestResult;
  testAllResults: ModelConnectivityTestResult[];
  isLoadingConfigs: boolean;
  isSavingConfig: boolean;
  isTestingConnection: boolean;
  modelError?: string;
  activeProviderByModule: Record<string, string>;
  activeModelByModule: Record<string, string>;
  activeProviderConfigIdByModule: Record<string, number | null>;
  workflowModelOverrides: Partial<Record<WorkflowModelSlotKey, WorkflowModelOverride>>;
  setEditorModule: (moduleName: ModuleName) => void;
  setRoutingMode: (mode: RoutingMode) => void;
  setCompatibilityMode: (mode: CompatibilityMode) => void;
  setCapabilityFilter: (capability?: Capability) => void;
  setModuleSelection: (moduleName: string, provider: string, model: string, providerConfigId?: number | null) => void;
  setWorkflowModelOverride: (slotKey: WorkflowModelSlotKey, selection: WorkflowModelOverride) => void;
  setValidationState: (configId: number, state: "idle" | "validating" | "valid" | "error") => void;
  loadProviderConfigs: () => Promise<void>;
  saveProviderConfig: (config: ModelConfig) => Promise<ModelConfig | undefined>;
  clearProviderApiKey: (configId: number) => Promise<ModelConfig | undefined>;
  testModelConnection: (payload: ModelConnectivityTestRequest) => Promise<ModelConnectivityTestResult>;
  testAllConfiguredModels: (includeCostRisk?: boolean) => Promise<ModelConnectivityTestResult[]>;
  updateModulePriority: (moduleName: string, order: string[], defaultProviderConfigId?: number | null) => Promise<void>;
  updateProviderConfig: (configId: number, patch: Partial<ModelConfig>) => void;
}

const WORKFLOW_MODEL_OVERRIDE_STORAGE_KEY = "qigou.workflow-model-overrides";
const LEGACY_WORKFLOW_MODEL_OVERRIDE_STORAGE_KEY = "havenframe.workflow-model-overrides";

export const useModelStore = create<ModelStore>((set) => ({
  providerConfigs: [],
  modulePreferences: [],
  editorModule: "floorplan",
  routingMode: "direct_api",
  compatibilityMode: "native",
  validationState: {},
  testAllResults: [],
  isLoadingConfigs: false,
  isSavingConfig: false,
  isTestingConnection: false,
  activeProviderByModule: {
    floorplan: "OpenAI",
    boards: "OpenAI",
    room_board_extraction: "Zhipu GLM",
    multi_room_board_extraction: "Zhipu GLM",
    space_render: "OpenAI",
    image_editing: "OpenAI",
  },
  activeModelByModule: {
    floorplan: "gpt-image-2",
    boards: "gpt-image-2",
    room_board_extraction: "glm-4.5v",
    multi_room_board_extraction: "glm-4.5v",
    space_render: "gpt-image-2",
    image_editing: "gpt-image-2",
  },
  activeProviderConfigIdByModule: {
    floorplan: null,
    boards: null,
    room_board_extraction: null,
    multi_room_board_extraction: null,
    space_render: null,
    image_editing: null,
  },
  workflowModelOverrides: loadWorkflowModelOverrides(),
  setEditorModule: (editorModule) => set({ editorModule }),
  setRoutingMode: (routingMode) => set({ routingMode }),
  setCompatibilityMode: (compatibilityMode) => set({ compatibilityMode }),
  setCapabilityFilter: (capabilityFilter) => set({ capabilityFilter }),
  setModuleSelection: (moduleName, provider, model, providerConfigId) =>
    set((state) => ({
      activeProviderByModule: { ...state.activeProviderByModule, [moduleName]: provider },
      activeModelByModule: { ...state.activeModelByModule, [moduleName]: model },
      activeProviderConfigIdByModule: providerConfigId !== undefined
        ? { ...state.activeProviderConfigIdByModule, [moduleName]: providerConfigId }
        : state.activeProviderConfigIdByModule,
    })),
  setWorkflowModelOverride: (slotKey, selection) =>
    set((state) => {
      const workflowModelOverrides = {
        ...state.workflowModelOverrides,
        [slotKey]: selection,
      };
      saveWorkflowModelOverrides(workflowModelOverrides);
      return { workflowModelOverrides };
    }),
  setValidationState: (configId, stateValue) =>
    set((state) => ({
      validationState: { ...state.validationState, [configId]: stateValue },
    })),
  loadProviderConfigs: async () => {
    set({ isLoadingConfigs: true, modelError: undefined });
    try {
      const [providerConfigs, modulePreferences] = await Promise.all([
        apiRequest<ModelConfig[]>("/api/models/providers"),
        apiRequest<ModuleModelPreference[]>("/api/models/module-preferences"),
      ]);
      set((state) => ({
        providerConfigs,
        modulePreferences,
        activeProviderByModule: deriveActiveProvidersFromPreferences(
          providerConfigs,
          modulePreferences,
          state.activeProviderByModule,
        ),
        activeModelByModule: deriveActiveModelsFromPreferences(
          providerConfigs,
          modulePreferences,
          state.activeModelByModule,
        ),
        activeProviderConfigIdByModule: deriveActiveConfigIdsFromPreferences(
          providerConfigs,
          modulePreferences,
          state.activeProviderConfigIdByModule,
        ),
        routingMode:
          providerConfigs.find(
            (config) =>
              config.provider_name === state.activeProviderByModule[state.editorModule] &&
              config.model_name === state.activeModelByModule[state.editorModule],
          )?.routing_mode ?? state.routingMode,
        compatibilityMode:
          providerConfigs.find(
            (config) =>
              config.provider_name === state.activeProviderByModule[state.editorModule] &&
              config.model_name === state.activeModelByModule[state.editorModule],
          )?.compatibility_mode ?? state.compatibilityMode,
        isLoadingConfigs: false,
      }));
    } catch (error) {
      set({
        isLoadingConfigs: false,
        modelError: error instanceof Error ? error.message : "模型配置加载失败。",
      });
    }
  },
  saveProviderConfig: async (config) => {
    set({ isSavingConfig: true, modelError: undefined });
    try {
      const saved = await apiRequest<ModelConfig>("/api/models/configs", {
        method: "POST",
        body: JSON.stringify(config),
      });
      set((state) => ({
        providerConfigs: [
          {
            ...saved,
            has_api_key: saved.has_api_key || Boolean(config.api_key_encrypted) || Boolean(saved.api_key_encrypted),
          },
          ...state.providerConfigs.filter((item) => item.id !== saved.id),
        ].sort((a, b) => a.priority - b.priority),
        isSavingConfig: false,
      }));
      return saved;
    } catch (error) {
      set({
        isSavingConfig: false,
        modelError: error instanceof Error ? error.message : "模型配置保存失败。",
      });
      return undefined;
    }
  },
  clearProviderApiKey: async (configId) => {
    set({ isSavingConfig: true, modelError: undefined });
    try {
      const saved = await apiRequest<ModelConfig>(`/api/models/providers/${configId}/api-key`, {
        method: "DELETE",
      });
      set((state) => ({
        providerConfigs: state.providerConfigs.map((config) => (config.id === configId ? saved : config)),
        isSavingConfig: false,
      }));
      return saved;
    } catch (error) {
      set({
        isSavingConfig: false,
        modelError: error instanceof Error ? error.message : "API Key 清除失败。",
      });
      return undefined;
    }
  },
  testModelConnection: async (payload) => {
    set((state) => ({
      isTestingConnection: true,
      selectedTestResult: undefined,
      validationState: payload.provider_config_id
        ? { ...state.validationState, [payload.provider_config_id]: "validating" }
        : state.validationState,
      modelError: undefined,
    }));
    try {
      const result = await apiRequest<ModelConnectivityTestResult>("/api/models/test", {
        method: "POST",
        body: JSON.stringify(payload),
        timeoutMs: Math.max(45000, ((payload.timeout_sec ?? 30) + 15) * 1000),
      });
      set((state) => ({
        selectedTestResult: result,
        isTestingConnection: false,
        validationState: payload.provider_config_id
          ? { ...state.validationState, [payload.provider_config_id]: result.ok ? "valid" : "error" }
          : state.validationState,
        providerConfigs: state.providerConfigs.map((config) =>
          payload.provider_config_id && config.id === payload.provider_config_id
            ? {
                ...config,
                last_test_status: result.ok ? "connected" : "failed",
                last_latency_ms: result.latency_ms,
                last_error_summary: result.error,
              }
            : config,
        ),
      }));
      return result;
    } catch (error) {
      const result: ModelConnectivityTestResult = {
        ok: false,
        provider_id: payload.provider_id,
        model_id: payload.model_id,
        routing_mode: payload.routing_mode,
        compatibility_mode: payload.compatibility_mode,
        error_type: error instanceof Error && error.message.startsWith("Backend unreachable") ? "backend_unreachable" : "network_error",
        error: error instanceof Error ? error.message : "连接测试失败。",
      };
      set({ selectedTestResult: result, isTestingConnection: false, modelError: result.error ?? undefined });
      return result;
    }
  },
  testAllConfiguredModels: async (includeCostRisk = false) => {
    set({ isTestingConnection: true, modelError: undefined });
    try {
      const results = await apiRequest<ModelConnectivityTestResult[]>("/api/models/test-all", {
        method: "POST",
        body: JSON.stringify({ include_costly: includeCostRisk }),
      });
      set({ testAllResults: results, isTestingConnection: false });
      return results;
    } catch (error) {
      set({
        isTestingConnection: false,
        modelError: error instanceof Error ? error.message : "批量连接测试失败。",
      });
      return [];
    }
  },
  updateModulePriority: async (moduleName, order, defaultProviderConfigId) => {
    set((state) => ({
      modulePreferences: state.modulePreferences.map((preference) =>
        preference.module_name === moduleName
          ? {
              ...preference,
              priority_order_json: order,
              default_provider_config_id: defaultProviderConfigId ?? preference.default_provider_config_id,
            }
          : preference,
      ),
    }));
    try {
      const saved = await apiRequest<ModuleModelPreference>(`/api/models/module-preferences/${moduleName}`, {
        method: "PATCH",
        body: JSON.stringify({
          priority_order_json: order,
          ...(defaultProviderConfigId !== undefined ? { default_provider_config_id: defaultProviderConfigId } : {}),
        }),
      });
      set((state) => ({
        modulePreferences: state.modulePreferences.map((preference) =>
          preference.module_name === moduleName ? saved : preference,
        ),
      }));
    } catch (error) {
      set({
        modelError: error instanceof Error ? error.message : "模块默认模型更新失败。",
      });
    }
  },
  updateProviderConfig: (configId, patch) =>
    set((state) => ({
      providerConfigs: state.providerConfigs.map((config) =>
        config.id === configId ? { ...config, ...patch } : config,
      ),
    })),
}));

function loadWorkflowModelOverrides(): Partial<Record<WorkflowModelSlotKey, WorkflowModelOverride>> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(WORKFLOW_MODEL_OVERRIDE_STORAGE_KEY)
      ?? window.localStorage.getItem(LEGACY_WORKFLOW_MODEL_OVERRIDE_STORAGE_KEY);
    if (!raw) return {};
    if (!window.localStorage.getItem(WORKFLOW_MODEL_OVERRIDE_STORAGE_KEY)) {
      window.localStorage.setItem(WORKFLOW_MODEL_OVERRIDE_STORAGE_KEY, raw);
      window.localStorage.removeItem(LEGACY_WORKFLOW_MODEL_OVERRIDE_STORAGE_KEY);
    }
    return JSON.parse(raw) as Partial<Record<WorkflowModelSlotKey, WorkflowModelOverride>>;
  } catch {
    return {};
  }
}

function saveWorkflowModelOverrides(overrides: Partial<Record<WorkflowModelSlotKey, WorkflowModelOverride>>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WORKFLOW_MODEL_OVERRIDE_STORAGE_KEY, JSON.stringify(overrides));
  window.localStorage.removeItem(LEGACY_WORKFLOW_MODEL_OVERRIDE_STORAGE_KEY);
}

function deriveActiveProvidersFromPreferences(
  configs: ModelConfig[],
  preferences: ModuleModelPreference[],
  fallback: Record<string, string>,
): Record<string, string> {
  const next = { ...fallback };
  for (const preference of preferences) {
    const config = configForPreference(configs, preference);
    if (config) {
      next[preference.module_name] = config.provider_name;
    }
  }
  return next;
}

function deriveActiveModelsFromPreferences(
  configs: ModelConfig[],
  preferences: ModuleModelPreference[],
  fallback: Record<string, string>,
): Record<string, string> {
  const next = { ...fallback };
  for (const preference of preferences) {
    const config = configForPreference(configs, preference);
    if (config) {
      next[preference.module_name] = config.model_id ?? config.extra_config_json?.model_id ?? config.model_name;
    }
  }
  return next;
}

function deriveActiveConfigIdsFromPreferences(
  configs: ModelConfig[],
  preferences: ModuleModelPreference[],
  fallback: Record<string, number | null>,
): Record<string, number | null> {
  const next = { ...fallback };
  for (const preference of preferences) {
    const config = configForPreference(configs, preference);
    if (config) {
      next[preference.module_name] = config.id;
    }
  }
  return next;
}

function configForPreference(configs: ModelConfig[], preference: ModuleModelPreference): ModelConfig | undefined {
  const enabledConfigs = configs.filter((config) => config.is_enabled && !config.hidden && !config.deprecated);
  const runnableConfigs = enabledConfigs.filter((config) =>
    preference.module_name.endsWith("_extraction")
      ? isRunnableVisionProviderConfig(config)
      : isRunnableImageProviderConfig(config),
  );
  return runnableConfigs.find((config) => config.id === preference.default_provider_config_id)
    ?? runnableConfigs.find((config) => config.model_name === preference.priority_order_json[0] || config.model_id === preference.priority_order_json[0])
    ?? runnableConfigs[0];
}
