import { create } from "zustand";

import { apiRequest } from "../api/client";
import type { CustomTaskTemplate } from "../types";

interface CustomTaskStore {
  templates: CustomTaskTemplate[];
  isLoading: boolean;
  error?: string;
  loadTemplates: () => Promise<void>;
  createTemplate: () => Promise<CustomTaskTemplate>;
}

export const useCustomTaskStore = create<CustomTaskStore>((set, get) => ({
  templates: [],
  isLoading: false,
  error: undefined,
  loadTemplates: async () => {
    set({ isLoading: true, error: undefined });
    try {
      const templates = await apiRequest<CustomTaskTemplate[]>("/api/custom-tasks/templates");
      set({ templates, isLoading: false });
    } catch (error) {
      set({ isLoading: false, error: error instanceof Error ? error.message : "模板列表加载失败。" });
    }
  },
  createTemplate: async () => {
    const nextNo = get().templates.length + 1;
    const template = await apiRequest<CustomTaskTemplate>("/api/custom-tasks/templates", {
      method: "POST",
      body: JSON.stringify({
      name: `自定义任务模板 ${nextNo}`,
      description: "从当前工作台创建的本地模板草稿。",
      module_chain_json: ["custom_tasks"],
      input_schema_json: {
        required: ["reference_image"],
        optional: ["prompt", "style"],
      },
      output_schema_json: {
        outputs: ["render_output"],
      },
      default_provider: "OpenAI",
      default_model: "gpt-image-2",
      export_rules_json: { formats: ["png"] },
      is_team_visible: false,
      version: 1,
      }),
    });
    set((state) => ({ templates: [template, ...state.templates], error: undefined }));
    return template;
  },
}));
