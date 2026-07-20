import { useState } from "react";

import { openProjectFolder } from "../api/client";
import { ProjectCard } from "../components/ProjectCard";
import { SectionPanel, TagInput } from "../components/TaskConfigFields";
import { WorkflowLaunchPanel } from "../components/WorkflowLaunchPanel";
import { useProjectStore } from "../stores/useProjectStore";
import { useLocale } from "../i18n/locale";
import { localeLabel } from "../lib/zh-labels";

export function ProjectsPage() {
  const { locale, text } = useLocale();
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const createProject = useProjectStore((state) => state.createProject);
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [styleTags, setStyleTags] = useState<string[]>([]);
  const [roomTypes, setRoomTypes] = useState<string[]>([]);
  const [budgetMin, setBudgetMin] = useState(0);
  const [budgetMax, setBudgetMax] = useState(0);
  const [projectMessage, setProjectMessage] = useState("");
  const archivePath = `workspace/projects/${projectName.toLowerCase().replace(/\s+/g, "-")}`;
  const selectedProjectId = activeProjectId || projects[0]?.id;

  const createProjectFromDraft = async () => {
    setProjectMessage("");
    if (!projectName.trim()) {
      setProjectMessage(text("请填写项目名称。", "Enter a project name."));
      return;
    }
    const project = await createProject({
      name: projectName,
      client_name: clientName,
      style_tags: styleTags.join(", "),
      room_types: roomTypes.join(", "),
      budget_min: budgetMin,
      budget_max: budgetMax,
      archive_root_path: archivePath,
      status: "active",
    });
    setProjectMessage(text(`已创建项目 #${project.id}: ${project.archive_root_path}`, `Project #${project.id} created: ${project.archive_root_path}`));
  };

  const openCurrentProjectFolder = async () => {
    setProjectMessage("");
    if (!selectedProjectId) {
      setProjectMessage(text("请先创建或选择项目。", "Create or select a project first."));
      return;
    }
    const result = await openProjectFolder(selectedProjectId);
    setProjectMessage(text(`已打开：${result.path}`, `Opened: ${result.path}`));
  };

  return (
    <div className="page-stack">
      <section className="page-hero">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="eyebrow">{text("项目", "Projects")}</div>
            <h2 className="hero-title">{text("先创建项目。", "Create a project first.")}</h2>
            <p className="body-muted mt-2">{text("每次上传、生成、输出和复盘记录都会保存到当前选择的项目下面。", "Uploads, generations, outputs, and review history are saved under the selected project.")}</p>
          </div>
        </div>
      </section>

      <SectionPanel eyebrow={text("项目草稿", "Project draft")} title={text("创建项目资料", "Create project details")}>
        <div className="grid gap-4 xl:grid-cols-2">
          <input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder={text("项目名称", "Project name")} className="form-field w-full" />
          <input value={clientName} onChange={(event) => setClientName(event.target.value)} placeholder={text("客户名称", "Client name")} className="form-field w-full" />
          <TagInput label={text("风格标签", "Style tags")} values={styleTags} suggestions={["现代", "柔和极简", "酒店风", "暖木色", "轻奢"].map((value) => localeLabel(value, locale))} onChange={setStyleTags} />
          <TagInput label={text("空间类型", "Room types")} values={roomTypes} suggestions={["客厅", "餐厅", "卧室", "展厅", "大堂"].map((value) => localeLabel(value, locale))} onChange={setRoomTypes} />
          <input type="number" value={budgetMin} onChange={(event) => setBudgetMin(Number(event.target.value))} className="form-field w-full" />
          <input type="number" value={budgetMax} onChange={(event) => setBudgetMax(Number(event.target.value))} className="form-field w-full" />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => void createProjectFromDraft().catch((error) => setProjectMessage(error instanceof Error ? error.message : text("创建项目失败。", "Failed to create project.")))} className="btn-primary">{text("创建项目", "Create project")}</button>
          <button type="button" onClick={() => void openCurrentProjectFolder().catch((error) => setProjectMessage(error instanceof Error ? error.message : text("打开文件夹失败。", "Failed to open folder.")))} className="btn-secondary">{text("打开工作区文件夹", "Open workspace folder")}</button>
        </div>
        {projectMessage ? <div className="mt-4 rounded-lg border border-studio-border bg-studio-panelBg p-3 text-xs font-medium text-studio-mutedText">{projectMessage}</div> : null}
        <div className="mt-4 rounded-lg border border-studio-border bg-studio-panelBg p-3 text-xs font-medium text-studio-mutedText">
          {text("本地归档路径", "Local archive path")}: {archivePath}
        </div>
      </SectionPanel>

      <WorkflowLaunchPanel title={text("创建或选择项目后进入模块", "Enter a workflow after creating or selecting a project")} eyebrow={text("工作流入口", "Workflow entry")} />

      <div className="section-header">
        <h3 className="section-title">{text("本地项目", "Local projects")}</h3>
        <span className="status-pill">{text(`${projects.length} 个项目`, `${projects.length} projects`)}</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {projects.length > 0 ? projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        )) : (
          <div className="rounded-lg border border-dashed border-studio-border bg-studio-panelBg px-4 py-8 text-sm font-medium text-studio-mutedText">
            {text("还没有本地项目。", "No local projects yet.")}
          </div>
        )}
      </div>
    </div>
  );
}
