import * as FileSystem from "expo-file-system/legacy";

import { generateDirectImage, extractDirectItems } from "./direct-providers";
import { getLocalModelRuntime, loadLocalModelRoutes } from "./local-model-routes";
import { boardDocumentData, renderFormalBoardReport } from "./mobile-report";
import type {
  AssetRecord,
  BoardDocument,
  CustomTaskTemplate,
  CustomTaskTemplateDraft,
  ExtractedItem,
  ExtractionResponse,
  ModulePreference,
  PickedImage,
  Project,
  PromptTemplate,
  ReviewSnapshot,
  TaskRecord,
  WorkflowDefinition,
} from "./types";

interface LocalState {
  projects: Project[];
  assets: AssetRecord[];
  tasks: TaskRecord[];
  prompts: PromptTemplate[];
  templates: CustomTaskTemplate[];
  extractedItems: ExtractedItem[];
  boardDocuments: BoardDocument[];
  exports: ReviewSnapshot["exports"];
}

const root = `${FileSystem.documentDirectory || ""}havenframe-mobile/`;
const assetsRoot = `${root}assets/`;
const outputsRoot = `${root}outputs/`;
const statePath = `${root}state.json`;

export class LocalMobileClient {
  health(): Promise<{ status: string; service: string }> {
    return Promise.resolve({ status: "ok", service: "HavenFrame on-device workspace" });
  }

  async listProjects(): Promise<Project[]> {
    return (await readState()).projects.sort(newestFirst);
  }

  async createProject(payload: {
    name: string;
    clientName?: string;
    styleTags?: string;
    roomTypes?: string;
    budgetMin?: number;
    budgetMax?: number;
    description?: string;
  }): Promise<Project> {
    const state = await readState();
    const now = new Date().toISOString();
    const project: Project = {
      id: nextId(state.projects),
      name: payload.name.trim(),
      client_name: payload.clientName ?? "",
      style_tags: payload.styleTags ?? "",
      room_types: payload.roomTypes ?? "",
      budget_min: payload.budgetMin ?? 0,
      budget_max: payload.budgetMax ?? 0,
      description: payload.description ?? "",
      status: "active",
      created_at: now,
      updated_at: now,
    };
    if (!project.name) throw new Error("项目名称不能为空。");
    state.projects.unshift(project);
    await writeState(state);
    return project;
  }

  async listAssets(projectId?: number): Promise<AssetRecord[]> {
    const assets = (await readState()).assets;
    return assets.filter((item) => !projectId || item.project_id === projectId).sort(newestFirst);
  }

  async uploadAsset(projectId: number, image: PickedImage, assetType: string, source: string, roomType?: string): Promise<AssetRecord> {
    const state = await readState();
    await ensureDirectories();
    const id = nextId(state.assets);
    const safeName = sanitizeFileName(image.fileName || `image-${id}.jpg`);
    const destination = `${assetsRoot}${id}-${safeName}`;
    await FileSystem.copyAsync({ from: image.uri, to: destination });
    const asset: AssetRecord = {
      id,
      project_id: projectId,
      type: assetType,
      file_name: safeName,
      file_path: destination,
      content_path: destination,
      source,
      mime_type: image.mimeType || "image/jpeg",
      metadata_json: roomType ? { room_type: roomType } : {},
      created_at: new Date().toISOString(),
    };
    state.assets.unshift(asset);
    await writeState(state);
    return asset;
  }

  async deleteAsset(assetId: number): Promise<{ deleted: boolean }> {
    const state = await readState();
    const asset = state.assets.find((item) => item.id === assetId);
    if (!asset) return { deleted: false };
    if (asset.content_path?.startsWith(root)) await FileSystem.deleteAsync(asset.content_path, { idempotent: true });
    state.assets = state.assets.filter((item) => item.id !== assetId);
    state.extractedItems = state.extractedItems.filter((item) => item.asset_id !== assetId);
    await writeState(state);
    return { deleted: true };
  }

  assetContentURL(assetId?: number | null): string | undefined {
    if (!assetId) return undefined;
    return localAssetUriCache.get(assetId);
  }

  assetRequestHeaders(): Record<string, string> | undefined {
    return undefined;
  }

  async listTasks(projectId?: number): Promise<TaskRecord[]> {
    const state = await readState();
    refreshAssetCache(state.assets);
    return state.tasks.filter((item) => !projectId || item.project_id === projectId).sort(newestFirst);
  }

