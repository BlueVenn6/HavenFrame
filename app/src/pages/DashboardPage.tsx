import { useEffect } from "react";
import { Link } from "react-router-dom";

import { OutputGalleryPanel } from "../components/OutputGalleryPanel";
import { WorkflowLaunchPanel } from "../components/WorkflowLaunchPanel";
import { useAssetStore } from "../stores/useAssetStore";
import { useProjectStore } from "../stores/useProjectStore";
import { useTaskStore } from "../stores/useTaskStore";
import { useLocale } from "../i18n/locale";

export function DashboardPage() {
  const { text } = useLocale();
  const projects = useProjectStore((state) => state.projects);
  const tasks = useTaskStore((state) => state.tasks);
  const assets = useAssetStore((state) => state.assets);
  const loadAssets = useAssetStore((state) => state.loadAssets);
  const runningTasks = tasks.filter((task) => task.status === "running").length;
  const liveTasks = tasks.filter((task) => task.task_type.startsWith("provider_")).length;
  const outputAssets = assets
    .filter((asset) => ["board_output", "render_output", "floorplan"].includes(asset.type))
    .filter((asset) => asset.source === "provider_generation" || asset.source === "board_preview_renderer");

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  return (
    <div className="page-stack">
      <section className="grid gap-2 rounded-lg border border-studio-border bg-white px-4 py-3 shadow-panel sm:grid-cols-2 2xl:grid-cols-4">
        {[
          [text("项目", "Projects"), text(`${projects.length} 个本地项目`, `${projects.length} local projects`)],
          [text("输出", "Outputs"), text(`${outputAssets.length} 个最近结果`, `${outputAssets.length} recent results`)],
          [text("队列", "Queue"), text(`${runningTasks} 个运行中 / 共 ${tasks.length} 个`, `${runningTasks} running / ${tasks.length} total`)],
          [text("模型调用", "Model calls"), text(`${liveTasks} 个真实任务`, `${liveTasks} real tasks`)],
        ].map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 rounded-md bg-studio-panelBg px-3 py-2">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{label}</div>
            <div className="text-sm font-semibold text-studio-navy">{value}</div>
          </div>
        ))}
      </section>

      <section className="page-hero">
        <div className="max-w-3xl">
          <div className="eyebrow">{text("工作台", "Dashboard")}</div>
          <h2 className="hero-title">{text("先创建项目，再开始生成。", "Create a project, then start generating.")}</h2>
          <p className="body-muted mt-2 max-w-2xl">{text("创建项目后选择工作流模块，生成结果会回到这里，并归档到对应项目中。", "Choose a workflow after creating a project. Generated results return here and are archived in that project.")}</p>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link to="/projects" className="btn-primary">
            {text("创建 / 选择项目", "Create / Select Project")}
          </Link>
          <Link to="/floorplan" className="btn-secondary">
            {text("平面图", "Floor Plan")}
          </Link>
          <Link to="/single-room-board" className="btn-secondary">{text("单房间方案板", "Single-Room Board")}</Link>
          <Link to="/space-render" className="btn-secondary">{text("空间渲染", "Space Rendering")}</Link>
        </div>
      </section>

      {projects.length === 0 ? (
        <section className="panel-surface p-6">
          <div className="eyebrow">{text("还没有项目", "No projects yet")}</div>
          <h3 className="mt-2 text-xl font-semibold text-studio-navy">{text("上传或生成前请先创建项目。", "Create a project before uploading or generating.")}</h3>
          <p className="body-muted mt-2 max-w-2xl">{text("这样每个平面图、方案板和渲染结果都会保存到正确的本地项目归档。", "This keeps every floor plan, board, and rendering in the correct local project archive.")}</p>
          <Link to="/projects" className="btn-primary mt-4 inline-flex">{text("创建项目", "Create project")}</Link>
        </section>
      ) : null}

      <WorkflowLaunchPanel title={text("从当前项目进入工作流", "Open a workflow for the current project")} eyebrow={text("生成路径", "Generation paths")} />

      <section className="min-w-0">
        <OutputGalleryPanel title={text("最近输出", "Recent outputs")} assets={outputAssets} projects={projects} maxItems={12} />
      </section>
    </div>
  );
}
