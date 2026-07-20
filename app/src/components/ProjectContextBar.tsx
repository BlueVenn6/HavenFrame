import { Link } from "react-router-dom";

import { useProjectStore } from "../stores/useProjectStore";
import { useLocale } from "../i18n/locale";

export function ProjectContextBar({
  label,
}: {
  label?: string;
}) {
  const { text } = useLocale();
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const setActiveProject = useProjectStore((state) => state.setActiveProject);
  const activeProject = projects.find((project) => project.id === activeProjectId);

  return (
    <section className="panel-surface min-w-0 p-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow">{label ?? text("项目", "Project")}</div>
          <div className="mt-1 text-lg font-semibold text-studio-navy">
            {activeProject ? activeProject.name : text("请先创建或选择项目", "Create or select a project")}
          </div>
          <div className="mt-1 text-xs font-medium text-studio-mutedText">
            {text("当前选择会决定上传素材、生成任务和输出文件归档到哪个项目。", "The current selection controls where uploads, tasks, and output files are archived.")}
          </div>
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
          {projects.length > 0 ? (
            <select value={activeProjectId || ""} onChange={(event) => setActiveProject(Number(event.target.value))} className="form-field min-w-0 flex-1 sm:min-w-64">
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          ) : null}
          {activeProject ? <Link to={`/projects/${activeProject.id}`} className="btn-secondary px-4 py-2 text-sm">{text("项目输出", "Project outputs")}</Link> : null}
          <Link to="/projects" className="btn-primary px-4 py-2 text-sm">{text("新建项目", "New project")}</Link>
        </div>
      </div>
    </section>
  );
}
