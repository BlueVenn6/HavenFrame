import { create } from "zustand";

import { apiRequest } from "../api/client";
import { currentAppLocale } from "../i18n/locale";
import type { ProviderImageTaskPayload, TaskRecord } from "../types";
import { useAssetStore } from "./useAssetStore";
import { useReviewStore } from "./useReviewStore";

const inFlightProviderTasks = new Map<string, Promise<TaskRecord>>();

interface TaskStore {
  tasks: TaskRecord[];
  error?: string;
  selectedTaskId?: number;
  selectTask: (taskId?: number) => void;
  updateTaskStatus: (taskId: number, status: TaskRecord["status"], progress: number) => void;
  loadTasks: (projectId?: number) => Promise<void>;
  addTask: (task: TaskRecord) => void;
  queueProviderImageTask: (payload: ProviderImageTaskPayload) => Promise<TaskRecord>;
}

export const useTaskStore = create<TaskStore>((set) => ({
  tasks: [],
  error: undefined,
  selectedTaskId: undefined,
  selectTask: (taskId) => set({ selectedTaskId: taskId }),
  updateTaskStatus: (taskId, status, progress) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId ? { ...task, status, progress } : task,
      ),
    })),
  loadTasks: async (projectId) => {
    try {
      const query = projectId ? `?project_id=${projectId}` : "";
      const tasks = await apiRequest<TaskRecord[]>(`/api/tasks${query}`);
      set({ tasks, error: undefined });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "任务列表加载失败。" });
    }
  },
  addTask: (task) => set((state) => ({ tasks: [task, ...state.tasks.filter((item) => item.id !== task.id)] })),
  queueProviderImageTask: async (payload) => {
    set({ error: undefined });
    const confirmedPayload = await ensureProviderDataFlowConfirmed(payload);
    const signature = providerTaskSignature(payload);
    const existing = inFlightProviderTasks.get(signature);
    if (existing) {
      return existing;
    }
    const now = new Date().toISOString();
    const optimisticTask: TaskRecord = {
      id: -Date.now(),
      project_id: confirmedPayload.project_id,
      module: confirmedPayload.module,
      task_type: confirmedPayload.task_type,
      provider: confirmedPayload.provider ?? "OpenAI",
      model_name: confirmedPayload.model_name ?? "gpt-image-2",
      provider_config_id: confirmedPayload.provider_config_id,
      status: "queued",
      progress: 0,
      input_payload_json: confirmedPayload.payload_json,
      prompt_snapshot_json: confirmedPayload.prompt_snapshot,
      params_snapshot_json: confirmedPayload.params_snapshot,
      created_at: now,
      updated_at: now,
    };
    set((state) => ({ tasks: [optimisticTask, ...state.tasks] }));
    const request = (async () => {
      const task = await apiRequest<TaskRecord>("/api/tasks/provider-image", {
        method: "POST",
        body: JSON.stringify(confirmedPayload),
        timeoutMs: 300000,
      });
      set((state) => ({ tasks: [task, ...state.tasks.filter((item) => item.id !== task.id && item.id !== optimisticTask.id)] }));
      const configuredTimeout = numberValue(confirmedPayload.params_snapshot?.timeout_sec);
      const finishedTask = await waitForTaskCompletion(task, configuredTimeout);
      set((state) => ({ tasks: [finishedTask, ...state.tasks.filter((item) => item.id !== finishedTask.id && item.id !== optimisticTask.id)] }));
      if (finishedTask.status === "failed") {
        const outputError = typeof finishedTask.output_payload_json?.error === "string" ? finishedTask.output_payload_json.error : undefined;
        throw new Error(outputError ?? finishedTask.error_message ?? "图片模型生成失败。");
      }
      if (finishedTask.status === "cancelled") {
        throw new Error("图片模型任务已取消。");
      }
      if (finishedTask.project_id) {
        void useAssetStore.getState().loadAssets(finishedTask.project_id);
        void useReviewStore.getState().fetchSnapshot(finishedTask.project_id);
      }
      void useTaskStore.getState().loadTasks(finishedTask.project_id);
      return finishedTask;
    })();
    inFlightProviderTasks.set(signature, request);
    try {
      return await request;
    } catch (error) {
      const failedTask: TaskRecord = {
        ...optimisticTask,
        status: "failed",
        progress: 100,
        error_message: error instanceof Error ? error.message : "图片模型生成失败。",
        updated_at: new Date().toISOString(),
      };
      set((state) => ({
        tasks: state.tasks.filter((item) => item.id !== optimisticTask.id),
        error: failedTask.error_message ?? undefined,
      }));
      throw error;
    } finally {
      inFlightProviderTasks.delete(signature);
    }
  },
}));