  async getTask(taskId: number): Promise<TaskRecord> {
    const task = (await readState()).tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("任务不存在。");
    return task;
  }

  async cancelTask(taskId: number): Promise<TaskRecord> {
    const state = await readState();
    const task = requiredTask(state, taskId);
    task.status = "cancelled";
    task.updated_at = new Date().toISOString();
    await writeState(state);
    return task;
  }

  async retryTask(taskId: number): Promise<TaskRecord> {
    const state = await readState();
    const original = requiredTask(state, taskId);
    if (!original.provider_config_id) throw new Error("当前任务没有可重试的模型线路快照。请回到工作流重新提交。");
    const providerConfigId = original.provider_config_id;
    const sourceAssetIds = numberList(original.params_snapshot_json?.source_asset_ids);
    const sourceAssets = sourceAssetIds.map((id) => state.assets.find((asset) => asset.id === id)).filter(Boolean) as AssetRecord[];
    if (!sourceAssets.length) throw new Error("当前任务的源图片已不存在，无法重试。");
    const now = new Date().toISOString();
    const task: TaskRecord = {
      ...original,
      id: nextId(state.tasks),
      status: "running",
      progress: 10,
      error_message: undefined,
      output_payload_json: undefined,
      created_at: now,
      updated_at: now,
    };
    state.tasks.unshift(task);
    await writeState(state);
    try {
      const runtime = await getLocalModelRuntime(providerConfigId);
      const result = await generateDirectImage({
        config: runtime.config,
        apiKey: runtime.apiKey,
        prompt: task.prompt_snapshot_json?.resolved_prompt || "",
        aspectRatio: String(task.params_snapshot_json?.aspect_ratio || "1:1"),
        sourceUris: sourceAssets.map((asset) => ({
          uri: asset.content_path || asset.file_path,
          fileName: asset.file_name,
          mimeType: asset.mime_type || "image/jpeg",
        })),
      });
      const completed = await readState();
      const currentTask = requiredTask(completed, task.id);
      if (currentTask.status === "cancelled") return currentTask;
      const output = await persistGeneratedImage(completed, task.project_id ?? sourceAssets[0].project_id ?? 0, task.id, result, {
        module: task.module,
        provider: task.provider,
        model: task.model_name,
        sourceAssetIds,
      });
      currentTask.status = "success";
      currentTask.progress = 100;
      currentTask.output_payload_json = { assets: [output], endpoint_used: result.endpoint, retried_from_task_id: original.id };
      currentTask.updated_at = new Date().toISOString();
      await writeState(completed);
      return currentTask;
    } catch (error) {
      const failed = await readState();
      const currentTask = requiredTask(failed, task.id);
      currentTask.status = "failed";
      currentTask.progress = 100;
      currentTask.error_message = error instanceof Error ? error.message : "Provider 重试失败。";
      currentTask.updated_at = new Date().toISOString();
      await writeState(failed);
      return currentTask;
    }
  }

