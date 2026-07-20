import { create } from "zustand";

import type { CustomWorkflowDraft, FloorplanDraft, SpaceRenderDraft } from "../types";

interface UIStore {
  activeModule: string;
  taskDrawerOpen: boolean;
  taskQueueCollapsed: boolean;
  hiddenTaskIds: number[];
  floorplanDraft: FloorplanDraft;
  spaceRenderDraft: SpaceRenderDraft;
  customWorkflowDraft: CustomWorkflowDraft;
  setActiveModule: (moduleName: string) => void;
  setTaskDrawerOpen: (isOpen: boolean) => void;
  setTaskQueueCollapsed: (isCollapsed: boolean) => void;
  hideTask: (taskId: number) => void;
  clearHiddenTasks: () => void;
  updateFloorplanDraft: (patch: Partial<FloorplanDraft>) => void;
  updateSpaceRenderDraft: (patch: Partial<SpaceRenderDraft>) => void;
  updateCustomWorkflowDraft: (patch: Partial<CustomWorkflowDraft>) => void;
  resetSpaceRenderDraft: () => void;
}

const defaultSpaceRenderDraft: SpaceRenderDraft = {
  roomType: "客厅",
  customRoomType: "",
  styles: ["柔和极简"],
  customStyle: "",
  styleStrength: 0.72,
  styleDescription: "暖调材质、克制造型的柔和极简室内空间。",
  realismLevel: 0.82,
  lightingMode: "金色时刻",
  structurePreservationStrength: 0.72,
  referenceWeight: 0.65,
  creativity: 0.42,
  lightingIntensity: 0.68,
  materialFidelity: 0.78,
  materialKeywords: ["胡桃木", "羊羔绒", "石材"],
  colorPalette: ["象牙白", "灰褐色", "黄铜"],
  furnitureKeywords: ["弧形沙发", "低矮茶几"],
  lightingKeywords: ["暖色间接光", "柔和日光"],
  mustKeep: ["窗户位置", "层高"],
  mustChange: ["软装搭配", "表面材质"],
  promptFragments: ["工作室级室内可视化", "可用于客户提案"],
  designBrief: "保留房间结构，同时升级家具、材质和灯光，形成精修提案图。",
  promptTemplateId: 1,
  mainPrompt: "生成一张真实感室内渲染图，保留原始建筑结构，并优化家具、材质配色和灯光。",
  customPrompt: "保留结构，同时提升材质表现和工作室级灯光。",
  negativePrompt: "灯光浑浊, 结构变形, 家具扭曲, 构图杂乱",
  referenceSlots: [
    { id: "original_room", label: "原始房间图", status: "required", required: true, note: "必需的源图位置。" },
    { id: "reference_image", label: "参考图", status: "optional", note: "风格或材质参考。" },
    { id: "moodboard", label: "情绪板", status: "empty", note: "可选视觉方向。" },
    { id: "mask", label: "蒙版 / 区域选择", status: "empty", note: "预留给局部编辑工作流。" },
  ],
  outputCount: 1,
  aspectRatio: "16:9",
  resolutionPreset: "1536x864",
  seed: "",
  safetyCostAcknowledged: false,
};