async function waitForTaskCompletion(task: TaskRecord, providerTimeoutSec?: number): Promise<TaskRecord> {
  if (isTaskDone(task)) {
    return task;
  }
  const waitSeconds = Math.min(Math.max(providerTimeoutSec ?? 1800, 60) + 120, 7320);
  const deadline = Date.now() + waitSeconds * 1000;
  let current = task;
  while (!isTaskDone(current) && Date.now() < deadline) {
    await delay(2500);
    current = await apiRequest<TaskRecord>(`/api/tasks/${task.id}`, { timeoutMs: 30000 });
    useTaskStore.getState().addTask(current);
  }
  if (!isTaskDone(current)) {
    throw new Error("图片模型任务仍在运行，已超过前端等待时间；请在任务队列查看最终状态。");
  }
  return current;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isTaskDone(task: TaskRecord): boolean {
  return task.status === "success" || task.status === "failed" || task.status === "cancelled";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function providerTaskSignature(payload: ProviderImageTaskPayload): string {
  return stableStringify({
    project_id: payload.project_id ?? null,
    module: payload.module,
    task_type: payload.task_type,
    capability: payload.capability,
    provider: payload.provider ?? "",
    model_name: payload.model_name ?? "",
    provider_config_id: payload.provider_config_id ?? null,
    payload_json: pickPayloadFields(payload.payload_json),
    prompt: payload.prompt_snapshot?.resolved_prompt ?? "",
    negative_prompt: payload.prompt_snapshot?.negative_prompt ?? "",
    params_snapshot: pickParamFields(payload.params_snapshot ?? {}),
    endpoint_path: payload.endpoint_path ?? "",
    request_format: payload.request_format ?? "",
    image_transport: payload.image_transport ?? "",
  });
}

async function ensureProviderDataFlowConfirmed(payload: ProviderImageTaskPayload): Promise<ProviderImageTaskPayload> {
  if (payload.data_flow_confirmed === true) {
    return payload;
  }
  const assetIds = payload.payload_json?.asset_ids ?? payload.payload_json?.source_asset_ids ?? [];
  const assetCount = Array.isArray(assetIds) ? assetIds.length : typeof assetIds === "number" ? 1 : 0;
  const provider = payload.provider ?? "OpenAI";
  const model = payload.model_name ?? "gpt-image-2";
  const prompt = payload.prompt_snapshot?.resolved_prompt ?? payload.payload_json?.prompt ?? payload.payload_summary ?? "";
  const usesRelay = payload.routing_mode === "relay_base_url" || String(provider).toLowerCase().includes("relay") || String(provider).toLowerCase().includes("compatible");
  const locale = currentAppLocale();
  const message = (locale === "zh-CN" ? [
      "即将发起真实云端/中转图片生成。",
      `将发送素材数量：${assetCount}`,
      `目标 Provider：${provider}`,
      `目标模型：${model}`,
      `是否中转 / Custom Endpoint：${usesRelay ? "是" : "否"}`,
      "提示词会发送给服务商，输出会保存到本地归档。",
      "请确认你有权上传这些客户图片、户型图和项目素材。",
      "",
      `提示词预览：${String(prompt).slice(0, 160)}`,
    ] : [
      "A real cloud or relay image-generation request is about to start.",
      `Assets to send: ${assetCount}`,
      `Provider: ${provider}`,
      `Model: ${model}`,
      `Relay / custom endpoint: ${usesRelay ? "Yes" : "No"}`,
      "The prompt will be sent to the Provider and the output will be saved to the local archive.",
      "Confirm that you are authorized to upload these client images, floor plans, and project assets.",
      "",
      `Prompt preview: ${String(prompt).slice(0, 160)}`,
    ]).join("\n");
  if (!window.confirm(message)) {
    throw new Error(locale === "zh-CN" ? "已取消：未确认真实生成数据流。" : "Cancelled: the real generation data transfer was not confirmed.");
  }
  return {
    ...payload,
    data_flow_confirmed: true,
    params_snapshot: {
      ...(payload.params_snapshot ?? {}),
      data_flow_confirmed: true,
      data_flow_summary: {
        asset_count: assetCount,
        provider,
        model,
        uses_relay_or_custom_endpoint: usesRelay,
        output_saved_to_local_archive: true,
        user_confirmed_asset_rights: true,
      },
    },
  };
}

function pickPayloadFields(payload: Record<string, unknown>): Record<string, unknown> {
  return pickFields(payload, [
    "asset_ids",
    "source_asset_ids",
    "rooms",
    "room_type",
    "aspect_ratio",
    "output_count",
    "require_source_images",
    "budget_range",
    "material_palette",
    "budget_allocation",
  ]);
}

function pickParamFields(params: Record<string, unknown>): Record<string, unknown> {
  return pickFields(params, [
    "aspect_ratio",
    "requested_size",
    "output_count",
    "endpoint_path",
    "budget_min",
    "budget_max",
    "item_budget_min",
    "item_budget_max",
    "timeout_sec",
  ]);
}

function pickFields(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return keys.reduce<Record<string, unknown>>((picked, key) => {
    if (source[key] !== undefined) picked[key] = source[key];
    return picked;
  }, {});
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
