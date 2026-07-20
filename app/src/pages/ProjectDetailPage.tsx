import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router-dom";

import { AssetImage } from "../components/AssetImage";
import { OutputGalleryPanel } from "../components/OutputGalleryPanel";
import { ProjectReviewPanel } from "../components/ProjectReviewPanel";
import { WorkflowLaunchPanel } from "../components/WorkflowLaunchPanel";
import { useLocale } from "../i18n/locale";
import { taskRuntimeLabel } from "../lib/model-route-labels";
import { localeLabel } from "../lib/zh-labels";
import { useAssetStore } from "../stores/useAssetStore";
import { useModelStore } from "../stores/useModelStore";
import { useProjectStore } from "../stores/useProjectStore";
import { useReviewStore } from "../stores/useReviewStore";
import { useTaskStore } from "../stores/useTaskStore";

export function ProjectDetailPage() {
  const { locale, text } = useLocale();
  const { projectId } = useParams();
  const projects = useProjectStore((state) => state.projects);
  const setActiveProject = useProjectStore((state) => state.setActiveProject);
  const tasks = useTaskStore((state) => state.tasks);
  const loadTasks = useTaskStore((state) => state.loadTasks);
  const providerConfigs = useModelStore((state) => state.providerConfigs);
  const assets = useAssetStore((state) => state.assets);
  const loadAssets = useAssetStore((state) => state.loadAssets);
  const getSnapshot = useReviewStore((state) => state.getSnapshot);
  const fetchSnapshot = useReviewStore((state) => state.fetchSnapshot);
  const project = projects.find((item) => item.id === Number(projectId));
  const reviewSnapshot = getSnapshot(project?.id ?? 0);

  useEffect(() => {
    if (!project?.id) {
      return;
    }

    setActiveProject(project.id);
    void Promise.all([loadAssets(project.id), loadTasks(project.id), fetchSnapshot(project.id)]);
  }, [fetchSnapshot, loadAssets, loadTasks, project?.id, setActiveProject]);

  const projectTasks = useMemo(
    () => tasks.filter((task) => task.project_id === project?.id),
    [project?.id, tasks],
  );
  const projectAssets = useMemo(
    () => (reviewSnapshot?.assets?.length ? reviewSnapshot.assets : assets).filter((asset) => asset.project_id === project?.id),
    [assets, project?.id, reviewSnapshot?.assets],
  );

  const sourceAssets = useMemo(
    () =>
      projectAssets.filter((asset) =>
        ["floorplan", "render_input", "reference_image", "space_input", "su_view", "logo"].includes(
          asset.type,
        ),
      ),
    [projectAssets],
  );
  const outputAssets = useMemo(
    () =>
      projectAssets.filter((asset) =>
        ["board_output", "render_output", "floorplan"].includes(asset.type)
        && ["provider_generation", "board_preview_renderer"].includes(asset.source ?? ""),
      ),
    [projectAssets],
  );
  const boardDocuments = reviewSnapshot?.board_documents ?? [];
  const exportRecords = reviewSnapshot?.exports ?? [];
  const extractedItems = reviewSnapshot?.extracted_items ?? [];
  const previewAssetById = useMemo(
    () => new Map(projectAssets.map((asset) => [asset.id, asset])),
    [projectAssets],
  );

  return (
    <div className="page-stack">
      {!project ? (
        <section className="panel-surface p-6">
          <div className="eyebrow">{text("项目不存在", "Project not found")}</div>
          <h2 className="mt-2 text-2xl font-semibold text-studio-navy">{text("请选择或创建项目。", "Select or create a project.")}</h2>
          <Link to="/projects" className="btn-primary mt-4 inline-flex">{text("前往项目", "View projects")}</Link>
        </section>
      ) : null}
      {project ? (
      <>
      <section className="page-hero">
        <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
          <div>
            <div className="eyebrow">{project?.client_name}</div>
            <h2 className="hero-title">{project?.name}</h2>
            <p className="body-muted mt-2 max-w-3xl">{project?.description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {(project?.style_tags ?? "")
                .split(",")
                .filter(Boolean)
                .map((tag) => (
                  <span key={tag} className="tag-chip">
                    {localeLabel(tag.trim(), locale)}
                  </span>
                ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <MetricCard label={text("源素材", "Source assets")} value={sourceAssets.length} />
            <MetricCard label={text("方案板文档", "Board documents")} value={boardDocuments.length} />
            <MetricCard label={text("提取元素", "Extracted items")} value={extractedItems.length} />
            <MetricCard label={text("导出记录", "Exports")} value={exportRecords.length} />
            <div className="panel-muted p-4">
              <div className="eyebrow">{text("归档路径", "Archive path")}</div>
              <div className="mt-2 break-all text-sm text-studio-mutedText">{project?.archive_root_path}</div>
            </div>
          </div>
        </div>
      </section>

      <WorkflowLaunchPanel title={text("在这个项目下继续生成", "Continue in this project")} eyebrow={text("工作流入口", "Workflows")} />

      <OutputGalleryPanel
        title={text("项目输出图库", "Project output gallery")}
        assets={outputAssets}
        projects={projects}
        onAssetExported={(asset) => {
          if (asset.project_id) {
            void fetchSnapshot(asset.project_id);
          }
        }}
      />

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <GroupedPanel
          eyebrow={text("已上传源素材", "Uploaded sources")}
          title={text("项目关联输入", "Project inputs")}
          empty={text("还没有归档源素材。", "No source assets archived yet.")}
          items={sourceAssets.map((asset) => ({
            title: asset.file_name,
            subtitle: `${localeLabel(asset.type, locale)} · ${localeLabel(asset.room_type, locale) || text("通用", "General")}`,
            meta: asset.file_path,
          }))}
        />
        <GroupedPanel
          eyebrow={text("已生成素材", "Generated assets")}
          title={text("方案板和渲染输出", "Boards and renderings")}
          empty={text("生成后会在这里显示输出素材。", "Generated assets appear here.")}
          items={outputAssets.slice(0, 6).map((asset) => ({
            title: asset.file_name,
            subtitle: `${localeLabel(asset.type, locale)} · ${localeLabel(asset.source, locale) || text("已生成", "Generated")}`,
            meta: asset.file_path,
            assetId: asset.id,
          }))}
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <GroupedPanel
          eyebrow={text("方案板文档", "Board documents")}
          title={text("可回看的方案板历史", "Board history")}
          empty={text("还没有保存方案板文档。", "No board documents saved yet.")}
          items={boardDocuments.map((board) => ({
            title: board.title,
            subtitle: `${localeLabel(board.board_type, locale)} · ${text("任务", "Task")} #${board.task_id ?? text("暂无", "N/A")}`,
            meta: `${previewAssetById.get(board.preview_asset_id ?? -1)?.file_name ?? `${text("预览素材", "Preview asset")} #${board.preview_asset_id ?? text("等待中", "Pending")}`} · ${text("已提取", "Extracted")} ${Array.isArray(board.data_json?.selected_items) ? board.data_json.selected_items.length : extractedItems.length} ${text("项", "items")}`,
            assetId: board.preview_asset_id,
          }))}
        />
        <div className="space-y-5">
          <GroupedPanel
            eyebrow={text("导出", "Exports")}
            title={text("导出记录", "Export history")}
            empty={text("还没有导出记录。", "No exports yet.")}
            items={exportRecords.map((record) => ({
              title: record.file_name,
              subtitle: `${record.type.toUpperCase()} · ${text("任务", "Task")} #${record.task_id ?? text("暂无", "N/A")}`,
              meta: record.file_path,
            }))}
          />
          <GroupedPanel
            eyebrow={text("提取元素", "Extracted items")}
            title={text("可复用的方案板选择", "Reusable board selections")}
            empty={text("还没有持久化提取元素。", "No extracted items saved yet.")}
            items={extractedItems.slice(0, 6).map((item) => ({
              title: item.name,
              subtitle: `${localeLabel(item.category, locale) || text("元素", "Item")} · ${localeLabel(item.selection_state, locale) || text("未决定", "Undecided")}`,
              meta: `${item.material ?? text("材质", "Material")} · ${item.color ?? text("颜色", "Color")}`,
            }))}
          />
        </div>
      </section>

      <GroupedPanel
        eyebrow={text("最近任务", "Recent tasks")}
        title={text("项目任务历史", "Project task history")}
        empty={text("这个项目还没有任务历史。", "This project has no task history yet.")}
        items={projectTasks.map((task) => ({
          title: `${localeLabel(task.task_type, locale)} · ${localeLabel(task.status, locale)}`,
          subtitle: taskRuntimeLabel(task, providerConfigs.find((config) => config.id === task.provider_config_id)
            ?? providerConfigs.find((config) => config.provider_name === task.provider && (config.model_id ?? config.model_name) === task.model_name), locale),
          meta: task.prompt_snapshot_json?.resolved_prompt ?? text("提示词快照等待中", "Prompt snapshot pending"),
        }))}
      />

      {project && <ProjectReviewPanel projectId={project.id} />}
      </>
      ) : null}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="panel-muted p-4">
      <div className="eyebrow">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-studio-navy">{value}</div>
    </div>
  );
}

function GroupedPanel({
  eyebrow,
  title,
  items,
  empty,
}: {
  eyebrow: string;
  title: string;
  items: Array<{ title: string; subtitle: string; meta: string; assetId?: number | null }>;
  empty: string;
}) {
  return (
    <section className="panel-surface p-5">
      <div className="mb-4">
        <div className="eyebrow">{eyebrow}</div>
        <h3 className="mt-2 text-xl font-semibold text-studio-navy">{title}</h3>
      </div>
      <div className="grid gap-3">
        {items.length > 0 ? (
          items.map((item) => (
            <div key={`${item.title}-${item.meta}`} className="panel-muted p-4">
              {item.assetId ? (
                <AssetImage
                  assetId={item.assetId}
                  alt={item.title}
                  className="mb-3 h-36 w-full rounded-lg border border-studio-border object-cover"
                />
              ) : null}
              <div className="font-medium text-studio-navy">{item.title}</div>
              <div className="mt-1 text-sm text-studio-mutedText">{item.subtitle}</div>
              <div className="mt-2 text-xs font-medium text-studio-mutedText">{item.meta}</div>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-studio-border bg-studio-panelBg px-4 py-6 text-sm font-medium text-studio-mutedText">
            {empty}
          </div>
        )}
      </div>
    </section>
  );
}