  async submitProviderImageTask(args: {
    projectId: number;
    workflow: WorkflowDefinition;
    assetIds: number[];
    prompt: string;
    style: string;
    roomType: string;
    materialKeywords: string[];
    aspectRatio: string;
    outputMode?: "2d_color" | "3d_birdview";
    provider: string;
    modelName: string;
    providerConfigId?: number | null;
    dataFlowConfirmed: boolean;
    sourceAssetIds?: number[];
    selectedItemIds?: number[];
    reviewSnapshot?: string;
    referenceAssetIds?: number[];
    referenceReviewSnapshot?: string;
    useReferenceImages?: boolean;
    onTaskStarted?: (task: TaskRecord) => void;
  }): Promise<TaskRecord> {
    if (!args.dataFlowConfirmed) throw new Error("发送图片到 Provider 前必须确认数据流。");
    if (!args.providerConfigId) throw new Error("请先在模型页保存图片生成线路。");
    const state = await readState();
    const now = new Date().toISOString();
    const task: TaskRecord = {
      id: nextId(state.tasks),
      project_id: args.projectId,
      module: args.workflow.module,
      task_type: args.workflow.taskType,
      provider: args.provider,
      model_name: args.modelName,
      provider_config_id: args.providerConfigId,
      status: "running",
      progress: 10,
      prompt_snapshot_json: { resolved_prompt: args.prompt },
      params_snapshot_json: {
        style: args.style,
        room_type: args.roomType,
        material_keywords: args.materialKeywords,
        aspect_ratio: args.aspectRatio,
        output_mode: args.outputMode,
        source_asset_ids: args.sourceAssetIds ?? args.assetIds,
        reference_asset_ids: args.referenceAssetIds ?? [],
        data_flow_confirmed: true,
      },
      created_at: now,
      updated_at: now,
    };
    state.tasks.unshift(task);
    await writeState(state);
    args.onTaskStarted?.(task);
    try {
      const runtime = await getLocalModelRuntime(args.providerConfigId);
      const current = await readState();
      const sourceAssets = args.assetIds.map((id) => current.assets.find((asset) => asset.id === id)).filter(Boolean) as AssetRecord[];
      if (!sourceAssets.length) throw new Error("当前任务没有可读取的源图片。");
      const result = await generateDirectImage({
        config: runtime.config,
        apiKey: runtime.apiKey,
        prompt: args.prompt,
        aspectRatio: args.aspectRatio,
        sourceUris: sourceAssets.map((asset) => ({
          uri: asset.content_path || asset.file_path,
          fileName: asset.file_name,
          mimeType: asset.mime_type || "image/jpeg",
        })),
      });
      const completed = await readState();
      const currentTask = requiredTask(completed, task.id);
      if (currentTask.status === "cancelled") return currentTask;
      const output = await persistGeneratedImage(completed, args.projectId, task.id, result, {
        module: args.workflow.module,
        provider: args.provider,
        model: args.modelName,
        sourceAssetIds: args.sourceAssetIds ?? args.assetIds,
      });
      currentTask.status = "success";
      currentTask.progress = 100;
      currentTask.output_payload_json = { assets: [output], endpoint_used: result.endpoint };
      currentTask.updated_at = new Date().toISOString();
      await writeState(completed);
      return currentTask;
    } catch (error) {
      const failed = await readState();
      const currentTask = requiredTask(failed, task.id);
      currentTask.status = "failed";
      currentTask.progress = 100;
      currentTask.error_message = error instanceof Error ? error.message : "Provider 生成失败。";
      currentTask.updated_at = new Date().toISOString();
      await writeState(failed);
      throw new Error(currentTask.error_message);
    }
  }

  async extractBoardItems(args: {
    projectId: number;
    assetId: number;
    roomType: string;
    style: string;
    provider: string;
    modelName: string;
    providerConfigId?: number | null;
    dataFlowConfirmed: boolean;
    workflowSlot: "room_board.extraction" | "multi_room_board.extraction" | "space_render.extraction";
    outputLanguage: "zh-CN" | "en";
    onTaskStarted?: (task: TaskRecord) => void;
  }): Promise<ExtractionResponse> {
    if (!args.dataFlowConfirmed) throw new Error("发送图片到 GLM 前必须确认数据流。");
    if (!args.providerConfigId) throw new Error("请先在模型页保存 GLM 提取线路。");
    const state = await readState();
    const asset = state.assets.find((item) => item.id === args.assetId);
    if (!asset) throw new Error("当前提取图片不存在。");
    const now = new Date().toISOString();
    const task: TaskRecord = {
      id: nextId(state.tasks),
      project_id: args.projectId,
      module: args.workflowSlot.includes("multi") ? "multi_room_board" : args.workflowSlot.startsWith("space") ? "space_render" : "single_room_board",
      task_type: "extract_items",
      provider: args.provider,
      model_name: args.modelName,
      provider_config_id: args.providerConfigId,
      status: "running",
      progress: 10,
      params_snapshot_json: {
        source_asset_ids: [args.assetId],
        room_type: args.roomType,
        style: args.style,
        output_language: args.outputLanguage,
        data_flow_confirmed: true,
      },
      created_at: now,
      updated_at: now,
    };
    state.tasks.unshift(task);
    await writeState(state);
    args.onTaskStarted?.(task);
    try {
      const runtime = await getLocalModelRuntime(args.providerConfigId);
      const extracted = await extractDirectItems({
        config: runtime.config,
        apiKey: runtime.apiKey,
        imageUri: asset.content_path || asset.file_path,
        mimeType: asset.mime_type || "image/jpeg",
        roomType: args.roomType,
        style: args.style,
        outputLanguage: args.outputLanguage,
      });
      const completed = await readState();
      const currentTask = requiredTask(completed, task.id);
      if (currentTask.status === "cancelled") return { task: currentTask, items: [], model_id: args.modelName };
      completed.extractedItems = completed.extractedItems.filter((item) => item.asset_id !== args.assetId);
      const firstId = nextId(completed.extractedItems);
      const items = extracted.map((item, index): ExtractedItem => ({
        ...item,
        id: firstId + index,
        project_id: args.projectId,
        asset_id: args.assetId,
        room_type: args.roomType,
        selection_state: "undecided",
        review_schema_version: 2,
      }));
      completed.extractedItems.push(...items);
      currentTask.status = "success";
      currentTask.progress = 100;
      currentTask.output_payload_json = { extracted_item_count: items.length };
      currentTask.updated_at = new Date().toISOString();
      await writeState(completed);
      return { task: currentTask, items, model_id: args.modelName };
    } catch (error) {
      const failed = await readState();
      const currentTask = requiredTask(failed, task.id);
      currentTask.status = "failed";
      currentTask.progress = 100;
      currentTask.error_message = error instanceof Error ? error.message : "GLM 提取失败。";
      currentTask.updated_at = new Date().toISOString();
      await writeState(failed);
      throw new Error(currentTask.error_message);
    }
  }

