import { create } from "zustand";

import { apiRequest } from "../api/client";
import type { PromptTemplate } from "../types";

interface PromptDraft {
  name: string;
  module: string;
  userPrompt: string;
  negativePrompt?: string;
  variables: string[];
}

interface PromptStore {
  prompts: PromptTemplate[];
  activePromptId: number;
  promptSearch: string;
  moduleFilter: string;
  isLoading: boolean;
  error?: string;
  loadPrompts: () => Promise<void>;
  setActivePromptId: (promptId: number) => void;
  setPromptSearch: (value: string) => void;
  setModuleFilter: (value: string) => void;
  savePromptDraft: (payload: PromptDraft) => Promise<PromptTemplate>;
  toggleFavorite: (promptId: number) => Promise<void>;
  clonePrompt: (promptId: number) => Promise<void>;
}

export const usePromptStore = create<PromptStore>((set, get) => ({
  prompts: [],
  activePromptId: 0,
  promptSearch: "",
  moduleFilter: "all",
  isLoading: false,
  error: undefined,
  loadPrompts: async () => {
    set({ isLoading: true, error: undefined });
    try {
      const prompts = await apiRequest<PromptTemplate[]>("/api/prompts");
      set((state) => ({
        prompts,
        activePromptId: prompts.some((prompt) => prompt.id === state.activePromptId)
          ? state.activePromptId
          : prompts[0]?.id ?? 0,
        isLoading: false,
      }));
    } catch (error) {
      set({ isLoading: false, error: error instanceof Error ? error.message : "提示词列表加载失败。" });
    }
  },
  setActivePromptId: (activePromptId) => set({ activePromptId }),
  setPromptSearch: (promptSearch) => set({ promptSearch }),
  setModuleFilter: (moduleFilter) => set({ moduleFilter }),
  savePromptDraft: async (payload) => {
    const saved = await apiRequest<PromptTemplate>("/api/prompts", {
      method: "POST",
      body: JSON.stringify({
        name: payload.name.trim() || "未命名提示词草稿",
        module: payload.module === "all" ? "space_render" : payload.module,
        scope: "local",
        system_prompt: "你是一名室内设计 AI 交付助理。",
        user_prompt: payload.userPrompt,
        negative_prompt: payload.negativePrompt,
        variables_json: payload.variables,
        is_builtin: false,
        is_favorite: false,
        version: 1,
      }),
    });
    set((state) => ({
      prompts: [saved, ...state.prompts.filter((prompt) => prompt.id !== saved.id)],
      activePromptId: saved.id,
      error: undefined,
    }));
    return saved;
  },
  toggleFavorite: async (promptId) => {
    const source = get().prompts.find((prompt) => prompt.id === promptId);
    if (!source) return;
    try {
      const updated = await apiRequest<PromptTemplate>(`/api/prompts/${promptId}`, {
        method: "PATCH",
        body: JSON.stringify({ is_favorite: !source.is_favorite }),
      });
      set((state) => ({
        prompts: state.prompts.map((prompt) => (prompt.id === promptId ? updated : prompt)),
        error: undefined,
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "收藏状态保存失败。" });
      throw error;
    }
  },
  clonePrompt: async (promptId) => {
    try {
      const clone = await apiRequest<PromptTemplate>(`/api/prompts/${promptId}/clone`, { method: "POST" });
      set((state) => ({ prompts: [clone, ...state.prompts], activePromptId: clone.id, error: undefined }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "提示词复制失败。" });
      throw error;
    }
  },
}));
