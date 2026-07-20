import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const modelSettings = readFileSync(resolve(root, "src/pages/ModelSettingsPage.tsx"), "utf8");
const multiRoomPage = readFileSync(resolve(root, "src/pages/MultiRoomBoardPage.tsx"), "utf8");
const spaceRenderPage = readFileSync(resolve(root, "src/pages/SpaceRenderPage.tsx"), "utf8");
const modelSelection = readFileSync(resolve(root, "src/lib/model-selection.ts"), "utf8");
const workflowOverride = readFileSync(resolve(root, "src/components/WorkflowModelOverride.tsx"), "utf8");
const routeLabels = readFileSync(resolve(root, "src/lib/model-route-labels.ts"), "utf8");
const taskStatusItem = readFileSync(resolve(root, "src/components/TaskStatusItem.tsx"), "utf8");
const modelStore = readFileSync(resolve(root, "src/stores/useModelStore.ts"), "utf8");

for (const fragment of [
  "单房间提取",
  "多房间提取",
  "room_board.extraction",
  "multi_room_board.extraction",
  "应用到提取模型",
  "buildWorkflowRouteOptions",
  "selectedRouteKey",
  "模型线路",
]) {
  assertIncludes(modelSettings, fragment, "ModelSettingsPage.tsx");
}

for (const fragment of [
  "space_render.extraction",
  "useReferenceImages",
  "activeReferenceAssetIds",
  "selected_reference_item_ids",
  "reference_review_snapshot",
  "生成时使用参考图",
  "GLM 提取是可选的精细控制",
]) {
  assertIncludes(spaceRenderPage, fragment, "SpaceRenderPage.tsx");
}
assertNotIncludes(spaceRenderPage, "Boolean(referenceReviewError)", "SpaceRenderPage.tsx");
assertNotIncludes(spaceRenderPage, "if (referenceReviewError)", "SpaceRenderPage.tsx");

for (const fragment of [
  "extractionUnavailableReason",
  "当前提取模型",
  "workflowSlot: \"multi_room_board.extraction\"",
]) {
  assertIncludes(multiRoomPage, fragment, "MultiRoomBoardPage.tsx");
}

for (const fragment of [
  "unusableVisionModelIds",
  "defaultRelayVisionModelIds",
  "isConfiguredOpenAICompatibleRelay",
  "defaultVisionModelForConfig",
  "isPotentialVisionProviderConfig",
  "isUsableVisionModelId",
  "visionModelForSelection",
]) {
  assertIncludes(modelSelection, fragment, "model-selection.ts");
}

assertIncludes(workflowOverride, "glm-4.5v 或中转实际 GLM 模型 ID", "WorkflowModelOverride.tsx");
assertNotIncludes(workflowOverride, "relay-text-smoke-test 或中转视觉模型 ID", "WorkflowModelOverride.tsx");
assertIncludes(workflowOverride, "workflowOverrideOptionLabel(config, capability, effectiveSelection.model, locale)", "WorkflowModelOverride.tsx");
assertIncludes(workflowOverride, "workflowRuntimeLabel(selectedConfig, effectiveSelection.model, locale)", "WorkflowModelOverride.tsx");

assertIncludes(modelSettings, "GLM", "ModelSettingsPage.tsx");
assertIncludes(modelSettings, "OpenAI 兼容中转", "ModelSettingsPage.tsx");
assertIncludes(modelSettings, "Google Gemini", "ModelSettingsPage.tsx");
assertIncludes(modelSettings, "兼容中转", "ModelSettingsPage.tsx");
assertIncludes(modelSettings, "智谱 GLM（中国大陆）", "ModelSettingsPage.tsx");
assertIncludes(modelSettings, "Z.AI GLM（国际/海外）", "ModelSettingsPage.tsx");
assertIncludes(modelSettings, "preserveModelName", "ModelSettingsPage.tsx");
assertIncludes(modelSettings, "vision_model_id", "ModelSettingsPage.tsx");
assertIncludes(modelSettings, "routeKey(providerId, modelIdOf(saved), saved.routing_mode", "ModelSettingsPage.tsx");
assertIncludes(modelSettings, "中转 Base URL 不能为空", "ModelSettingsPage.tsx");
assertIncludes(modelSettings, "后端没有持久化中转 Base URL", "ModelSettingsPage.tsx");
assertIncludes(modelSettings, "后端没有确认 API Key 已进入安全存储", "ModelSettingsPage.tsx");