export const useUIStore = create<UIStore>((set) => ({
  activeModule: "dashboard",
  taskDrawerOpen: false,
  taskQueueCollapsed: true,
  hiddenTaskIds: loadHiddenTaskIds(),
  floorplanDraft: {
    outputMode: "2d_color",
    style: "现代暖调",
    customStyle: "",
    aspectRatio: "4:3",
    promptTemplateId: 3,
    customPrompt: "保持动线清晰，输出适合客户评审的展示图。",
    negativePrompt: "墙体变形, 标注缺失",
    scaleCalibration: "1 px = 20 mm",
    detectRooms: true,
    extractLabels: true,
    detectOpenings: true,
    manualCorrectionMode: false,
    outputTypes: ["房间", "尺寸", "标注", "JSON"],
  },
  spaceRenderDraft: defaultSpaceRenderDraft,
  customWorkflowDraft: {
    taskName: "生成侘寂日式客厅方案",
    taskType: "房间改造",
    customTaskType: "",
    capability: "image_to_image",
    mainPrompt: "生成一张侘寂日式客厅方案图，包含暖木色、柔和中性色软包和安静日光。",
    designBrief: "客户希望保留现有布局，同时提升材质、灯光和家具造型，形成安静高级的客厅方向。",
    references: [
      { id: "source_image", label: "源图", status: "required", required: true, note: "主要输入图。" },
      { id: "reference_image", label: "参考图", status: "optional", note: "可选设计参考。" },
      { id: "floorplan", label: "平面图", status: "optional", note: "可选平面信息。" },
      { id: "moodboard", label: "情绪板", status: "empty", note: "可选视觉方向。" },
      { id: "mask", label: "蒙版 / 标记区域", status: "empty", note: "预留给编辑任务。" },
    ],
    styleKeywords: ["侘寂日式", "柔和极简"],
    materialKeywords: ["橡木", "亚麻", "石材"],
    colorPalette: ["暖白", "灰褐色", "炭灰点缀"],
    lightingKeywords: ["柔和日光", "暖色间接光"],
    mustKeep: ["现有窗户", "主沙发位置"],
    mustChange: ["零散配饰", "表面材质"],
    outputCount: 1,
    aspectRatio: "1:1",
    resolutionPreset: "1024",
    seed: "",
    priority: "普通",
    saveOutputsToProject: true,
    inputSchemaJson: "{\n  \"required\": [\"source_image\"],\n  \"optional\": [\"reference_image\"]\n}",
    promptTemplate: "使用 {source_image} 并应用 {style_direction}。",
    negativePrompt: "低质量, 结构变形",
    headersJson: "{}",
    bodyTemplateJson: "{\n  \"prompt\": \"{{prompt}}\",\n  \"model\": \"{{model}}\"\n}",
    outputParserType: "json_preview",
  },
  setActiveModule: (activeModule) => set({ activeModule }),
  setTaskDrawerOpen: (taskDrawerOpen) => set({ taskDrawerOpen }),
  setTaskQueueCollapsed: (taskQueueCollapsed) => set({ taskQueueCollapsed }),
  hideTask: (taskId) =>
    set((state) => {
      const hiddenTaskIds = Array.from(new Set([...state.hiddenTaskIds, taskId]));
      saveHiddenTaskIds(hiddenTaskIds);
      return { hiddenTaskIds };
    }),
  clearHiddenTasks: () => {
    saveHiddenTaskIds([]);
    set({ hiddenTaskIds: [] });
  },
  updateFloorplanDraft: (patch) =>
    set((state) => ({ floorplanDraft: { ...state.floorplanDraft, ...patch } })),
  updateSpaceRenderDraft: (patch) =>
    set((state) => ({ spaceRenderDraft: { ...state.spaceRenderDraft, ...patch } })),
  updateCustomWorkflowDraft: (patch) =>
    set((state) => ({ customWorkflowDraft: { ...state.customWorkflowDraft, ...patch } })),
  resetSpaceRenderDraft: () => set({ spaceRenderDraft: defaultSpaceRenderDraft }),
}));

const HIDDEN_TASKS_STORAGE_KEY = "qigou.hidden-task-ids";
const LEGACY_HIDDEN_TASKS_STORAGE_KEY = "havenframe-cn.hidden-task-ids";

function loadHiddenTaskIds(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HIDDEN_TASKS_STORAGE_KEY)
      ?? window.localStorage.getItem(LEGACY_HIDDEN_TASKS_STORAGE_KEY)
      ?? "[]";
    const parsed = JSON.parse(raw);
    if (!window.localStorage.getItem(HIDDEN_TASKS_STORAGE_KEY) && raw !== "[]") {
      window.localStorage.setItem(HIDDEN_TASKS_STORAGE_KEY, raw);
      window.localStorage.removeItem(LEGACY_HIDDEN_TASKS_STORAGE_KEY);
    }
    return Array.isArray(parsed) ? parsed.filter((item): item is number => typeof item === "number") : [];
  } catch {
    return [];
  }
}

function saveHiddenTaskIds(taskIds: number[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(HIDDEN_TASKS_STORAGE_KEY, JSON.stringify(taskIds));
  window.localStorage.removeItem(LEGACY_HIDDEN_TASKS_STORAGE_KEY);
}
