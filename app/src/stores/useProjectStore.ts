import { create } from "zustand";

import { apiRequest } from "../api/client";
import type { Project } from "../types";

interface ProjectStore {
  projects: Project[];
  activeProjectId: number;
  error?: string;
  loadProjects: () => Promise<void>;
  createProject: (payload: Partial<Project> & { name: string }) => Promise<Project>;
  setActiveProject: (projectId: number) => void;
  addProject: (project: Project) => void;
}

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],
  activeProjectId: 0,
  error: undefined,
  loadProjects: async () => {
    try {
      const projects = await apiRequest<Project[]>("/api/projects");
      set((state) => ({
        projects,
        activeProjectId: projects.some((project) => project.id === state.activeProjectId)
          ? state.activeProjectId
          : projects[0]?.id ?? 0,
        error: undefined,
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "项目列表加载失败。" });
    }
  },
  createProject: async (payload) => {
    const project = await apiRequest<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    set((state) => ({ projects: [project, ...state.projects.filter((item) => item.id !== project.id)], activeProjectId: project.id, error: undefined }));
    return project;
  },
  setActiveProject: (projectId) => set({ activeProjectId: projectId }),
  addProject: (project) => set((state) => ({ projects: [project, ...state.projects] })),
}));
