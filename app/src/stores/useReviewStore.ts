import { create } from "zustand";

import { apiRequest } from "../api/client";
import type { ReviewSnapshot } from "../types";

interface ReviewStore {
  snapshotsByProject: Record<number, ReviewSnapshot>;
  error?: string;
  selectedReplayTaskId?: number;
  activeTab: "review" | "replay";
  getSnapshot: (projectId: number) => ReviewSnapshot | undefined;
  fetchSnapshot: (projectId: number) => Promise<void>;
  setSelectedReplayTaskId: (taskId?: number) => void;
  setActiveTab: (tab: "review" | "replay") => void;
}

export const useReviewStore = create<ReviewStore>((set, get) => ({
  snapshotsByProject: {},
  error: undefined,
  selectedReplayTaskId: undefined,
  activeTab: "review",
  getSnapshot: (projectId) => get().snapshotsByProject[projectId],
  fetchSnapshot: async (projectId) => {
    try {
      const snapshot = await apiRequest<ReviewSnapshot>(`/api/projects/${projectId}/review`);
      set((state) => ({
        snapshotsByProject: { ...state.snapshotsByProject, [projectId]: snapshot },
        selectedReplayTaskId: snapshot.replay_entries[0]?.task_id ?? state.selectedReplayTaskId,
        error: undefined,
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "项目复盘数据加载失败。" });
    }
  },
  setSelectedReplayTaskId: (selectedReplayTaskId) => set({ selectedReplayTaskId }),
  setActiveTab: (activeTab) => set({ activeTab }),
}));