  async listExtractedItems(projectId: number, assetId?: number): Promise<ExtractedItem[]> {
    return (await readState()).extractedItems.filter((item) => (
      item.project_id === projectId && (!assetId || item.asset_id === assetId)
    ));
  }

  async updateExtractedItem(itemId: number, payload: {
    selectionState: "keep" | "remove";
    priceMin?: number | null;
    priceMax?: number | null;
    procurementStatus?: "pending" | "purchased";
    quantity?: number | null;
    purchaseMethod?: string;
    purchaseUrl?: string;
  }): Promise<ExtractedItem> {
    const state = await readState();
    const item = state.extractedItems.find((entry) => entry.id === itemId);
    if (!item) throw new Error("提取元素不存在。");
    Object.assign(item, {
      selection_state: payload.selectionState,
      selection_updated_at: new Date().toISOString(),
      price_min: payload.priceMin ?? undefined,
      price_max: payload.priceMax ?? undefined,
      procurement_status: payload.procurementStatus ?? "pending",
      quantity: payload.quantity ?? undefined,
      purchase_method: payload.purchaseMethod ?? "",
      purchase_url: payload.purchaseUrl ?? "",
    });
    await writeState(state);
    return item;
  }

  async generateSingleRoomBoard(args: {
    projectId: number;
    assetId: number;
    roomType: string;
    style: string;
    prompt: string;
    selectedItemIds: number[];
    reviewSnapshot: string;
    generatedAssetId?: number;
    outputLanguage: "zh-CN" | "en";
  }): Promise<unknown> {
    return this.persistBoardDocument({
      projectId: args.projectId,
      mode: "single",
      title: `${args.roomType} ${args.outputLanguage === "en" ? "Design Board" : "方案板"}`,
      style: args.style,
      prompt: args.prompt,
      assetIds: [args.assetId],
      selectedItemIds: args.selectedItemIds,
      reviewSnapshot: args.reviewSnapshot,
      generatedAssetId: args.generatedAssetId,
      outputLanguage: args.outputLanguage,
    });
  }

  async generateMultiRoomBoard(args: {
    projectId: number;
    assetIds: number[];
    style: string;
    selectedItemIds: number[];
    reviewSnapshot: string;
    roomTags: Record<string, string>;
    prompt?: string;
    generatedAssetId?: number;
    outputLanguage: "zh-CN" | "en";
  }): Promise<unknown> {
    return this.persistBoardDocument({
      projectId: args.projectId,
      mode: "multi",
      title: `${args.style} ${args.outputLanguage === "en" ? "Whole-home Board" : "整屋方案板"}`,
      style: args.style,
      prompt: args.prompt ?? "",
      assetIds: args.assetIds,
      selectedItemIds: args.selectedItemIds,
      reviewSnapshot: args.reviewSnapshot,
      roomTags: args.roomTags,
      generatedAssetId: args.generatedAssetId,
      outputLanguage: args.outputLanguage,
    });
  }

  async listPrompts(): Promise<PromptTemplate[]> {
    return (await readState()).prompts;
  }

