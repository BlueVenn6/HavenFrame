import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import { Picker } from "@react-native-picker/picker";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { keptItems, reviewedState, reviewSnapshot } from "./src/board-review";
import {
  aspectRatios,
  designStyles,
  interiorPromptPresets,
  isGlmExtractionProvider,
  materialSuggestions,
  mobileExtractionRoutePresets,
  mobileImageRoutePresets,
  roomTypes,
  tabs,
  workflowDefinitions,
} from "./src/constants";
import { isReachableUnverified, isVerifiedConnectivity } from "./src/connectivity";
import { loadLocalModelRoutes, saveLocalModelRoute, testLocalModelRoute } from "./src/local-model-routes";
import { LocalMobileClient } from "./src/local-runtime";
import { localizedError, localizedOption, MobileLocaleProvider, useMobileLocale, type MobileLocale } from "./src/i18n";
import { firstResultAsset, resolveExtractionModel, resolveRunnableModel } from "./src/runtime-selection";
import { colors } from "./src/theme";
import {
  AlertText,
  Button,
  Card,
  ChoiceChips,
  EmptyState,
  Field,
  KeyValue,
  LoadingInline,
  ImageViewerModal,
  PreviewImage,
  SectionTitle,
  StatusPill,
} from "./src/ui";
import type {
  AssetRecord,
  CustomTaskTemplate,
  ExtractedItem,
  ModelConnectivityResult,
  ModulePreference,
  MobileModelRouteDraft,
  PickedImage,
  Project,
  PromptTemplate,
  ProviderConfig,
  ReviewSnapshot,
  ScreenKey,
  TaskRecord,
  WorkflowDefinition,
} from "./src/types";

const SPACE_REFERENCE_ROLES = ["风格与配色", "材质与饰面", "指定家具", "灯光与氛围"] as const;
type SpaceReferenceRole = (typeof SPACE_REFERENCE_ROLES)[number];

export default function App() {
  return <MobileLocaleProvider><AppContent /></MobileLocaleProvider>;
}

function AppContent() {
  const { width } = useWindowDimensions();
  const isTablet = width >= 760;
  const { locale, setLocale, text } = useMobileLocale();
  const clientRef = useRef(new LocalMobileClient());
  const client = clientRef.current;

  const [screen, setScreen] = useState<ScreenKey>("projects");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | undefined>();
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [preferences, setPreferences] = useState<ModulePreference[]>([]);
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [templates, setTemplates] = useState<CustomTaskTemplate[]>([]);
  const [review, setReview] = useState<ReviewSnapshot | undefined>();
  const [modelTests, setModelTests] = useState<ModelConnectivityResult[]>([]);
  const [connection, setConnection] = useState<"local">("local");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [viewerImage, setViewerImage] = useState<{ uri: string; label: string; mimeType?: string | null; headers?: Record<string, string> } | null>(null);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0];

  const run = useCallback(async (operation: () => Promise<void | boolean>, successMessage?: string) => {
    setIsLoading(true);
    setError("");
    setMessage("");
    try {
      const completed = await operation();
      if (completed !== false && successMessage) setMessage(successMessage);
    } catch (caught) {
      setError(caught instanceof Error ? localizedError(caught.message, locale) : text("操作失败。", "Operation failed."));
    } finally {
      setIsLoading(false);
    }
  }, [locale, text]);

  const runReturning = useCallback(async <T,>(operation: () => Promise<T>, successMessage?: string): Promise<T> => {
    setIsLoading(true);
    setError("");
    setMessage("");
    try {
      const result = await operation();
      if (successMessage) setMessage(successMessage);
      return result;
    } catch (caught) {
      const nextError = caught instanceof Error ? localizedError(caught.message, locale) : text("操作失败。", "Operation failed.");
      setError(nextError);
      throw new Error(nextError);
    } finally {
      setIsLoading(false);
    }
  }, [locale, text]);

  const refreshProjectData = useCallback(async (projectId?: number) => {
    if (!projectId) {
      setAssets([]);
      setTasks([]);
      setReview(undefined);
      return;
    }
    const [nextAssets, nextTasks, nextReview] = await Promise.all([
      client.listAssets(projectId),
      client.listTasks(projectId),
      client.review(projectId),
    ]);
    setAssets(nextAssets);
    setTasks(nextTasks);
    setReview(nextReview);
  }, [client]);

  const loadEverything = useCallback(async () => {
    const [nextProjects, nextProviders, nextPreferences, nextPrompts, nextTemplates] = await Promise.all([
      client.listProjects(),
      client.listProviders(),
      client.listModulePreferences(),
      client.listPrompts(),
      client.listTemplates(),
    ]);
    setProjects(nextProjects);
    setProviders(nextProviders);
    setPreferences(nextPreferences);
    setPrompts(nextPrompts);
    setTemplates(nextTemplates);
    const projectId = selectedProjectId ?? nextProjects[0]?.id;
    setSelectedProjectId(projectId);
    await refreshProjectData(projectId);
  }, [client, refreshProjectData, selectedProjectId]);

  useEffect(() => {
    void run(async () => {
      await loadEverything();
      setConnection("local");
    });
  }, [loadEverything, run]);

  useEffect(() => {
    if (!selectedProject?.id) return;
    void run(() => refreshProjectData(selectedProject.id));
  }, [refreshProjectData, run, selectedProject?.id]);

  const openPreview = async (image: { uri?: string; label: string; mimeType?: string | null; headers?: Record<string, string> } | null) => {
    if (!image?.uri) throw new Error(text("没有可预览的图片。", "No image is available to preview."));
    setViewerImage({ uri: image.uri, label: image.label, mimeType: image.mimeType, headers: image.headers });
  };

  const projectOutputs = useMemo(
    () => assets.filter((asset) => ["board_output", "render_output", "floorplan"].includes(asset.type)),
    [assets],
  );
  const runningTasks = tasks.filter((task) => task.status === "queued" || task.status === "running");

  const content = (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.app}>
        <Header
          selectedProject={selectedProject}
          connection={connection}
          runningCount={runningTasks.length}
          locale={locale}
          onLocaleChange={setLocale}
        />
        <View style={styles.navWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.navScroll}
            contentContainerStyle={styles.tabs}
          >
            {tabs.map((tab) => (
              <Pressable
                key={tab.key}
                onPress={() => setScreen(tab.key)}
                style={[styles.tab, screen === tab.key && styles.tabActive]}
              >
                <Text style={[styles.tabText, screen === tab.key && styles.tabTextActive]}>{text(tab.label, mobileTabLabel(tab.key))}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, isTablet && styles.contentTablet]}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => run(loadEverything, text("已刷新。", "Refreshed."))} />}
          keyboardShouldPersistTaps="handled"
        >
          <AlertText text={error} tone="bad" />
          <AlertText text={message} tone="good" />
          {isLoading ? <LoadingInline /> : null}

          {screen === "projects" ? (
            <ProjectsScreen
              projects={projects}
              selectedProject={selectedProject}
              onSelect={(projectId) => setSelectedProjectId(projectId)}
              onCreate={(payload) => run(async () => {
                const project = await client.createProject(payload);
                setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
                setSelectedProjectId(project.id);
                await refreshProjectData(project.id);
              }, text("项目已创建。", "Project created."))}
            />
          ) : null}

          {workflowDefinitions.map((workflow) => screen === workflow.screen ? (
            <WorkflowScreen
              key={workflow.key}
              workflow={workflow}
              selectedProject={selectedProject}
              assets={assets}
              tasks={tasks}
              providers={providers}
              preferences={preferences}
              review={review}
              templates={templates}
              client={client}
              onUploaded={(asset) => setAssets((current) => [asset, ...current])}
              onAssetDeleted={(assetId) => setAssets((current) => current.filter((asset) => asset.id !== assetId))}
              onTask={(task) => {
                setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
                void refreshProjectData(task.project_id ?? selectedProject?.id);
              }}
              onTemplate={(template) => setTemplates((current) => [template, ...current.filter((item) => item.id !== template.id)])}
              onRun={run}
              onRefresh={() => selectedProject && refreshProjectData(selectedProject.id)}
              onOpenPreview={(asset) => run(() => openPreview(asset))}
            />
          ) : null)}

          {screen === "prompts" ? (
            <PromptsScreen
              prompts={prompts}
              onReload={() => run(async () => setPrompts(await client.listPrompts()), text("提示词已刷新。", "Prompts refreshed."))}
              onCreate={(payload) => run(async () => {
                const prompt = await client.createPrompt(payload);
                setPrompts((current) => [prompt, ...current]);
              }, text("提示词草稿已保存。", "Prompt draft saved."))}
            />
          ) : null}

          {screen === "models" ? (
            <ModelsScreen
              providers={providers}
              modelTests={modelTests}
              onRefresh={() => runReturning(async () => {
                setProviders(await loadLocalModelRoutes());
              }, text("模型配置已刷新。", "Model routes refreshed."))}
              onSaveRoute={(payload) => runReturning(async () => {
                const saved = await saveLocalModelRoute(payload);
                setProviders((current) => [saved, ...current.filter((item) => item.id !== saved.id)].sort((a, b) => a.priority - b.priority));
                return saved;
              }, text("模型线路已保存。", "Model route saved."))}
              onTestRoute={(payload) => runReturning(async () => {
                const result = await testLocalModelRoute(payload);
                setModelTests((current) => [result, ...current.filter((item) => modelTestKeyFromResult(item) !== modelTestKeyFromResult(result))]);
                setProviders(await loadLocalModelRoutes());
                return result;
              }, text("安全连通性检测已完成。", "Connection test completed."))}
            />
          ) : null}

          {screen === "archive" ? (
            <ArchiveScreen
              project={selectedProject}
              assets={projectOutputs}
              tasks={tasks}
              review={review}
              client={client}
              onOpenPreview={(asset) => run(() => openPreview(asset))}
              onExport={(format) => selectedProject && run(async () => {
                if (format === "image") {
                  const context = mobileExportContext(review?.assets ?? projectOutputs, review, text);
                  await client.exportReportImage({
                    projectId: selectedProject.id,
                    fileName: `mobile-project-${selectedProject.id}-report.svg`,
                    outputLanguage: locale,
                    ...context,
                  });
                } else {
                  const extractedItems = review?.extracted_items ?? [];
                  const selectedItems = keptItems(extractedItems);
                  if (!selectedItems.length) {
                    throw new Error(text("没有已保留的真实提取项，无法导出采购表格。", "No retained extraction items are available for the procurement export."));
                  }
                  await client.exportStructuredTable({
                    projectId: selectedProject.id,
                    fileName: `mobile-project-${selectedProject.id}-procurement.csv`,
                    assetIds: [...new Set(selectedItems.map((item) => item.asset_id).filter((id): id is number => Boolean(id)))],
                    selectedItemIds: selectedItems.map((item) => item.id),
                    reviewSnapshot: reviewSnapshot(extractedItems),
                    outputLanguage: locale,
                  });
                }
                await refreshProjectData(selectedProject.id);
              }, format === "image" ? text("已创建图片报告。", "Image report created.") : text("已创建采购表格。", "Procurement table created."))}
            />
          ) : null}

          <TaskQueue
            tasks={tasks}
            client={client}
            onRefresh={() => selectedProject && run(() => refreshProjectData(selectedProject.id))}
            onTaskUpdate={(task) => setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)])}
            onRun={run}
          />
        </ScrollView>
      </View>
      <ImageViewerModal visible={Boolean(viewerImage)} image={viewerImage} onClose={() => setViewerImage(null)} />
    </SafeAreaView>
  );

  if (Platform.OS === "ios") {
    return <KeyboardAvoidingView behavior="padding" style={styles.flex}>{content}</KeyboardAvoidingView>;
  }
  return content;
}

