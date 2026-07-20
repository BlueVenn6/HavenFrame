import { Link } from "react-router-dom";

import type { Project } from "../types";
import { localeLabel, zhList } from "../lib/zh-labels";
import { useLocale } from "../i18n/locale";

export function ProjectCard({ project }: { project: Project }) {
  const { locale, text } = useLocale();
  return (
    <Link
      to={`/projects/${project.id}`}
      className="panel-surface block p-4 transition hover:border-studio-primary"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{project.client_name}</div>
          <h3 className="mt-1 text-lg font-semibold text-studio-navy">{project.name}</h3>
        </div>
        <span className="shrink-0 rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-800">{localeLabel(project.status, locale)}</span>
      </div>
      <p className="mt-2 text-sm leading-5 text-studio-mutedText">{project.description}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {zhList(project.style_tags).split(",").filter(Boolean).map((tag) => (
          <span key={tag} className="tag-chip">
            {localeLabel(tag.trim(), locale)}
          </span>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-studio-border pt-3">
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-studio-mutedText">{text("查看项目输出", "View project outputs")}</span>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-studio-mutedText">{text("进入后选择工作流", "Open and choose a workflow")}</span>
      </div>
    </Link>
  );
}