  async createPrompt(payload: { name: string; module: string; userPrompt: string; negativePrompt?: string; variables: string[] }): Promise<PromptTemplate> {
    const state = await readState();
    const prompt: PromptTemplate = {
      id: nextId(state.prompts),
      name: payload.name,
      module: payload.module,
      scope: "mobile",
      user_prompt: payload.userPrompt,
      negative_prompt: payload.negativePrompt,
      variables_json: payload.variables,
      is_builtin: false,
      is_favorite: false,
      version: 1,
      updated_at: new Date().toISOString(),
    };
    state.prompts.unshift(prompt);
    await writeState(state);
    return prompt;
  }

  async listTemplates(): Promise<CustomTaskTemplate[]> {
    return (await readState()).templates;
  }

  async createTemplate(payload: CustomTaskTemplateDraft = {}): Promise<CustomTaskTemplate> {
    const state = await readState();
    const template: CustomTaskTemplate = {
      id: nextId(state.templates),
      name: payload.name || `自定义模板 ${new Date().toLocaleDateString()}`,
      description: payload.description,
      module_chain_json: payload.moduleChain || ["custom_tasks"],
      input_schema_json: payload.inputSchema || {},
      output_schema_json: payload.outputSchema || {},
      default_provider: payload.defaultProvider,
      default_model: payload.defaultModel,
      export_rules_json: payload.exportRules || { formats: ["png"] },
      is_team_visible: false,
      version: 1,
    };
    state.templates.unshift(template);
    await writeState(state);
    return template;
  }

  async listProviders() {
    return loadLocalModelRoutes();
  }

  async listModulePreferences(): Promise<ModulePreference[]> {
    const providers = await loadLocalModelRoutes();
    const image = providers.find((item) => item.extra_config_json?.mobile_default === true && item.capability === "image")
      ?? providers.find((item) => item.model_name === "gpt-image-2")
      ?? providers.find((item) => item.capability === "image");
    const extraction = providers.find((item) => item.extra_config_json?.mobile_default === true && item.model_name.toLowerCase().startsWith("glm"))
      ?? providers.find((item) => item.model_name.toLowerCase().startsWith("glm"));
    return ["floorplan", "boards", "space_render", "custom_tasks"].map((moduleName, index) => ({
      id: index + 1,
      module_name: moduleName,
      priority_order_json: image ? [image.model_name] : ["gpt-image-2"],
      default_provider_config_id: image?.id ?? null,
      fallback_enabled: false,
    })).concat(["room_board_extraction", "multi_room_board_extraction"].map((moduleName, index) => ({
      id: index + 10,
      module_name: moduleName,
      priority_order_json: extraction ? [extraction.model_name] : ["glm-4.5v"],
      default_provider_config_id: extraction?.id ?? null,
      fallback_enabled: false,
    })));
  }

  async review(projectId: number): Promise<ReviewSnapshot> {
    const state = await readState();
    const assets = state.assets.filter((item) => item.project_id === projectId);
    const tasks = state.tasks.filter((item) => item.project_id === projectId);
    const documents = state.boardDocuments.filter((item) => item.project_id === projectId);
    const extractedItems = state.extractedItems.filter((item) => item.project_id === projectId);
    const exports = state.exports.filter((item) => item.project_id === projectId);
    return {
      project_id: projectId,
      assets,
      board_documents: documents,
      extracted_items: extractedItems,
      versions: [],
      exports,
      replay_entries: tasks.map((task) => ({
        task_id: task.id,
        module: task.module,
        task_type: task.task_type,
        provider: task.provider,
        model_name: task.model_name,
        status: task.status,
        prompt: task.prompt_snapshot_json?.resolved_prompt || "",
        params: task.params_snapshot_json || {},
        created_at: task.created_at,
      })),
      summary: {
        asset_count: assets.length,
        task_count: tasks.length,
        export_count: exports.length,
        version_count: 0,
        board_document_count: documents.length,
        extracted_item_count: extractedItems.length,
        latest_provider: tasks[0]?.provider,
      },
    };
  }