function Header({
  selectedProject,
  connection,
  runningCount,
  locale,
  onLocaleChange,
}: {
  selectedProject?: Project;
  connection: "local";
  runningCount: number;
  locale: MobileLocale;
  onLocaleChange: (locale: MobileLocale) => void;
}) {
  const { text } = useMobileLocale();
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={styles.brand}>{text("栖构", "HavenFrame")}</Text>
        <Text style={styles.headerTitle}>{text("室内 AI 交付手机工作台", "Interior AI Delivery Mobile")}</Text>
        <Text style={styles.headerSub}>{selectedProject ? `${text("当前项目", "Current project")}：${selectedProject.name}` : text("先创建或选择项目", "Create or select a project")}</Text>
      </View>
      <View style={styles.headerActions}>
        <View style={styles.headerLocale} accessibilityRole="radiogroup">
          {(["zh-CN", "en"] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: locale === value }}
              onPress={() => onLocaleChange(value)}
              style={[styles.headerLocaleOption, locale === value && styles.headerLocaleOptionActive]}
            >
              <Text style={[styles.headerLocaleText, locale === value && styles.headerLocaleTextActive]}>{value === "zh-CN" ? "中文" : "EN"}</Text>
            </Pressable>
          ))}
        </View>
        <StatusPill
          label={text("本机工作区", "On-device workspace")}
          tone="good"
        />
        <StatusPill label={text(`${runningCount} 个进行中`, `${runningCount} running`)} tone={runningCount ? "warn" : "neutral"} />
      </View>
    </View>
  );
}

function ProjectsScreen({
  projects,
  selectedProject,
  onSelect,
  onCreate,
}: {
  projects: Project[];
  selectedProject?: Project;
  onSelect: (projectId: number) => void;
  onCreate: (payload: { name: string; clientName?: string; styleTags?: string; roomTypes?: string; budgetMin?: number; budgetMax?: number; description?: string }) => void;
}) {
  const { locale, text } = useMobileLocale();
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [styleTags, setStyleTags] = useState(locale === "en" ? "Warm modern, natural materials" : "现代暖调, 自然材质");
  const [roomTypesValue, setRoomTypesValue] = useState(locale === "en" ? "Living room, dining room, bedroom" : "客厅, 餐厅, 卧室");
  const [budgetMin, setBudgetMin] = useState("0");
  const [budgetMax, setBudgetMax] = useState("0");

  return (
    <View style={styles.stack}>
      <Card>
        <SectionTitle eyebrow={text("项目", "Projects")} title={text("创建或选择项目", "Create or select a project")} subtitle={text("手机端上传、生成和回看都会归档到当前项目。", "Uploads, generations, and history are stored in the current on-device project.")} />
        <View style={styles.formGrid}>
          <Field label={text("项目名称", "Project name")} value={name} onChangeText={setName} placeholder={text("例如 港湾 Loft 住宅", "e.g. Harbor Loft Residence")} />
          <Field label={text("客户名称", "Client name")} value={clientName} onChangeText={setClientName} placeholder={text("客户或工作室", "Client or studio")} />
          <Field label={text("风格标签", "Style tags")} value={styleTags} onChangeText={setStyleTags} />
          <Field label={text("空间类型", "Room types")} value={roomTypesValue} onChangeText={setRoomTypesValue} />
          <Field label={text("最低预算", "Minimum budget")} value={budgetMin} onChangeText={setBudgetMin} keyboardType="numeric" />
          <Field label={text("最高预算", "Maximum budget")} value={budgetMax} onChangeText={setBudgetMax} keyboardType="numeric" />
        </View>
        <Button
          disabled={!name.trim()}
          onPress={() => {
            onCreate({
              name,
              clientName,
              styleTags,
              roomTypes: roomTypesValue,
              budgetMin: Number(budgetMin || 0),
              budgetMax: Number(budgetMax || 0),
              description: text("从手机端创建，用于现场上传、生成和复盘。", "Created on mobile for field uploads, generation, and review."),
            });
            setName("");
          }}
        >
          {text("创建项目", "Create project")}
        </Button>
      </Card>

      <Card>
        <SectionTitle eyebrow={text("项目归档", "Project archive")} title={text("项目列表", "Project list")} subtitle={text(`${projects.length} 个项目`, `${projects.length} projects`)} />
        {projects.length ? projects.map((project) => (
          <Pressable
            key={project.id}
            onPress={() => onSelect(project.id)}
            style={[styles.item, selectedProject?.id === project.id && styles.itemActive]}
          >
            <View style={styles.itemMain}>
              <Text style={styles.itemTitle}>{project.name}</Text>
              <Text style={styles.itemSub}>{project.client_name || text("未填写客户", "No client")} · {project.style_tags || text("未填写风格", "No style")}</Text>
            </View>
            <StatusPill label={selectedProject?.id === project.id ? text("当前", "Current") : project.status || text("项目", "Project")} tone={selectedProject?.id === project.id ? "good" : "neutral"} />
          </Pressable>
        )) : <EmptyState text={text("还没有项目。先创建项目再上传图片。", "No projects yet. Create one before uploading images.")} />}
      </Card>
    </View>
  );
}

