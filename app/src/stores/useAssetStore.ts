import { create } from "zustand";

import { apiRequest } from "../api/client";
import type { AssetRecord } from "../types";

interface AssetStore {
  assets: AssetRecord[];
  isUploading: boolean;
  error?: string;
  addAsset: (asset: AssetRecord) => void;
  addAssets: (assets: AssetRecord[]) => void;
  deleteAsset: (assetId: number) => Promise<void>;
  loadAssets: (projectId?: number) => Promise<void>;
  uploadAssets: (
    files: File[],
    options: {
      projectId: number;
      assetType: string;
      roomType?: string;
      source?: string;
    },
  ) => Promise<AssetRecord[]>;
}

export const useAssetStore = create<AssetStore>((set, get) => ({
  assets: [],
  isUploading: false,
  error: undefined,
  addAsset: (asset) => set((state) => ({ assets: [asset, ...state.assets] })),
  addAssets: (assets) =>
    set((state) => ({
      assets: [...assets, ...state.assets.filter((item) => !assets.some((next) => next.id === item.id))],
    })),
  deleteAsset: async (assetId) => {
    try {
      await apiRequest<{ deleted: boolean }>(`/api/assets/${assetId}`, { method: "DELETE" });
      set((state) => ({ assets: state.assets.filter((asset) => asset.id !== assetId), error: undefined }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "素材删除失败。";
      set({ error: message });
      throw error;
    }
  },
  loadAssets: async (projectId) => {
    try {
      const query = projectId ? `?project_id=${projectId}` : "";
      const assets = await apiRequest<AssetRecord[]>(`/api/assets${query}`);
      set({ assets, error: undefined });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "无法加载素材列表，请检查本地后端是否正在运行。" });
    }
  },
  uploadAssets: async (files, options) => {
    if (files.length === 0) {
      return [];
    }

    set({ isUploading: true, error: undefined });

    const uploaded: AssetRecord[] = [];
    for (const file of files) {
      const formData = new FormData();
      formData.append("project_id", String(options.projectId));
      formData.append("asset_type", options.assetType);
      formData.append("file", file);
      if (options.roomType) {
        formData.append("room_type", options.roomType);
      }
      if (options.source) {
        formData.append("source", options.source);
      }

      try {
        const asset = await apiRequest<AssetRecord>("/api/assets/upload", {
          method: "POST",
          body: formData,
        });
        uploaded.push(asset);
      } catch (error) {
        set({
          isUploading: false,
          error: error instanceof Error ? error.message : "上传失败，请检查本地后端和项目是否可用。",
        });
        throw error;
      }
    }

    get().addAssets(uploaded);
    set({ isUploading: false });
    return uploaded;
  },
}));