  async exportStructuredTable(payload: {
    projectId: number;
    fileName: string;
    assetIds: number[];
    selectedItemIds: number[];
    reviewSnapshot: string;
    outputLanguage: "zh-CN" | "en";
  }): Promise<unknown> {
    const state = await readState();
    await ensureDirectories();
    const items = state.extractedItems.filter((item) => payload.selectedItemIds.includes(item.id));
    if (!items.length) throw new Error("没有已保留的提取项，无法导出采购表格。");
    const header = payload.outputLanguage === "en"
      ? "Project,Room,Category,Product,Material,Color,Quantity,Minimum Budget,Maximum Budget,Procurement Status,Purchase Method,Purchase URL\r\n"
      : "项目,房间,类型,产品,材质,颜色,数量,最低预算,最高预算,采购状态,购买方式,购买链接\r\n";
    const project = state.projects.find((item) => item.id === payload.projectId);
    const rows = items.map((item) => [
      project?.name || "", item.room_type || "", item.category || "", item.name, item.material || "", item.color || "",
      item.quantity || "", item.price_min || "", item.price_max || "", item.procurement_status || "pending", item.purchase_method || "", item.purchase_url || "",
    ].map(csvCell).join(",")).join("\r\n");
    const path = `${outputsRoot}${sanitizeFileName(payload.fileName)}`;
    await FileSystem.writeAsStringAsync(path, `\uFEFF${header}${rows}`, { encoding: FileSystem.EncodingType.UTF8 });
    const record = { id: nextId(state.exports), project_id: payload.projectId, type: "table", file_name: payload.fileName, file_path: path, content_path: path, created_at: new Date().toISOString() };
    state.exports.unshift(record);
    await writeState(state);
    return record;
  }

  async exportReportImage(payload: {
    projectId: number;
    fileName: string;
    boardDocumentIds: number[];
    mode: "single" | "multi";
    sourceAssetIds: number[];
    selectedItemIds: number[];
    reviewSnapshot: string;
    generatedAssetId?: number;
    title?: string;
    style?: string;
    prompt?: string;
    outputLanguage: "zh-CN" | "en";
  }): Promise<unknown> {
    const state = await readState();
    await ensureDirectories();
    const project = state.projects.find((item) => item.id === payload.projectId);
    if (!project) throw new Error("当前报告所属项目不存在。");
    const sources = payload.sourceAssetIds.map((id) => state.assets.find((asset) => asset.id === id)).filter(Boolean) as AssetRecord[];
    if (!sources.length) throw new Error("当前报告没有可读取的项目图片。");
    const generated = payload.generatedAssetId ? state.assets.find((asset) => asset.id === payload.generatedAssetId) : undefined;
    const hero = generated ?? sources[0];
    const sourceImages = await Promise.all(sources.map(async (asset) => ({
      label: asset.file_name,
      roomType: String(asset.metadata_json?.room_type || ""),
      dataUri: await assetDataUri(asset),
    })));
    const heroMeta = hero.metadata_json ?? {};
    const heroImage = {
      label: hero.file_name,
      dataUri: await assetDataUri(hero),
      generated: Boolean(generated),
      provider: String(heroMeta.provider || ""),
      model: String(heroMeta.model || ""),
    };
    const document = state.boardDocuments.find((item) => payload.boardDocumentIds.includes(item.id));
    const documentData = document?.data_json ?? {};
    const items = state.extractedItems.filter((item) => payload.selectedItemIds.includes(item.id));
    const svg = renderFormalBoardReport({
      project,
      mode: payload.mode,
      title: payload.title || String(document?.title || project.name),
      style: payload.style || String(documentData.style || project.style_tags || ""),
      prompt: payload.prompt || String(documentData.prompt || ""),
      sourceImages,
      heroImage,
      items,
      outputLanguage: payload.outputLanguage,
    });
    const path = `${outputsRoot}${sanitizeFileName(payload.fileName)}`;
    await FileSystem.writeAsStringAsync(path, svg, { encoding: FileSystem.EncodingType.UTF8 });
    const record = { id: nextId(state.exports), project_id: payload.projectId, type: "report_image", file_name: payload.fileName, file_path: path, content_path: path, created_at: new Date().toISOString() };
    state.exports.unshift(record);
    await writeState(state);
    return record;
  }

  private async persistBoardDocument(args: {
    projectId: number;
    mode: "single" | "multi";
    title: string;
    style: string;
    prompt: string;
    assetIds: number[];
    selectedItemIds: number[];
    reviewSnapshot: string;
    roomTags?: Record<string, string>;
    generatedAssetId?: number;
    outputLanguage: "zh-CN" | "en";
  }): Promise<BoardDocument> {
    const state = await readState();
    const structured = boardDocumentData({
      mode: args.mode,
      title: args.title,
      style: args.style,
      prompt: args.prompt,
      sourceAssetIds: args.assetIds,
      generatedAssetId: args.generatedAssetId,
      selectedItemIds: args.selectedItemIds,
      reviewSnapshot: args.reviewSnapshot,
      roomTags: args.roomTags,
      outputLanguage: args.outputLanguage,
    });
    const document: BoardDocument = {
      id: nextId(state.boardDocuments),
      project_id: args.projectId,
      board_type: args.mode === "multi" ? "multi_room" : "single_room",
      title: args.title,
      layout_json: structured.layout,
      data_json: structured.data,
      preview_asset_id: args.generatedAssetId ?? args.assetIds[0] ?? null,
    };
    state.boardDocuments.unshift(document);
    await writeState(state);
    return document;
  }
}