function WorkflowScreen({
  workflow,
  selectedProject,
  assets,
  tasks,
  providers,
  preferences,
  review,
  templates,
  client,
  onUploaded,
  onAssetDeleted,
  onTask,
  onTemplate,
  onRun,
  onRefresh,
  onOpenPreview,
}: {
  workflow: WorkflowDefinition;
  selectedProject?: Project;
  assets: AssetRecord[];
  tasks: TaskRecord[];
  providers: ProviderConfig[];
  preferences: ModulePreference[];
  review?: ReviewSnapshot;
  templates: CustomTaskTemplate[];
  client: LocalMobileClient;
  onUploaded: (asset: AssetRecord) => void;
  onAssetDeleted: (assetId: number) => void;
  onTask: (task: TaskRecord) => void;
  onTemplate: (template: CustomTaskTemplate) => void;
  onRun: (operation: () => Promise<void | boolean>, successMessage?: string) => void;
  onRefresh: () => Promise<void> | void;
  onOpenPreview: (asset: { uri?: string; label: string; mimeType?: string | null; headers?: Record<string, string> } | null) => void;
}) {
  const { locale, text } = useMobileLocale();
  const [pickedImages, setPickedImages] = useState<PickedImage[]>([]);
  const [referencePickedImages, setReferencePickedImages] = useState<PickedImage[]>([]);
  const [referenceAssetIds, setReferenceAssetIds] = useState<number[]>([]);
  const [referenceRoles, setReferenceRoles] = useState<Record<number, SpaceReferenceRole>>({});
  const [useReferenceImages, setUseReferenceImages] = useState(true);
  const [prompt, setPrompt] = useState(locale === "en" ? workflow.defaultPromptEn : workflow.defaultPrompt);
  const [style, setStyle] = useState(workflow.defaultStyle);
  const [roomType, setRoomType] = useState("客厅");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [floorplanOutputMode, setFloorplanOutputMode] = useState<"2d_color" | "3d_birdview">("2d_color");
  const [materialText, setMaterialText] = useState("胡桃木, 洞石, 亚麻");
  const model = resolveRunnableModel(providers, preferences, workflow.module);
  const extractionModel = workflow.key === "singleRoom" || workflow.key === "multiRoom" || workflow.key === "spaceRender"
    ? resolveExtractionModel(
      providers,
      preferences,
      workflow.key === "multiRoom" ? "multi_room_board" : workflow.key === "spaceRender" ? "space_render" : "single_room_board",
    )
    : undefined;
  const relatedAssets = assets.filter((asset) => asset.source === workflow.source || asset.type === workflow.assetType);
  const [activeAssetIds, setActiveAssetIds] = useState<number[]>([]);
  const activeAssets = activeAssetIds.map((id) => assets.find((asset) => asset.id === id)).filter(Boolean) as AssetRecord[];
  const boardItems = (review?.extracted_items ?? []).filter((item) => item.asset_id && activeAssetIds.includes(item.asset_id));
  const boardWorkflow = workflow.key === "singleRoom" || workflow.key === "multiRoom";
  const spaceReferenceAssets = referenceAssetIds.map((id) => assets.find((asset) => asset.id === id)).filter(Boolean) as AssetRecord[];
  const spaceReferenceItems = (review?.extracted_items ?? []).filter((item) => item.asset_id && referenceAssetIds.includes(item.asset_id));
  const selectedSpaceReferenceItems = spaceReferenceItems.filter((item) => (
    reviewedState(item) === "keep"
    && item.asset_id != null
    && item.room_type === `参考图：${referenceRoles[item.asset_id] ?? "风格与配色"}`
  ));
  const activeSpaceReferenceAssets = workflow.key === "spaceRender" && useReferenceImages ? spaceReferenceAssets : [];
  const referenceSnapshot = JSON.stringify({
    version: 1,
    use_reference_images: useReferenceImages,
    references: activeSpaceReferenceAssets.map((asset) => ({
      asset_id: asset.id,
      role: referenceRoles[asset.id] ?? "风格与配色",
      items: spaceReferenceItems
        .filter((item) => item.asset_id === asset.id && item.room_type === `参考图：${referenceRoles[asset.id] ?? "风格与配色"}`)
        .map((item) => ({ id: item.id, state: reviewedState(item), name: item.name, color: item.color ?? null, color_hex: item.color_hex ?? null })),
    })),
  });
  const selectedBoardItems = keptItems(boardItems);
  const currentReviewSnapshot = reviewSnapshot(boardItems);
  const relatedTasks = tasks.filter((task) => task.module === workflow.module);
  const latestResult = relatedTasks.map(firstResultAsset).find(Boolean);
  const customTemplates = templates.filter((template) => template.module_chain_json.includes("custom_tasks"));
  const canUseTemplates = workflow.key === "customTasks";

  const confirmExternalTransfer = (kind: "generation" | "extraction", assetCount: number, provider: string, modelName: string): Promise<boolean> => new Promise((resolve) => {
    const displayProvider = taskProviderLabel(provider, text);
    Alert.alert(
      text(kind === "generation" ? "确认真实图片生成" : "确认多模态信息提取", kind === "generation" ? "Confirm real image generation" : "Confirm multimodal extraction"),
      text(
        `将向 ${displayProvider} / ${modelName} 发送 ${assetCount} 张项目图片。确认你有权上传这些素材；返回结果会保存到当前本机项目。`,
        `${assetCount} project image(s) will be sent to ${displayProvider} / ${modelName}. Confirm that you are authorized to upload them. Results will be saved to the current on-device project.`,
      ),
      [
        { text: text("取消", "Cancel"), style: "cancel", onPress: () => resolve(false) },
        { text: text("确认并继续", "Confirm and continue"), onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });

  useEffect(() => {
    setPickedImages([]);
    setReferencePickedImages([]);
    setActiveAssetIds([]);
    setReferenceAssetIds([]);
    setReferenceRoles({});
  }, [selectedProject?.id, workflow.key]);

  const pickImages = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: workflow.requiresMultiple,
      quality: 0.9,
      selectionLimit: workflow.requiresMultiple ? 8 : 1,
    });
    if (result.canceled) return;
    const images = result.assets.map((asset, index) => ({
      uri: asset.uri,
      fileName: asset.fileName || `${workflow.key}-${Date.now()}-${index}.jpg`,
      mimeType: asset.mimeType || "image/jpeg",
    }));
    setPickedImages(images);
  };

  const removePickedImage = (uri: string) => setPickedImages((current) => current.filter((image) => image.uri !== uri));

  const pickReferenceImages = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.9,
      selectionLimit: 3,
    });
    if (result.canceled) return;
    setReferencePickedImages(result.assets.slice(0, 3).map((asset, index) => ({
      uri: asset.uri,
      fileName: asset.fileName || `space-reference-${Date.now()}-${index}.jpg`,
      mimeType: asset.mimeType || "image/jpeg",
    })));
  };

  const uploadReferenceImages = async () => {
    if (!selectedProject) throw new Error(text("请先选择项目。", "Select a project first."));
    if (!referencePickedImages.length) throw new Error(text("请先选择参考图。", "Select reference images first."));
    const uploadedIds: number[] = [];
    const nextRoles: Record<number, SpaceReferenceRole> = {};
    for (const image of referencePickedImages) {
      const uploaded = await client.uploadAsset(selectedProject.id, image, "space_reference", "space_render_reference", "空间参考图");
      onUploaded(uploaded);
      uploadedIds.push(uploaded.id);
      nextRoles[uploaded.id] = "风格与配色";
    }
    setReferenceAssetIds(uploadedIds);
    setReferenceRoles(nextRoles);
    setReferencePickedImages([]);
    setUseReferenceImages(true);
    await onRefresh();
  };

  const deleteReferenceAsset = async (assetId: number) => {
    await client.deleteAsset(assetId);
    setReferenceAssetIds((current) => current.filter((id) => id !== assetId));
    setReferenceRoles((current) => {
      const next = { ...current };
      delete next[assetId];
      return next;
    });
    onAssetDeleted(assetId);
    await onRefresh();
  };

  const extractSpaceReferences = async () => {
    if (!selectedProject) throw new Error(text("请先选择项目。", "Select a project first."));
    if (!extractionModel) throw new Error(text("GLM 多模态提取模型未配置。", "The GLM multimodal extraction model is not configured."));
    if (!referenceAssetIds.length) throw new Error(text("请先上传参考图。", "Upload reference images first."));
    if (!await confirmExternalTransfer("extraction", referenceAssetIds.length, extractionModel.provider, extractionModel.modelName)) return false;
    for (const assetId of referenceAssetIds) {
      const role = referenceRoles[assetId] ?? "风格与配色";
      await client.extractBoardItems({
        projectId: selectedProject.id,
        assetId,
        roomType: `参考图：${role}`,
        style: role,
        provider: extractionModel.provider,
        modelName: extractionModel.modelName,
        providerConfigId: extractionModel.providerConfigId,
        dataFlowConfirmed: true,
        outputLanguage: locale,
        workflowSlot: "space_render.extraction",
        onTaskStarted: onTask,
      });
    }
    await onRefresh();
    return true;
  };

  const saveReferenceItem = async (item: ExtractedItem, selectionState: "keep" | "remove") => {
    await client.updateExtractedItem(item.id, { selectionState });
    await onRefresh();
  };

  const uploadImages = async () => {
    if (!selectedProject) throw new Error(text("请先选择项目。", "Select a project first."));
    if (!pickedImages.length) throw new Error(text("请先选择图片。", "Select images first."));
    const uploadedIds: number[] = [];
    for (const image of pickedImages) {
      const uploaded = await client.uploadAsset(selectedProject.id, image, workflow.assetType, workflow.source, roomType);
      onUploaded(uploaded);
      uploadedIds.push(uploaded.id);
    }
    setActiveAssetIds(uploadedIds);
    setPickedImages([]);
    await onRefresh();
  };

  const deleteUploadedAsset = async (assetId: number) => {
    await client.deleteAsset(assetId);
    setActiveAssetIds((current) => current.filter((id) => id !== assetId));
    onAssetDeleted(assetId);
    await onRefresh();
  };

  const extractBoard = async () => {
    if (!selectedProject) throw new Error(text("请先选择项目。", "Select a project first."));
    if (!extractionModel) throw new Error(text("GLM 多模态提取模型未配置。", "The GLM multimodal extraction model is not configured."));
    if (!activeAssetIds.length) throw new Error(text("请先上传并选择当前图片。", "Upload and select the current images first."));
    if (!await confirmExternalTransfer("extraction", activeAssetIds.length, extractionModel.provider, extractionModel.modelName)) return false;
    for (let index = 0; index < activeAssetIds.length; index += 1) {
      await client.extractBoardItems({
        projectId: selectedProject.id,
        assetId: activeAssetIds[index],
        roomType: workflow.key === "multiRoom" ? `${roomType} ${index + 1}` : roomType,
        style,
        provider: extractionModel.provider,
        modelName: extractionModel.modelName,
        providerConfigId: extractionModel.providerConfigId,
        dataFlowConfirmed: true,
        outputLanguage: locale,
        workflowSlot: workflow.key === "multiRoom" ? "multi_room_board.extraction" : "room_board.extraction",
        onTaskStarted: onTask,
      });
    }
    await onRefresh();
    return true;
  };

  const saveBoardItem = async (item: ExtractedItem, input: BoardItemInput) => {
    await client.updateExtractedItem(item.id, input);
    await onRefresh();
  };

  const generateBoardReport = async () => {
    if (!selectedProject) throw new Error(text("请先选择项目。", "Select a project first."));
    if (!activeAssetIds.length) throw new Error(text("请先上传图片。", "Upload images first."));
    if (workflow.key === "singleRoom") {
      await client.generateSingleRoomBoard({
        projectId: selectedProject.id,
        assetId: activeAssetIds[0],
        roomType,
        style,
        prompt,
        selectedItemIds: selectedBoardItems.map((item) => item.id),
        reviewSnapshot: currentReviewSnapshot,
        generatedAssetId: latestResult?.id,
        outputLanguage: locale,
      });
    } else if (workflow.key === "multiRoom") {
      if (activeAssetIds.length < 2) throw new Error(text("多房间报告至少需要 2 张当前图片。", "A multi-room report requires at least two current images."));
      await client.generateMultiRoomBoard({
        projectId: selectedProject.id,
        assetIds: activeAssetIds,
        style,
        prompt,
        selectedItemIds: selectedBoardItems.map((item) => item.id),
        reviewSnapshot: currentReviewSnapshot,
        roomTags: Object.fromEntries(activeAssetIds.map((id, index) => [String(id), `${roomType} ${index + 1}`])),
        generatedAssetId: latestResult?.id,
        outputLanguage: locale,
      });
    } else {
      throw new Error(text("当前工作流不生成方案板报告。", "This workflow does not generate a board report."));
    }
    await onRefresh();
  };

  const exportBoardReport = async () => {
    if (!selectedProject) throw new Error(text("请先选择项目。", "Select a project first."));
    if (!activeAssetIds.length) throw new Error(text("请先上传图片。", "Upload images first."));
    if (!boardWorkflow) throw new Error(text("当前工作流不导出方案板报告。", "This workflow does not export board reports."));
    const boardType = workflow.key === "multiRoom" ? "multi_room" : "single_room";
    const documentIds = (review?.board_documents ?? []).filter((document) => document.board_type === boardType).slice(0, 1).map((document) => document.id);
    await client.exportReportImage({
      projectId: selectedProject.id,
      fileName: `${workflow.key === "multiRoom" ? "multi-room" : "single-room"}-board-report.svg`,
      boardDocumentIds: documentIds,
      mode: workflow.key === "multiRoom" ? "multi" : "single",
      sourceAssetIds: activeAssetIds,
      selectedItemIds: selectedBoardItems.map((item) => item.id),
      reviewSnapshot: currentReviewSnapshot,
      generatedAssetId: latestResult?.id,
      title: workflow.key === "multiRoom" ? text("多房间方案板", "Multi-room Design Board") : text("单房间方案板", "Single-room Design Board"),
      style,
      prompt,
      outputLanguage: locale,
    });
    await onRefresh();
  };

  const submitImage = async () => {
    if (!selectedProject) throw new Error(text("请先选择项目。", "Select a project first."));
    if (!model.isConfigured) throw new Error(text("当前工作流没有可运行的图片生成模型，请先在模型页保存线路。", "No runnable image model is configured for this workflow. Save a route on the Models screen first."));
    const assetIds = activeAssetIds;
    if (!assetIds.length) throw new Error(text("请先上传图片。", "Upload images first."));
    const referenceSummary = activeSpaceReferenceAssets.map((asset, index) => {
      const role = referenceRoles[asset.id] ?? "风格与配色";
      const adopted = selectedSpaceReferenceItems.filter((item) => item.asset_id === asset.id).map((item) => `${item.name}${item.color ? `，${item.color}` : ""}${item.color_hex ? `（${item.color_hex}）` : ""}`);
      return text(
        `参考图 ${index + 1}（${role}）：${adopted.length ? adopted.join("；") : "按该角色整体参考"}`,
        `Reference ${index + 1} (${localizedOption(role, locale)}): ${adopted.length ? adopted.join("; ") : "use the overall reference for this role"}`,
      );
    }).join("。 ");
    const taskAssetIds = [...assetIds, ...activeSpaceReferenceAssets.map((asset) => asset.id)];
    const effectivePrompt = workflow.key === "spaceRender" && activeSpaceReferenceAssets.length
      ? text(
        `${prompt}。第 1 张图是唯一源空间，必须保留结构、视角、门窗和墙地关系；后续图片仅作参考，不得复制其空间结构。${referenceSummary}`,
        `${prompt}. The first image is the only source space: preserve its structure, camera view, doors, windows, walls, and floor. Later images are references only and their spatial structure must not be copied. ${referenceSummary}`,
      )
      : prompt;

    if (workflow.key === "multiRoom") {
      if (assetIds.length < 2) throw new Error(text("多房间方案板至少需要 2 张当前图片。", "A multi-room board requires at least two current images."));
    }
    if (!await confirmExternalTransfer("generation", taskAssetIds.length, model.provider, model.modelName)) return false;

    const task = await client.submitProviderImageTask({
      projectId: selectedProject.id,
      workflow,
      assetIds: taskAssetIds,
      sourceAssetIds: assetIds,
      prompt: workflow.key === "floorplan"
        ? text(
          `${effectivePrompt}。输出类型：${floorplanOutputMode === "2d_color" ? "2D 彩色平面图" : "3D 鸟瞰图"}。`,
          `${effectivePrompt}. Output type: ${floorplanOutputMode === "2d_color" ? "2D color floor plan" : "3D bird's-eye view"}.`,
        )
        : effectivePrompt,
      style,
      roomType,
      materialKeywords: splitKeywords(materialText),
      aspectRatio,
      outputMode: workflow.key === "floorplan" ? floorplanOutputMode : undefined,
      provider: model.provider,
      modelName: model.modelName,
      providerConfigId: model.providerConfigId,
      dataFlowConfirmed: true,
      selectedItemIds: boardWorkflow ? selectedBoardItems.map((item) => item.id) : undefined,
      reviewSnapshot: boardWorkflow ? currentReviewSnapshot : undefined,
      referenceAssetIds: activeSpaceReferenceAssets.map((asset) => asset.id),
      referenceReviewSnapshot: workflow.key === "spaceRender" ? referenceSnapshot : undefined,
      useReferenceImages: workflow.key === "spaceRender" ? useReferenceImages : false,
      onTaskStarted: onTask,
    });
    onTask(task);
    return true;
  };

  const createReusableTemplate = async () => {
    if (!model.isConfigured) throw new Error(text("当前工作流没有可运行的图片生成模型，不能保存带有虚假默认线路的模板。", "No runnable image model is configured, so this template cannot be saved with a placeholder route."));
    const template = await client.createTemplate({
      name: text(`${style}现场模板`, `${localizedOption(style, locale)} field template`),
      description: text(`手机端保存：${prompt.slice(0, 48)}`, `Saved on mobile: ${prompt.slice(0, 48)}`),
      defaultProvider: model.provider,
      defaultModel: model.modelName,
      inputSchema: {
        required: ["reference_image"],
        optional: ["prompt", "style", "room_type", "material_keywords", "aspect_ratio"],
        defaults: {
          prompt,
          style,
          room_type: roomType,
          material_keywords: splitKeywords(materialText),
          aspect_ratio: aspectRatio,
        },
      },
      outputSchema: { outputs: ["render_output"], aspect_ratio: aspectRatio },
      exportRules: { formats: ["png"], archive: true },
    });
    onTemplate(template);
  };

  const applyTemplate = (template: CustomTaskTemplate) => {
    const defaults = template.input_schema_json?.defaults;
    if (isRecord(defaults)) {
      if (typeof defaults.prompt === "string") setPrompt(defaults.prompt);
      if (typeof defaults.style === "string") setStyle(defaults.style);
      if (typeof defaults.room_type === "string") setRoomType(defaults.room_type);
      if (typeof defaults.aspect_ratio === "string") setAspectRatio(defaults.aspect_ratio);
      if (Array.isArray(defaults.material_keywords)) setMaterialText(defaults.material_keywords.map(String).join(", "));
    }
  };

  return (
    <View style={styles.stack}>
      <Card>
        <SectionTitle eyebrow={text(workflow.shortTitle, workflow.shortTitleEn)} title={text(workflow.title, workflow.titleEn)} subtitle={text(workflow.uploadTitle, workflow.uploadTitleEn)} />
        <View style={styles.previewGrid}>
          {pickedImages.length ? pickedImages.slice(0, 4).map((image) => (
            <View key={image.uri} style={styles.pickedImage}>
              <PreviewImage uri={image.uri} label={text("已选择图片", "Selected image")} />
              <Button variant="danger" onPress={() => removePickedImage(image.uri)}>{text("移除", "Remove")}</Button>
            </View>
          )) : <PreviewImage label={text("选择图片后预览", "Select images to preview")} />}
        </View>
        <View style={styles.row}>
          <Button variant="secondary" onPress={() => onRun(pickImages)}>{text("选择图片", "Select images")}</Button>
          <Button disabled={!pickedImages.length || !selectedProject} onPress={() => onRun(uploadImages, text("图片已上传。", "Images uploaded."))}>{text("上传到项目", "Upload to project")}</Button>
        </View>
        <Text style={styles.note}>{text(`当前输入：${activeAssets.length} 张 · 项目历史素材：${relatedAssets.length} 张`, `Current input: ${activeAssets.length} · Project assets: ${relatedAssets.length}`)}</Text>
        {activeAssets.length ? (
          <View style={styles.assetStrip}>
            {activeAssets.slice(0, 8).map((asset) => (
              <View key={asset.id} style={styles.assetThumb}>
                <Pressable onPress={() => onOpenPreview({ uri: client.assetContentURL(asset.id), label: asset.file_name, mimeType: asset.mime_type, headers: client.assetRequestHeaders() })}>
                <PreviewImage
                  uri={client.assetContentURL(asset.id)}
                  headers={client.assetRequestHeaders()}
                  label={asset.file_name}
                  mimeType={asset.mime_type}
                  containerStyle={styles.assetThumbPreview}
                />
                </Pressable>
                <Button variant="danger" onPress={() => onRun(() => deleteUploadedAsset(asset.id), text("素材已从当前项目删除。", "Asset removed from this project."))}>{text("删除", "Delete")}</Button>
              </View>
            ))}
          </View>
        ) : null}
      </Card>

      {workflow.key === "spaceRender" ? (
        <Card>
          <SectionTitle eyebrow={text("可选参考图", "Optional references")} title={text("风格、配色、家具和灯光参考", "Style, color, furniture, and lighting references")} subtitle={text("可上传 1-3 张；不上传或关闭参考图时，仍可只按风格和提示词生成。", "Upload 1-3 images, or generate from style and prompt without references.")} />
          <View style={styles.previewGrid}>
            {referencePickedImages.map((image) => (
              <View key={image.uri} style={styles.pickedImage}>
                <PreviewImage uri={image.uri} label={text("待上传参考图", "Reference pending upload")} />
                <Button variant="danger" onPress={() => setReferencePickedImages((current) => current.filter((item) => item.uri !== image.uri))}>{text("移除", "Remove")}</Button>
              </View>
            ))}
          </View>
          <View style={styles.row}>
            <Button variant="secondary" onPress={() => onRun(pickReferenceImages)}>{text("选择参考图", "Select references")}</Button>
            <Button disabled={!referencePickedImages.length || !selectedProject} onPress={() => onRun(uploadReferenceImages, text("参考图已上传。", "References uploaded."))}>{text("上传参考图", "Upload references")}</Button>
          </View>
          {spaceReferenceAssets.length ? (
            <ChoiceChips options={["使用参考图", "不使用参考图"] as const} value={useReferenceImages ? "使用参考图" : "不使用参考图"} onChange={(value) => setUseReferenceImages(value === "使用参考图")} labelForOption={(value) => localizedOption(value, locale)} />
          ) : null}
          <View style={styles.reviewGrid}>
            {spaceReferenceAssets.map((asset, index) => {
              const role = referenceRoles[asset.id] ?? "风格与配色";
              const assetItems = spaceReferenceItems.filter((item) => item.asset_id === asset.id && item.room_type === `参考图：${role}`);
              return (
                <View key={asset.id} style={styles.reviewItem}>
                  <Text style={styles.itemTitle}>{text(`参考图 ${index + 1}`, `Reference ${index + 1}`)}</Text>
                  <PreviewImage uri={client.assetContentURL(asset.id)} headers={client.assetRequestHeaders()} label={asset.file_name} mimeType={asset.mime_type} />
                  <ChoiceChips options={[...SPACE_REFERENCE_ROLES]} value={role} onChange={(nextRole) => setReferenceRoles((current) => ({ ...current, [asset.id]: nextRole }))} labelForOption={(value) => localizedOption(value, locale)} />
                  <Button variant="danger" onPress={() => onRun(() => deleteReferenceAsset(asset.id), text("参考图已删除。", "Reference deleted."))}>{text("删除参考图", "Delete reference")}</Button>
                  {assetItems.map((item) => (
                    <View key={item.id} style={styles.referenceItem}>
                      <View style={styles.routeHeader}>
                        <View style={styles.itemMain}>
                          <Text style={styles.itemTitle}>{item.name}</Text>
                          <Text style={styles.itemSub}>{item.material || item.category || text("参考特征", "Reference attribute")} · {item.color || text("颜色待确认", "Color pending")}</Text>
                          {item.color_hex ? <Text style={styles.itemMeta}>{text("推断色号", "Inferred color")}：{item.color_hex}</Text> : null}
                          {item.bbox ? <Text style={styles.itemMeta}>{text("图中定位", "Image location")}：{formatBoundingBox(item.bbox, text)}</Text> : null}
                        </View>
                        <StatusPill label={reviewedState(item) === "keep" ? text("采用", "Use") : reviewedState(item) === "remove" ? text("忽略", "Ignore") : text("待确认", "Pending")} tone={reviewedState(item) === "keep" ? "good" : reviewedState(item) === "remove" ? "bad" : "warn"} />
                      </View>
                      <View style={styles.row}>
                        <Button onPress={() => onRun(() => saveReferenceItem(item, "keep"), text("参考元素已采用。", "Reference attribute selected."))}>{text("采用", "Use")}</Button>
                        <Button variant="danger" onPress={() => onRun(() => saveReferenceItem(item, "remove"), text("参考元素已忽略。", "Reference attribute ignored."))}>{text("忽略", "Ignore")}</Button>
                      </View>
                    </View>
                  ))}
                </View>
              );
            })}
          </View>
          <Button disabled={!spaceReferenceAssets.length || !extractionModel} onPress={() => onRun(extractSpaceReferences, text("GLM 参考图提取已完成。", "GLM reference extraction completed."))}>{text("GLM 提取参考图", "Extract references with GLM")}</Button>
          <Text style={styles.note}>{text("GLM 提取是可选精细控制，不会阻止空间渲染生成。", "GLM extraction is optional and never blocks rendering.")}</Text>
        </Card>
      ) : null}

      {boardWorkflow ? (
        <Card>
          <SectionTitle eyebrow={text("可选辅助", "Optional tools")} title={text("GLM 多模态提取与报告内容", "GLM Multimodal Extraction and Report Content")} subtitle={text("提取、人工确认、预算和采购信息均为可选；可直接生成报告内容或方案板图片。", "Extraction, review, budget, and procurement data are optional. Reports and board images can be generated independently.")} />
          <View style={styles.row}>
            <Button disabled={!activeAssetIds.length || !extractionModel} onPress={() => onRun(extractBoard, text("GLM 提取结果已写入项目。", "GLM extraction saved to the project."))}>{text("提取当前图片", "Extract current images")}</Button>
            <Button variant="secondary" disabled={!activeAssetIds.length} onPress={() => onRun(generateBoardReport, text("结构化报告内容已保存。", "Structured report content saved."))}>{text("保存报告内容", "Save report content")}</Button>
            <Button variant="secondary" disabled={!activeAssetIds.length} onPress={() => onRun(exportBoardReport, text("正式图片报告已导出。", "Formal image report exported."))}>{text("导出图片报告", "Export image report")}</Button>
          </View>
          <View style={styles.reviewGrid}>
            {boardItems.length ? boardItems.map((item) => (
              <MobileBoardReviewItem key={item.id} item={item} onSave={(input) => saveBoardItem(item, input)} />
            )) : <EmptyState text={text("还没有当前图片的提取结果。", "No extraction results for the current images.")} />}
          </View>
          <Text style={styles.note}>{text("报告内容、图片生成、GLM 提取、人工确认和预算可以分别执行。", "Report content, image generation, GLM extraction, review, and budget can run independently.")}</Text>
        </Card>
      ) : null}

      {canUseTemplates ? (
        <Card>
          <SectionTitle eyebrow={text("可复用模板", "Reusable templates")} title={text("自定义任务模板", "Custom task templates")} subtitle={text("保存当前设置，后续现场可一键套用。", "Save these settings for reuse on future jobs.")} />
          <View style={styles.row}>
            <Button disabled={!model.isConfigured} onPress={() => onRun(createReusableTemplate, text("自定义模板已创建。", "Custom template created."))}>{text("保存为模板", "Save as template")}</Button>
          </View>
          {customTemplates.length ? customTemplates.map((template) => (
            <View key={template.id} style={styles.item}>
              <View style={styles.itemMain}>
                <Text style={styles.itemTitle}>{template.name}</Text>
                <Text style={styles.itemSub}>{taskProviderLabel(template.default_provider || "OpenAI", text)} / {template.default_model || "gpt-image-2"} · v{template.version}</Text>
                <Text style={styles.itemMeta} numberOfLines={2}>{template.description || text("可复用手机端自定义任务模板", "Reusable mobile custom task template")}</Text>
              </View>
              <Button variant="secondary" onPress={() => applyTemplate(template)}>{text("套用", "Apply")}</Button>
            </View>
          )) : <EmptyState text={text("还没有自定义模板。保存一次当前设置即可复用。", "No custom templates yet. Save the current settings to reuse them.")} />}
        </Card>
      ) : null}

      <Card>
        <SectionTitle eyebrow={text("生成设置", "Generation settings")} title={text("提示词、比例和模型", "Prompt, aspect ratio, and model")} />
        <View style={styles.formGrid}>
          {workflow.key === "floorplan" ? (
            <View style={styles.stack}>
              <Text style={styles.fieldLabel}>{text("输出类型", "Output type")}</Text>
              <ChoiceChips
                options={["2d_color", "3d_birdview"] as const}
                value={floorplanOutputMode}
                onChange={setFloorplanOutputMode}
                labelForOption={(value) => value === "2d_color" ? text("2D 彩色平面图", "2D color floor plan") : text("3D 鸟瞰图", "3D bird's-eye view")}
              />
            </View>
          ) : null}
          <ChoiceChips options={roomTypes} value={roomType} onChange={setRoomType} labelForOption={(value) => localizedOption(value, locale)} />
          <ChoiceChips options={designStyles} value={style} onChange={setStyle} labelForOption={(value) => localizedOption(value, locale)} />
          <ChoiceChips options={aspectRatios} value={aspectRatio} onChange={setAspectRatio} />
          <ChoiceChips
            options={materialSuggestions}
            value={splitKeywords(materialText)[0] || materialSuggestions[0]}
            onChange={(value) => setMaterialText((current) => mergeKeyword(current, value))}
            labelForOption={(value) => localizedOption(value, locale)}
          />
          <Field label={text("提示词", "Prompt")} value={prompt} onChangeText={setPrompt} multiline />
          <Field label={text("材质关键词", "Material keywords")} value={materialText} onChangeText={setMaterialText} />
        </View>
        <View style={styles.modelBox}>
          <Text style={styles.modelTitle}>{model.isConfigured ? text(`实际调用：${taskProviderLabel(model.provider, text)} / ${model.modelName}`, `Actual route: ${taskProviderLabel(model.provider, text)} / ${model.modelName}`) : text("未配置可运行的图片生成模型", "No runnable image model configured")}</Text>
          <Text style={styles.modelSub}>{text("手机端使用系统安全存储中的 Key 直接调用当前 Provider，结果保存到本机项目。", "The app calls the selected Provider with the key in secure storage and saves results to the on-device project.")}</Text>
        </View>
        <Text style={styles.note}>{text("点击生成后会显示本次数据发送确认；取消不会创建任务。", "A data-transfer confirmation appears when generation starts. Cancelling does not create a task.")}</Text>
        <Button onPress={() => onRun(submitImage, text("生成任务已完成并保存到本机项目。", "Generation completed and saved to the on-device project."))}>
          {workflow.key === "singleRoom" ? text("生成方案板图片", "Generate board image") : workflow.key === "multiRoom" ? text("生成多房间图片", "Generate multi-room image") : text("加入生成队列", "Start generation")}
        </Button>
      </Card>

      <Card>
        <SectionTitle eyebrow={text("结果", "Results")} title={text("最近输出", "Latest output")} />
        {latestResult ? (
          <View style={styles.stack}>
            <PreviewImage uri={client.assetContentURL(latestResult.id)} headers={client.assetRequestHeaders()} label={text("生成结果", "Generated result")} mimeType={latestResult.mime_type} />
            <Button
              variant="secondary"
              onPress={() => onOpenPreview({ uri: client.assetContentURL(latestResult.id), label: latestResult.file_name, mimeType: latestResult.mime_type, headers: client.assetRequestHeaders() })}
            >
              {text("查看大图", "View full image")}
            </Button>
          </View>
        ) : <EmptyState text={text("生成完成后，结果会显示在这里，也会进入项目回看。", "Completed results appear here and in project history.")} />}
      </Card>
    </View>
  );
}