assertIncludes(routeLabels, "中转 Base URL", "model-route-labels.ts");
assertIncludes(routeLabels, 'locale === "zh-CN" ? "配置" : "Config"', "model-route-labels.ts");
assertIncludes(routeLabels, "中转地址已配置", "model-route-labels.ts");
assertIncludes(routeLabels, "workflowVisionOptionLabel", "model-route-labels.ts");
assertNotIncludes(workflowOverride, "shortBaseUrl", "WorkflowModelOverride.tsx");
assertIncludes(taskStatusItem, "taskRuntimeLabel(task, routeConfig, locale)", "TaskStatusItem.tsx");
assertIncludes(taskStatusItem, "routeAddressStatus(routeConfig, locale)", "TaskStatusItem.tsx");
assertNotIncludes(modelSelection, "hasUsableRelayVisionOverride", "model-selection.ts");
assertIncludes(modelSelection, "if (isImageOnlyModelId(modelId))", "model-selection.ts");
assertIncludes(modelSelection, "isConfiguredOpenAICompatibleRelay(config) && isGlmModelId(modelId)", "model-selection.ts");
assertIncludes(modelSettings, 'providerId: "zhipu_glm" | "zai_glm"', "ModelSettingsPage.tsx");
assertNotIncludes(modelSettings, "&& isUsableVisionModelId(selectedConfigModelId)", "ModelSettingsPage.tsx");
assertIncludes(modelSettings, "isUsableVisionModelId(extractionModelId)", "ModelSettingsPage.tsx");
assertNotIncludes(workflowOverride, "return isUsableVisionModelId(configModel) ? configModel : defaultVisionModelForConfig(config)", "WorkflowModelOverride.tsx");
assertIncludes(modelSelection, "modelIdOf(config) === selection.model && isPreferredConfiguredRelayConfig(config)", "model-selection.ts");
assertIncludes(modelSelection, "modelIdOf(config) === \"gpt-image-2\" && isPreferredConfiguredRelayConfig(config)", "model-selection.ts");
assertIncludes(modelSelection, "isOfficialGlmVisionConfig", "model-selection.ts");
assertNotIncludes(modelSelection, "isOfficialGeminiVisionConfig", "model-selection.ts");
assertNotIncludes(modelSelection, "isExplicitOpenAIVisionConfig", "model-selection.ts");
assertIncludes(workflowOverride, "!isOpenAIImageRelayConfig(config)", "WorkflowModelOverride.tsx");
assertNotIncludes(modelSelection, "|| text.includes(\"text\")", "model-selection.ts");
assertIncludes(modelStore, "isRunnableVisionProviderConfig(config)", "useModelStore.ts");
assertIncludes(modelStore, "isRunnableImageProviderConfig(config)", "useModelStore.ts");
assertIncludes(modelStore, "runnableConfigs.find((config) => config.id === preference.default_provider_config_id)", "useModelStore.ts");

console.log("PASS model routing frontend static contract");

function assertIncludes(source, fragment, fileName) {
  if (!source.includes(fragment)) {
    console.error(`FAIL ${fileName} missing: ${fragment}`);
    process.exit(1);
  }
}

function assertNotIncludes(source, fragment, fileName) {
  if (source.includes(fragment)) {
    console.error(`FAIL ${fileName} still contains stale fragment: ${fragment}`);
    process.exit(1);
  }
}