const localAssetUriCache = new Map<number, string>();

async function readState(): Promise<LocalState> {
  await ensureDirectories();
  const info = await FileSystem.getInfoAsync(statePath);
  if (!info.exists) {
    const initial = emptyState();
    await writeState(initial);
    return initial;
  }
  try {
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(statePath));
    const state = { ...emptyState(), ...parsed } as LocalState;
    refreshAssetCache(state.assets);
    return state;
  } catch {
    throw new Error("手机本机项目数据库无法解析。请先导出日志，不要清除应用数据。");
  }
}

async function writeState(state: LocalState): Promise<void> {
  await ensureDirectories();
  await FileSystem.writeAsStringAsync(statePath, JSON.stringify(state), { encoding: FileSystem.EncodingType.UTF8 });
  refreshAssetCache(state.assets);
}

async function ensureDirectories(): Promise<void> {
  if (!FileSystem.documentDirectory) throw new Error("系统没有提供应用文档目录。");
  await FileSystem.makeDirectoryAsync(assetsRoot, { intermediates: true });
  await FileSystem.makeDirectoryAsync(outputsRoot, { intermediates: true });
}

function emptyState(): LocalState {
  return { projects: [], assets: [], tasks: [], prompts: [], templates: [], extractedItems: [], boardDocuments: [], exports: [] };
}

async function persistGeneratedImage(
  state: LocalState,
  projectId: number,
  taskId: number,
  result: { mimeType: string; base64?: string; url?: string },
  metadata: { module: string; provider: string; model: string; sourceAssetIds: number[] },
): Promise<AssetRecord> {
  await ensureDirectories();
  const id = nextId(state.assets);
  const extension = result.mimeType.includes("jpeg") ? "jpg" : result.mimeType.includes("webp") ? "webp" : "png";
  const path = `${outputsRoot}generated-${taskId}-${id}.${extension}`;
  if (result.base64) {
    await FileSystem.writeAsStringAsync(path, result.base64, { encoding: FileSystem.EncodingType.Base64 });
  } else if (result.url) {
    await FileSystem.downloadAsync(result.url, path);
  } else {
    throw new Error("Provider 成功响应中没有可保存的图片。");
  }
  const asset: AssetRecord = {
    id,
    project_id: projectId,
    type: "render_output",
    file_name: `generated-${taskId}.${extension}`,
    file_path: path,
    content_path: path,
    source: "mobile_direct_provider",
    mime_type: result.mimeType,
    metadata_json: {
      module: metadata.module,
      provider: metadata.provider,
      model: metadata.model,
      source_asset_ids: metadata.sourceAssetIds,
      task_id: taskId,
    },
    created_at: new Date().toISOString(),
  };
  state.assets.unshift(asset);
  localAssetUriCache.set(id, path);
  return asset;
}

function refreshAssetCache(assets: AssetRecord[]): void {
  localAssetUriCache.clear();
  assets.forEach((asset) => localAssetUriCache.set(asset.id, asset.content_path || asset.file_path));
}

function nextId(items: Array<{ id: number }>): number {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}

function requiredTask(state: LocalState, taskId: number): TaskRecord {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("任务不存在。");
  return task;
}

function newestFirst(left: { created_at: string }, right: { created_at: string }): number {
  return right.created_at.localeCompare(left.created_at);
}

function sanitizeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").slice(0, 120) || `file-${Date.now()}`;
}

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function numberList(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter((item) => Number.isInteger(item) && item > 0) : [];
}

async function assetDataUri(asset: AssetRecord): Promise<string> {
  const path = asset.content_path || asset.file_path;
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) throw new Error(`报告素材无法读取：${asset.file_name}`);
  const base64 = await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.Base64 });
  return `data:${asset.mime_type || "image/jpeg"};base64,${base64}`;
}