interface BoardItemInput {
  selectionState: "keep" | "remove";
  priceMin: number | null;
  priceMax: number | null;
  procurementStatus: "pending" | "purchased";
  quantity: number | null;
  purchaseMethod: string;
  purchaseUrl: string;
}

function MobileBoardReviewItem({ item, onSave }: { item: ExtractedItem; onSave: (input: BoardItemInput) => Promise<void> }) {
  const { locale, text } = useMobileLocale();
  const [priceMin, setPriceMin] = useState(item.price_min == null ? "" : String(item.price_min));
  const [priceMax, setPriceMax] = useState(item.price_max == null ? "" : String(item.price_max));
  const [procurementStatus, setProcurementStatus] = useState<"pending" | "purchased">(item.procurement_status ?? "pending");
  const [quantity, setQuantity] = useState(item.quantity == null ? "" : String(item.quantity));
  const [purchaseMethod, setPurchaseMethod] = useState(item.purchase_method ?? "");
  const [purchaseUrl, setPurchaseUrl] = useState(item.purchase_url ?? "");
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");
  const state = reviewedState(item);

  useEffect(() => {
    setPriceMin(item.price_min == null ? "" : String(item.price_min));
    setPriceMax(item.price_max == null ? "" : String(item.price_max));
    setProcurementStatus(item.procurement_status ?? "pending");
    setQuantity(item.quantity == null ? "" : String(item.quantity));
    setPurchaseMethod(item.purchase_method ?? "");
    setPurchaseUrl(item.purchase_url ?? "");
  }, [item.price_max, item.price_min, item.procurement_status, item.purchase_method, item.purchase_url, item.quantity]);

  const persist = async (selectionState: "keep" | "remove") => {
    const min = optionalNonNegativeNumber(priceMin);
    const max = optionalNonNegativeNumber(priceMax);
    const normalizedQuantity = optionalPositiveInteger(quantity);
    if (min != null && max != null && min > max) {
      setLocalError(text("最低预算不能高于最高预算。", "Minimum budget cannot exceed maximum budget."));
      return;
    }
    if (quantity.trim() && normalizedQuantity == null) {
      setLocalError(text("数量必须是大于 0 的整数。", "Quantity must be a positive integer."));
      return;
    }
    if (purchaseUrl.trim() && !/^https?:\/\//i.test(purchaseUrl.trim())) {
      setLocalError(text("购买链接必须以 http:// 或 https:// 开头。", "Purchase URL must start with http:// or https://."));
      return;
    }
    setSaving(true);
    setLocalError("");
    try {
      await onSave({
        selectionState,
        priceMin: min,
        priceMax: max,
        procurementStatus,
        quantity: normalizedQuantity,
        purchaseMethod: purchaseMethod.trim(),
        purchaseUrl: purchaseUrl.trim(),
      });
    } catch (caught) {
      setLocalError(caught instanceof Error ? localizedError(caught.message, locale) : text("保存失败。", "Save failed."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.reviewItem}>
      <View style={styles.routeHeader}>
        <View style={styles.itemMain}>
          <Text style={styles.itemTitle}>{item.name}</Text>
          <Text style={styles.itemSub}>{item.room_type || item.category || text("房间元素", "Room item")} · {item.material || text("材质待确认", "Material pending")} · {item.color || text("颜色待确认", "Color pending")}</Text>
          {item.color_hex ? <Text style={styles.itemMeta}>{text("推断色号", "Inferred color")}: {item.color_hex}</Text> : null}
        </View>
        <StatusPill label={state === "keep" ? text("保留", "Keep") : state === "remove" ? text("已删除", "Removed") : text("待确认", "Pending")} tone={state === "keep" ? "good" : state === "remove" ? "bad" : "warn"} />
      </View>
      <View style={styles.formGrid}>
        <Field label={text("最低预算（可选）", "Minimum budget (optional)")} value={priceMin} onChangeText={setPriceMin} keyboardType="numeric" />
        <Field label={text("最高预算（可选）", "Maximum budget (optional)")} value={priceMax} onChangeText={setPriceMax} keyboardType="numeric" />
        <ChoiceChips
          options={["未采购", "已采购"] as const}
          value={procurementStatus === "purchased" ? "已采购" : "未采购"}
          onChange={(value) => setProcurementStatus(value === "已采购" ? "purchased" : "pending")}
          labelForOption={(value) => value === "已采购" ? text("已采购", "Purchased") : text("未采购", "Not purchased")}
        />
        <Field label={text("数量", "Quantity")} value={quantity} onChangeText={setQuantity} keyboardType="numeric" />
        <Field label={text("购买方式 / 渠道", "Purchase method / channel")} value={purchaseMethod} onChangeText={setPurchaseMethod} />
        <Field label={text("购买链接", "Purchase URL")} value={purchaseUrl} onChangeText={setPurchaseUrl} keyboardType="url" />
      </View>
      <View style={styles.row}>
        <Button disabled={saving} onPress={() => void persist("keep")}>{saving ? text("保存中", "Saving") : text("保留并保存", "Keep and save")}</Button>
        <Button disabled={saving} variant="danger" onPress={() => void persist("remove")}>{text("删除", "Remove")}</Button>
      </View>
      <AlertText text={localError} tone="bad" />
    </View>
  );
}

function PromptsScreen({
  prompts,
  onReload,
  onCreate,
}: {
  prompts: PromptTemplate[];
  onReload: () => void;
  onCreate: (payload: { name: string; module: string; userPrompt: string; negativePrompt?: string; variables: string[] }) => void;
}) {
  const { locale, text } = useMobileLocale();
  const firstPreset = interiorPromptPresets[0];
  const [name, setName] = useState<string>(locale === "en" ? firstPreset.nameEn : firstPreset.name);
  const [module, setModule] = useState<string>(firstPreset.module);
  const [userPrompt, setUserPrompt] = useState<string>(locale === "en" ? firstPreset.userPromptEn : firstPreset.userPrompt);
  const [negativePrompt, setNegativePrompt] = useState<string>(locale === "en" ? firstPreset.negativePromptEn : firstPreset.negativePrompt);

  const applyPreset = (preset: typeof interiorPromptPresets[number]) => {
    setName(locale === "en" ? preset.nameEn : preset.name);
    setModule(preset.module);
    setUserPrompt(locale === "en" ? preset.userPromptEn : preset.userPrompt);
    setNegativePrompt(locale === "en" ? preset.negativePromptEn : preset.negativePrompt);
  };

  return (
    <View style={styles.stack}>
      <Card>
        <SectionTitle eyebrow={text("提示词范本", "Prompt presets")} title={text("室内渲染提示词", "Interior rendering prompts")} subtitle={text("先套用范本，再按项目现场调整。", "Apply a preset, then adjust it for the project.")} />
        {interiorPromptPresets.map((preset) => (
          <View key={preset.name} style={styles.presetItem}>
            <View style={styles.itemMain}>
              <Text style={styles.itemTitle}>{text(preset.name, preset.nameEn)}</Text>
              <Text style={styles.itemSub}>{moduleLabel(preset.module, text)}</Text>
              <Text style={styles.itemMeta} numberOfLines={4}>{text(preset.userPrompt, preset.userPromptEn)}</Text>
            </View>
            <Button variant="secondary" onPress={() => applyPreset(preset)}>{text("套用", "Apply")}</Button>
          </View>
        ))}
      </Card>

      <Card>
        <SectionTitle eyebrow={text("草稿", "Draft")} title={text("保存到提示词库", "Save to prompt library")} />
        <Field label={text("名称", "Name")} value={name} onChangeText={setName} />
        <Field label={text("模块", "Module")} value={module} onChangeText={setModule} />
        <Field label={text("用户提示词", "Prompt")} value={userPrompt} onChangeText={setUserPrompt} multiline />
        <Field label={text("负面提示词", "Negative prompt")} value={negativePrompt} onChangeText={setNegativePrompt} multiline />
        <View style={styles.row}>
          <Button onPress={() => onCreate({ name, module, userPrompt, negativePrompt, variables: ["room_type", "style", "material_keywords"] })}>{text("保存草稿", "Save draft")}</Button>
          <Button variant="secondary" onPress={onReload}>{text("刷新", "Refresh")}</Button>
        </View>
      </Card>
      <Card>
        <SectionTitle eyebrow={text("提示词库", "Prompt library")} title={text(`${prompts.length} 个模板`, `${prompts.length} templates`)} />
        {prompts.length ? prompts.slice(0, 12).map((prompt) => (
          <View key={prompt.id} style={styles.item}>
            <View style={styles.itemMain}>
              <Text style={styles.itemTitle}>{prompt.name}</Text>
              <Text style={styles.itemSub}>{prompt.module} · v{prompt.version}</Text>
              <Text style={styles.itemMeta} numberOfLines={3}>{prompt.user_prompt}</Text>
            </View>
            <StatusPill label={prompt.is_builtin ? text("内置", "Built-in") : text("自定义", "Custom")} tone={prompt.is_builtin ? "neutral" : "good"} />
          </View>
        )) : <EmptyState text={text("暂无提示词模板。", "No prompt templates.")} />}
      </Card>
    </View>
  );
}

type RouteActionState = {
  status: "idle" | "saving" | "testing" | "success" | "warning" | "error";
  message?: string;
  result?: ModelConnectivityResult;
};

type MobileModelRoutePreset =
  | (typeof mobileImageRoutePresets)[number]
  | (typeof mobileExtractionRoutePresets)[number];

function ModelsScreen({
  providers,
  modelTests,
  onRefresh,
  onSaveRoute,
  onTestRoute,
}: {
  providers: ProviderConfig[];
  modelTests: ModelConnectivityResult[];
  onRefresh: () => Promise<void>;
  onSaveRoute: (payload: MobileModelRouteDraft) => Promise<ProviderConfig>;
  onTestRoute: (payload: {
    providerConfigId?: number | null;
    providerId: string;
    providerLabel: string;
    modelId: string;
    routingMode: "direct_api" | "relay_base_url";
    compatibilityMode: string;
    baseUrl?: string | null;
    apiKey?: string;
    capability?: string;
    includeCostly?: boolean;
  }) => Promise<ModelConnectivityResult>;
}) {
  const { locale, text } = useMobileLocale();
  const [routeKind, setRouteKind] = useState<"image" | "extraction">("image");
  const [selectedRouteKey, setSelectedRouteKey] = useState<string>("openai-relay");
  const [routeInputs, setRouteInputs] = useState<Record<string, { baseUrl: string; apiKey: string }>>({});
  const [routeStates, setRouteStates] = useState<Record<string, RouteActionState>>({});
  const testedByRoute = new Map(modelTests.map((result) => [modelTestKeyFromResult(result), result]));
  const routePresets = [...mobileImageRoutePresets, ...mobileExtractionRoutePresets];
  const visiblePresets = routePresets.filter((preset) => (
    routeKind === "extraction" ? isGlmExtractionProvider(preset.provider_id) : !isGlmExtractionProvider(preset.provider_id)
  ));
  const selectedPreset = visiblePresets.find((preset) => preset.key === selectedRouteKey) ?? visiblePresets[0];
  const selectedConfig = selectedPreset ? findRouteConfig(providers, selectedPreset) : undefined;
  const selectedInput = selectedPreset
    ? routeInputs[selectedPreset.key] ?? {
        baseUrl: selectedConfig?.base_url || selectedPreset.base_url || "",
        apiKey: "",
      }
    : { baseUrl: "", apiKey: "" };
  const selectedTestResult = selectedPreset
    ? testedByRoute.get(modelTestKey({
        providerId: selectedPreset.provider_id,
        modelId: selectedPreset.model_name,
        routingMode: selectedPreset.routing_mode,
        baseUrl: selectedInput.baseUrl || selectedConfig?.base_url || selectedPreset.base_url || null,
      }))
    : undefined;
  const routeRows = selectedPreset
    ? [{ preset: selectedPreset, config: selectedConfig, input: selectedInput, testResult: selectedTestResult }]
    : [];

  const updateRouteInput = (key: string, patch: Partial<{ baseUrl: string; apiKey: string }>) => {
    setRouteInputs((current) => ({
      ...current,
      [key]: {
        baseUrl: current[key]?.baseUrl ?? (selectedPreset?.key === key ? selectedInput.baseUrl : ""),
        apiKey: current[key]?.apiKey ?? "",
        ...patch,
      },
    }));
  };

  const setRouteState = (key: string, state: RouteActionState) => {
    setRouteStates((current) => ({ ...current, [key]: state }));
  };

  const saveRoute = async (preset: MobileModelRoutePreset, input: { baseUrl: string; apiKey: string }) => {
    setRouteState(preset.key, { status: "saving", message: text("正在保存线路...", "Saving route...") });
    try {
      if (preset.routing_mode === "relay_base_url" && !input.baseUrl.trim()) {
        throw new Error(text("中转 Base URL 不能为空。请填写真实可访问的 HTTPS 地址。", "Relay Base URL is required. Enter a reachable HTTPS address."));
      }
      const saved = await onSaveRoute({
        provider_id: preset.provider_id,
        model_name: preset.model_name,
        display_name: preset.display_name,
        routing_mode: preset.routing_mode,
        compatibility_mode: preset.compatibility_mode,
        base_url: input.baseUrl.trim() || preset.base_url,
        api_key: input.apiKey.trim() || undefined,
        api_key_name: preset.api_key_name,
        capability: isGlmExtractionProvider(preset.provider_id) ? "vision" : "image",
        priority: preset.priority,
      });
      setRouteInputs((current) => ({
        ...current,
        [preset.key]: {
          baseUrl: saved.base_url || input.baseUrl || preset.base_url || "",
          apiKey: "",
        },
      }));
      if (preset.routing_mode === "relay_base_url" && !saved.base_url?.trim()) {
        throw new Error(text("保存失败：系统安全存储没有保留中转 Base URL。", "Save failed: the secure store did not retain the relay Base URL."));
      }
      if (input.apiKey.trim() && !saved.has_api_key) {
        throw new Error(text("保存失败：API Key 没有进入系统安全存储。", "Save failed: the API key was not stored securely."));
      }
      setRouteState(preset.key, { status: "success", message: text("线路已保存，可继续安全检测。", "Route saved. You can now test the connection.") });
    } catch (caught) {
      setRouteState(preset.key, { status: "error", message: errorMessage(caught, locale, text) });
    }
  };

  const testRoute = async (
    preset: MobileModelRoutePreset,
    config: ProviderConfig | undefined,
    input: { baseUrl: string; apiKey: string },
  ) => {
    setRouteState(preset.key, { status: "testing", message: text("正在发起安全检测...", "Testing connection...") });
    try {
      const result = await onTestRoute({
        providerConfigId: config?.id ?? null,
        providerId: preset.provider_id,
        providerLabel: preset.providerLabel,
        modelId: preset.model_name,
        routingMode: preset.routing_mode,
        compatibilityMode: preset.compatibility_mode,
        baseUrl: input.baseUrl.trim() || config?.base_url || preset.base_url || null,
        apiKey: input.apiKey.trim() || undefined,
        capability: isGlmExtractionProvider(preset.provider_id) ? "vision" : "image",
        includeCostly: false,
      });
      const verified = isVerifiedConnectivity(result);
      const unverified = isReachableUnverified(result);
      setRouteState(preset.key, {
        status: verified ? "success" : unverified ? "warning" : "error",
        message: verified
          ? (result.error ? localizedError(result.error, locale) : text("连接检测通过。", "Connection test passed."))
          : unverified
            ? (result.error ? localizedError(result.error, locale) : releaseLabel(result.release_status, text))
            : result.error ? localizedError(result.error, locale) : releaseLabel(result.release_status, text),
        result,
      });
    } catch (caught) {
      setRouteState(preset.key, { status: "error", message: errorMessage(caught, locale, text) });
    }
  };

  return (
    <View style={styles.stack}>
      <Card>
        <SectionTitle eyebrow={text("模型", "Models")} title={text("图片生成与提取模型", "Image Generation and Extraction Models")} subtitle={text("API Key 和 Base URL 只保存在手机系统安全存储中。", "API keys and Base URLs are stored only in the device secure store.")} />
        <View style={styles.row}>
          <Button variant={routeKind === "image" ? "primary" : "secondary"} onPress={() => {
            setRouteKind("image");
            setSelectedRouteKey("openai-relay");
          }}>{text("图片生成", "Image generation")}</Button>
          <Button variant={routeKind === "extraction" ? "primary" : "secondary"} onPress={() => {
            setRouteKind("extraction");
            setSelectedRouteKey("glm-direct");
          }}>{text("信息提取", "Information extraction")}</Button>
          <Button variant="secondary" onPress={onRefresh}>{text("刷新", "Refresh")}</Button>
        </View>
        <View style={styles.fieldWrap}>
          <Text style={styles.fieldLabel}>{text("当前模型线路", "Current model route")}</Text>
          <View style={styles.pickerShell}>
            <Picker
              selectedValue={selectedPreset?.key}
              onValueChange={(value) => setSelectedRouteKey(String(value))}
              style={styles.picker}
            >
              {visiblePresets.map((preset) => (
                <Picker.Item key={preset.key} label={`${text(preset.providerLabel, preset.providerLabelEn)} · ${preset.model_name}`} value={preset.key} />
              ))}
            </Picker>
          </View>
        </View>
        {routeRows.map(({ preset, config, input, testResult }) => {
          const baseUrl = input.baseUrl;
          const canTest = preset.routing_mode === "direct_api" || Boolean(baseUrl.trim() || config?.base_url);
          const routeState = routeStates[preset.key] ?? { status: "idle" as const };
          const effectiveTestResult = routeState.result ?? testResult;
          const isBusy = routeState.status === "saving" || routeState.status === "testing";
          const verified = isVerifiedConnectivity(effectiveTestResult);
          const unverified = isReachableUnverified(effectiveTestResult);
          const routeStatus = effectiveTestResult
            ? (verified ? text("通过", "Passed") : releaseLabel(effectiveTestResult.release_status, text))
            : config?.last_test_status === "connected"
              ? text("已连接", "Connected")
              : config?.has_api_key || config?.base_url
                ? text("已保存", "Saved")
                : text("未配置", "Not configured");
          return (
            <View key={preset.key} style={styles.routeCard}>
              <View style={styles.routeHeader}>
                <View style={styles.itemMain}>
                  <Text style={styles.itemTitle}>{text(preset.providerLabel, preset.providerLabelEn)}</Text>
                  <Text style={styles.itemSub}>{text(preset.display_name, "display_name_en" in preset ? preset.display_name_en : preset.display_name)}</Text>
                  <Text style={styles.itemMeta}>{isGlmExtractionProvider(preset.provider_id) ? text("提取模型", "Extraction model") : text("图片模型", "Image model")} · {routingLabel(preset.routing_mode, text)} · {compatibilityLabel(preset.compatibility_mode, text)}</Text>
                </View>
                <StatusPill
                  label={isBusy ? (routeState.status === "saving" ? text("保存中", "Saving") : text("检测中", "Testing")) : routeStatus}
                  tone={verified || config?.last_test_status === "connected" ? "good" : unverified || config?.last_test_status === "unverified" ? "warn" : effectiveTestResult ? "bad" : config ? "warn" : "neutral"}
                />
              </View>
              <KeyValue label={text("模型 ID", "Model ID")} value={preset.model_name} />
              <KeyValue label={text("接口路径", "Endpoint path")} value={config?.default_endpoint_path || preset.endpoint} />
              <Field
                label={preset.routing_mode === "relay_base_url" ? text("中转 Base URL", "Relay Base URL") : text("官方 Base URL", "Official Base URL")}
                value={baseUrl}
                onChangeText={(value) => updateRouteInput(preset.key, { baseUrl: value })}
                placeholder={preset.routing_mode === "relay_base_url" ? "https://relay.your-company.cn/v1" : preset.base_url}
                keyboardType="url"
              />
              <Field
                label={config?.has_api_key ? text("API Key（已保存，留空不替换）", "API Key (saved; leave blank to keep)") : "API Key"}
                value={input.apiKey}
                onChangeText={(value) => updateRouteInput(preset.key, { apiKey: value })}
                placeholder={preset.api_key_name}
                secureTextEntry
              />
              {routeState.message ? (
                <AlertText
                  text={routeState.message}
                  tone={routeState.status === "success" ? "good" : routeState.status === "error" ? "bad" : "warn"}
                />
              ) : null}
              {effectiveTestResult ? (
                <AlertText
                  text={formatConnectivityResult(effectiveTestResult, locale, text)}
                  tone={verified ? "good" : unverified || effectiveTestResult.release_status === "SKIPPED_COST" ? "warn" : "bad"}
                />
              ) : null}
              <View style={styles.row}>
                <Button
                  disabled={isBusy}
                  onPress={() => saveRoute(preset, input)}
                >
                  {text("保存线路", "Save route")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={!canTest || isBusy}
                  onPress={() => testRoute(preset, config, input)}
                >
                  {text("连接检测", "Test connection")}
                </Button>
              </View>
            </View>
          );
        })}
      </Card>

    </View>
  );
}

function ArchiveScreen({
  project,
  assets,
  tasks,
  review,
  client,
  onOpenPreview,
  onExport,
}: {
  project?: Project;
  assets: AssetRecord[];
  tasks: TaskRecord[];
  review?: ReviewSnapshot;
  client: LocalMobileClient;
  onOpenPreview: (asset: { uri?: string; label: string; mimeType?: string | null; headers?: Record<string, string> } | null) => void;
  onExport: (format: "image" | "table") => void;
}) {
  const { locale, text } = useMobileLocale();
  return (
    <View style={styles.stack}>
      <Card>
        <SectionTitle eyebrow={text("项目回看", "Project archive")} title={project?.name || text("未选择项目", "No project selected")} subtitle={text("查看本机项目归档、生成结果、任务复盘和导出记录。", "Review on-device project assets, generated results, tasks, and exports.")} />
        <View style={styles.metrics}>
          <KeyValue label={text("素材", "Assets")} value={review?.summary.asset_count ?? assets.length} />
          <KeyValue label={text("任务", "Tasks")} value={review?.summary.task_count ?? tasks.length} />
          <KeyValue label={text("导出", "Exports")} value={review?.summary.export_count ?? 0} />
          <KeyValue label={text("版本", "Versions")} value={review?.summary.version_count ?? 0} />
        </View>
        <View style={styles.row}>
          <Button disabled={!project} onPress={() => onExport("image")}>{text("导出图片报告", "Export image report")}</Button>
          <Button disabled={!project} variant="secondary" onPress={() => onExport("table")}>{text("导出采购表格", "Export procurement table")}</Button>
        </View>
      </Card>

      <Card>
        <SectionTitle eyebrow={text("输出图库", "Output gallery")} title={text(`${assets.length} 个结果`, `${assets.length} results`)} />
        {assets.length ? assets.slice(0, 12).map((asset) => (
          <View key={asset.id} style={styles.galleryItem}>
            <PreviewImage
              uri={client.assetContentURL(asset.id)}
              headers={client.assetRequestHeaders()}
              label={asset.file_name}
              mimeType={asset.mime_type}
              containerStyle={styles.galleryPreview}
            />
            <View style={styles.itemMain}>
              <Text style={styles.itemTitle}>{asset.file_name}</Text>
              <Text style={styles.itemSub}>{asset.type} · {asset.source || text("输出", "Output")}</Text>
            </View>
            <Button
              variant="secondary"
              onPress={() => onOpenPreview({ uri: client.assetContentURL(asset.id), label: asset.file_name, mimeType: asset.mime_type, headers: client.assetRequestHeaders() })}
            >
              {text("查看", "View")}
            </Button>
          </View>
        )) : <EmptyState text={text("还没有生成输出。", "No generated output yet.")} />}
      </Card>

      <Card>
        <SectionTitle eyebrow={text("复盘", "Review")} title={text("最近任务", "Recent tasks")} />
        {tasks.length ? tasks.slice(0, 12).map((task) => (
          <View key={task.id} style={styles.item}>
            <View style={styles.itemMain}>
              <Text style={styles.itemTitle}>{taskLabel(task.module, text)} · #{task.id}</Text>
              <Text style={styles.itemSub}>{taskProviderLabel(task.provider, text)} / {task.model_name}</Text>
              <Text style={styles.itemMeta} numberOfLines={2}>{task.error_message ? localizedError(task.error_message, locale) : task.prompt_snapshot_json?.resolved_prompt || text("任务快照等待中", "Task snapshot pending")}</Text>
            </View>
            <StatusPill label={statusLabel(task.status, text)} tone={statusTone(task.status)} />
          </View>
        )) : <EmptyState text={text("还没有任务记录。", "No task history yet.")} />}
      </Card>
    </View>
  );
}

function TaskQueue({
  tasks,
  client,
  onRefresh,
  onTaskUpdate,
  onRun,
}: {
  tasks: TaskRecord[];
  client: LocalMobileClient;
  onRefresh: () => void;
  onTaskUpdate: (task: TaskRecord) => void;
  onRun: (operation: () => Promise<void | boolean>, successMessage?: string) => void;
}) {
  const { locale, text } = useMobileLocale();
  const visibleTasks = tasks.slice(0, 5);
  return (
    <Card style={styles.queueCard}>
      <View style={styles.queueHeader}>
        <SectionTitle eyebrow={text("任务记录", "Task history")} title={text("最近任务", "Recent tasks")} subtitle={text("查看手机直接调用 Provider 的真实执行状态和结果。", "Review actual Provider execution status and results from this device.")} />
        <Button variant="secondary" onPress={onRefresh}>{text("刷新队列", "Refresh")}</Button>
      </View>
      {visibleTasks.length ? visibleTasks.map((task) => (
        <View key={task.id} style={styles.item}>
          <View style={styles.itemMain}>
            <Text style={styles.itemTitle}>{taskLabel(task.module, text)}</Text>
            <Text style={styles.itemSub}>{taskProviderLabel(task.provider, text)} / {task.model_name}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, task.progress))}%` }]} />
            </View>
            {task.error_message ? <Text style={styles.errorText}>{localizedError(task.error_message, locale)}</Text> : null}
          </View>
          <View style={styles.taskActions}>
            <StatusPill label={statusLabel(task.status, text)} tone={statusTone(task.status)} />
            {task.status === "failed" ? (
              <Button
                variant="secondary"
                onPress={() => onRun(async () => onTaskUpdate(await client.retryTask(task.id)), text("任务已重新加入队列。", "Task queued again."))}
              >
                {text("重试", "Retry")}
              </Button>
            ) : null}
            {task.status === "queued" || task.status === "running" ? (
              <Button
                variant="danger"
                onPress={() => onRun(async () => onTaskUpdate(await client.cancelTask(task.id)), text("任务已取消。", "Task cancelled."))}
              >
                {text("取消", "Cancel")}
              </Button>
            ) : null}
          </View>
        </View>
      )) : <EmptyState text={text("暂无任务。", "No tasks.")} />}
    </Card>
  );
}

function splitKeywords(value: string): string[] {
  return value.split(/[,，、]/).map((item) => item.trim()).filter(Boolean);
}

function formatBoundingBox(bbox: NonNullable<ExtractedItem["bbox"]>, text: (zh: string, en: string) => string): string {
  return text(
    `x ${bbox.x.toFixed(2)} · y ${bbox.y.toFixed(2)} · 宽 ${bbox.width.toFixed(2)} · 高 ${bbox.height.toFixed(2)}`,
    `x ${bbox.x.toFixed(2)} · y ${bbox.y.toFixed(2)} · width ${bbox.width.toFixed(2)} · height ${bbox.height.toFixed(2)}`,
  );
}

function mobileExportContext(assets: AssetRecord[], review: ReviewSnapshot | undefined, text: (zh: string, en: string) => string) {
  const board = [...(review?.board_documents ?? [])]
    .filter((item) => Number(item.layout_json?.schema_version) === 2)
    .sort((left, right) => right.id - left.id)[0];
  const data = board?.data_json ?? {};
  const fallbackSources = assets.filter((asset) => !["render_output", "board_output"].includes(asset.type));
  const sourceAssetIds = numberArray(data.source_asset_ids).length ? numberArray(data.source_asset_ids) : fallbackSources.slice(0, 8).map((asset) => asset.id);
  if (!sourceAssetIds.length) throw new Error(text("当前项目没有可用于报告的图片。", "This project has no images available for a report."));
  const selectedItemIds = numberArray(data.selected_item_ids).length
    ? numberArray(data.selected_item_ids)
    : keptItems(review?.extracted_items ?? []).map((item) => item.id);
  const reviewSnapshotValue = typeof data.review_snapshot === "string" && data.review_snapshot ? data.review_snapshot : "[]";
  const mode = board?.board_type === "multi_room" ? "multi" as const : "single" as const;
  const generatedId = Number(data.generated_asset_id) || undefined;
  const generated = assets.find((asset) => asset.id === generatedId)
    ?? assets.find((asset) => asset.type === "render_output" || asset.type === "board_output");
  return {
    boardDocumentIds: board ? [board.id] : [],
    mode,
    sourceAssetIds,
    selectedItemIds,
    reviewSnapshot: reviewSnapshotValue,
    generatedAssetId: generated?.id,
  };
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter((item) => Number.isInteger(item) && item > 0) : [];
}

function optionalNonNegativeNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function optionalPositiveInteger(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function mergeKeyword(current: string, keyword: string): string {
  const keywords = splitKeywords(current);
  if (!keywords.includes(keyword)) keywords.unshift(keyword);
  return keywords.join(", ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function statusLabel(status: TaskRecord["status"], text: (zh: string, en: string) => string): string {
  const labels = {
    queued: text("排队中", "Queued"),
    running: text("运行中", "Running"),
    success: text("成功", "Success"),
    failed: text("失败", "Failed"),
    cancelled: text("已取消", "Cancelled"),
  };
  return labels[status];
}

function statusTone(status: TaskRecord["status"]): "neutral" | "good" | "warn" | "bad" {
  if (status === "success") return "good";
  if (status === "failed" || status === "cancelled") return "bad";
  if (status === "queued" || status === "running") return "warn";
  return "neutral";
}

function taskLabel(moduleName: string, text: (zh: string, en: string) => string): string {
  const labels: Record<string, string> = {
    floorplan: text("平面图", "Floor plan"),
    single_room_board: text("单房间方案板", "Single-room board"),
    multi_room_board: text("多房间方案板", "Multi-room board"),
    space_render: text("空间渲染", "Space rendering"),
    custom_tasks: text("自定义任务", "Custom task"),
  };
  return labels[moduleName] ?? moduleName;
}

function taskProviderLabel(provider: string, text: (zh: string, en: string) => string): string {
  const routeLabels: Record<string, string> = {
    "OpenAI 原生": text("OpenAI 原生", "OpenAI Native"),
    "OpenAI 中转": text("OpenAI 中转", "OpenAI Relay"),
    "Google Gemini 原生": text("Google Gemini 原生", "Google Gemini Native"),
    "智谱 GLM（中国大陆）": text("智谱 GLM（中国大陆）", "Zhipu GLM (Mainland China)"),
    "Z.AI GLM（国际/海外）": text("Z.AI GLM（国际/海外）", "Z.AI GLM (International)"),
  };
  if (routeLabels[provider]) return routeLabels[provider];
  if (provider === "HavenFrame Board Composer" || provider === "Qigou Board Composer") {
    return text("栖构方案板编排器", "HavenFrame Board Composer");
  }
  return provider;
}

function mobileTabLabel(screen: ScreenKey): string {
  const labels: Record<ScreenKey, string> = {
    projects: "Projects",
    floorplan: "Floor Plans",
    singleRoom: "Single Room",
    multiRoom: "Multi Room",
    spaceRender: "Rendering",
    customTasks: "Custom",
    prompts: "Prompts",
    models: "Models",
    archive: "Archive",
  };
  return labels[screen];
}

function moduleLabel(moduleName: string, text: (zh: string, en: string) => string): string {
  return taskLabel(moduleName === "boards" ? "single_room_board" : moduleName, text);
}

function modelIdOf(provider: ProviderConfig): string {
  return provider.model_id || String(provider.extra_config_json?.model_id ?? "") || provider.model_name;
}

function providerIdOf(provider: ProviderConfig): string {
  return provider.provider_id || String(provider.extra_config_json?.provider_id ?? provider.provider_name);
}

function routingLabel(value: string, text: (zh: string, en: string) => string): string {
  return value === "relay_base_url" ? text("中转 Base URL", "Relay Base URL") : text("原生 API", "Native API");
}

function compatibilityLabel(value: string, text: (zh: string, en: string) => string): string {
  const labels: Record<string, string> = {
    native: text("原生", "Native"),
    openai_compatible: text("OpenAI 兼容", "OpenAI compatible"),
    gemini_compatible: text("Gemini 兼容", "Gemini compatible"),
  };
  return labels[value] ?? value;
}

function isSupportedMobileImageProvider(provider: ProviderConfig): boolean {
  const providerId = providerIdOf(provider).toLowerCase();
  const compatibility = String(provider.compatibility_mode ?? provider.extra_config_json?.compatibility_mode ?? "").toLowerCase();
  const model = modelIdOf(provider).toLowerCase();
  const isOpenAI = (providerId === "openai" || compatibility === "openai_compatible") && model === "gpt-image-2";
  const isGemini = (providerId === "google_gemini" || compatibility === "gemini_compatible") && runnableGeminiImageModelIds.has(model);
  return isOpenAI || isGemini;
}

function isSupportedMobileExtractionProvider(provider: ProviderConfig): boolean {
  const providerId = providerIdOf(provider).toLowerCase();
  const model = modelIdOf(provider).toLowerCase();
  const capability = String(provider.capability ?? provider.extra_config_json?.capability ?? "").toLowerCase();
  const capabilities = provider.capabilities_json ?? [];
  return (
    isGlmExtractionProvider(providerId)
    && model === "glm-4.5v"
    && (capability === "vision" || capabilities.includes("vision") || capabilities.includes("text"))
  );
}

const runnableGeminiImageModelIds = new Set([
  "gemini-2.5-flash-image",
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image-preview",
]);

function findRouteConfig(
  providers: ProviderConfig[],
  preset: MobileModelRoutePreset,
): ProviderConfig | undefined {
  return providers.find((provider) => {
    const providerId = providerIdOf(provider).toLowerCase();
    const compatibility = String(provider.compatibility_mode ?? provider.extra_config_json?.compatibility_mode ?? "").toLowerCase();
    return (
      modelIdOf(provider) === preset.model_name
      && provider.routing_mode === preset.routing_mode
      && (
        providerId === preset.provider_id
        || compatibility === preset.compatibility_mode
      )
    );
  });
}

function modelTestKey(args: {
  providerId: string;
  modelId: string;
  routingMode: string;
  baseUrl?: string | null;
}): string {
  return [
    args.providerId,
    args.modelId,
    args.routingMode,
    normalizeRouteBase(args.baseUrl),
  ].join(":");
}

function modelTestKeyFromResult(result: ModelConnectivityResult): string {
  return modelTestKey({
    providerId: result.provider_id,
    modelId: result.model_id,
    routingMode: result.routing_mode,
    baseUrl: result.base_url_used,
  });
}

function modelTestKeyFromProvider(provider: ProviderConfig): string {
  return modelTestKey({
    providerId: providerIdOf(provider),
    modelId: modelIdOf(provider),
    routingMode: provider.routing_mode,
    baseUrl: provider.base_url,
  });
}

function normalizeRouteBase(value?: string | null): string {
  return String(value || "").trim().replace(/\/+$/, "");
}

function formatConnectivityResult(
  result: ModelConnectivityResult,
  locale: MobileLocale,
  text: (zh: string, en: string) => string = (zh) => zh,
): string {
  const endpoint = result.endpoint_used || result.base_url_used || text("未返回端点", "No endpoint returned");
  const status = typeof result.status_code === "number" ? `HTTP ${result.status_code}` : releaseLabel(result.release_status, text);
  const latency = typeof result.latency_ms === "number" ? `，${result.latency_ms}ms` : "";
  if (isVerifiedConnectivity(result)) {
    return text(`检测通过：${endpoint}，${status}${latency}。`, `Connection passed: ${endpoint}, ${status}${latency}.`);
  }
  if (isReachableUnverified(result)) {
    const detail = result.error ? localizedError(result.error, locale) : releaseLabel(result.release_status, text);
    return text(`地址可达，但真实模型调用尚未验证：${detail}。端点：${endpoint}，状态：${status}${latency}。`, `Address reachable, but the real model call is not verified: ${detail}. Endpoint: ${endpoint}; status: ${status}${latency}.`);
  }
  const detail = result.error ? localizedError(result.error, locale) : result.error_type || releaseLabel(result.release_status, text);
  return text(`检测失败：${detail}。端点：${endpoint}，状态：${status}${latency}。`, `Connection failed: ${detail}. Endpoint: ${endpoint}; status: ${status}${latency}.`);
}

function errorMessage(error: unknown, locale: MobileLocale, text: (zh: string, en: string) => string): string {
  return error instanceof Error ? localizedError(error.message, locale) : text("操作失败。", "Operation failed.");
}

function releaseLabel(status?: string | null, text: (zh: string, en: string) => string = (zh) => zh): string {
  const labels: Record<string, string> = {
    CONNECTED: text("已连接", "Connected"),
    PASS: text("通过", "Passed"),
    REACHABLE_UNVERIFIED: text("可达但未验证真实模型", "Reachable, model not verified"),
    CREDENTIALS_CONNECTED: text("端点/凭据通过，图片未验证", "Endpoint/credentials passed; image unverified"),
    BLOCKED_CREDENTIAL: text("缺少凭证", "Missing credentials"),
    BLOCKED_PROVIDER: text("供应商阻断", "Provider blocked"),
    BLOCKED_NETWORK: text("网络阻断", "Network blocked"),
    BLOCKED_UNSUPPORTED: text("暂不支持", "Unsupported"),
    CODE_FAILURE: text("配置错误", "Configuration error"),
    SKIPPED_COST: text("跳过计费测试", "Paid test skipped"),
    NOT_TESTED: text("未测试", "Not tested"),
  };
  return labels[status ?? ""] ?? status ?? text("未测试", "Not tested");
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  app: {
    flex: 1,
  },
  header: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 9,
  },
  headerText: {
    gap: 2,
  },
  brand: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
  },
  headerTitle: {
    color: colors.navy,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "900",
  },
  headerSub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  headerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  headerLocale: {
    width: 122,
    height: 34,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 9,
    backgroundColor: colors.surface,
    flexDirection: "row",
    padding: 2,
    gap: 2,
  },
  headerLocaleOption: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
  },
  headerLocaleOptionActive: {
    backgroundColor: colors.primary,
  },
  headerLocaleText: {
    color: colors.ink,
    fontSize: 11,
    fontWeight: "800",
  },
  headerLocaleTextActive: {
    color: colors.surface,
  },
  navWrap: {
    height: 54,
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
  },
  navScroll: {
    flexGrow: 0,
    flexShrink: 0,
    height: 54,
    maxHeight: 54,
  },
  tabs: {
    height: 54,
    alignItems: "center",
    paddingHorizontal: 10,
    gap: 7,
  },
  tab: {
    height: 34,
    minWidth: 52,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  tabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabText: {
    color: colors.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
  },
  tabTextActive: {
    color: "#FFFFFF",
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 10,
    paddingBottom: 28,
    gap: 10,
  },
  contentTablet: {
    maxWidth: 960,
    width: "100%",
    alignSelf: "center",
  },
  stack: {
    gap: 10,
  },
  formGrid: {
    gap: 10,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  fieldWrap: {
    gap: 6,
    marginTop: 12,
  },
  fieldLabel: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  pickerShell: {
    minHeight: 52,
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  picker: {
    width: "100%",
    color: colors.navy,
  },
  item: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    padding: 10,
    marginBottom: 8,
  },
  presetItem: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    padding: 10,
    marginBottom: 8,
  },
  routeCard: {
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    padding: 10,
    marginBottom: 10,
  },
  routeHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    gap: 10,
  },
  itemActive: {
    borderColor: colors.primary,
    backgroundColor: "#ECFDF5",
  },
  itemMain: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  itemTitle: {
    color: colors.navy,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
  },
  itemSub: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  itemMeta: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
  previewGrid: {
    gap: 8,
  },
  errorText: {
    color: colors.rose,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  pickedImage: {
    gap: 8,
  },
  reviewGrid: {
    gap: 10,
    marginTop: 12,
  },
  reviewItem: {
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    padding: 10,
  },
  referenceItem: {
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  assetStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  assetThumb: {
    width: 140,
    gap: 7,
  },
  assetThumbPreview: {
    width: 140,
    height: 92,
    borderRadius: 10,
  },
  note: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 10,
  },
  modelBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    padding: 10,
    marginVertical: 10,
    gap: 4,
  },
  modelTitle: {
    color: colors.navy,
    fontSize: 14,
    fontWeight: "900",
  },
  modelSub: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 12,
  },
  galleryItem: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    padding: 10,
    marginBottom: 10,
  },
  galleryPreview: {
    width: 72,
    height: 72,
    borderRadius: 10,
  },
  queueCard: {
    marginTop: 4,
  },
  queueHeader: {
    gap: 6,
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "#E2E8F0",
    overflow: "hidden",
    marginTop: 6,
  },
  progressFill: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  taskActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 6,
  },
});
