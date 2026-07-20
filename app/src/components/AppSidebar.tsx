import { useCallback, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";

import { ensureLocalSession, getApiBase } from "../api/client";
import { useLocale } from "../i18n/locale";

const items = [
  { to: "/projects", zh: "项目", en: "Projects" },
  { to: "/floorplan", zh: "平面图", en: "Floor Plans" },
  { to: "/single-room-board", zh: "单房间方案板", en: "Single-Room Board" },
  { to: "/multi-room-board", zh: "多房间方案板", en: "Multi-Room Board" },
  { to: "/space-render", zh: "空间渲染", en: "Space Rendering" },
  { to: "/custom-tasks", zh: "自定义任务", en: "Custom Tasks" },
  { to: "/prompt-center", zh: "提示词", en: "Prompts" },
  { to: "/model-settings", zh: "模型设置", en: "Model Settings" },
];

export function AppSidebar() {
  const { text } = useLocale();
  const [backendConnected, setBackendConnected] = useState<boolean | undefined>();

  const checkBackend = useCallback(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2500);
    void ensureLocalSession()
      .then(() => fetch(`${getApiBase()}/health`, { credentials: "include", signal: controller.signal }))
      .then((response) => setBackendConnected(response.ok))
      .catch(() => setBackendConnected(false))
      .finally(() => window.clearTimeout(timeout));
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    const cleanup = checkBackend();
    const interval = window.setInterval(checkBackend, 5000);
    return () => {
      cleanup();
      window.clearInterval(interval);
    };
  }, [checkBackend]);

  return (
    <aside className="flex min-h-0 min-w-0 max-w-full flex-col gap-4 overflow-hidden rounded-lg border border-slate-800 bg-studio-darkBg p-4 text-white shadow-panel lg:h-full lg:gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3 lg:block">
        <a href="/" className="block">
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-teal-200">{text("栖构", "HavenFrame")}</div>
        <h1 className="mt-3 text-xl font-semibold">{text("栖构工作台", "HavenFrame")}</h1>
        </a>
        <p className="max-w-2xl text-sm leading-5 text-slate-200 lg:mt-2">{text("室内 AI 交付助理：管理项目文件、生成结果和任务队列。", "Interior AI delivery assistant for projects, generated results, and tasks.")}</p>
      </div>

      <nav className="workspace-scroll flex min-h-0 gap-1 overflow-x-auto pb-1 lg:flex-1 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:pb-0 lg:pr-1">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                isActive ? "bg-studio-primary text-white" : "text-slate-200 hover:bg-white/10 hover:text-white"
              }`
            }
          >
            {text(item.zh, item.en)}
          </NavLink>
        ))}
      </nav>

      <div className="hidden border-t border-white/15 pt-3 lg:block">
        <div className="text-xs font-semibold uppercase tracking-[0.08em] text-teal-200">{text("应用服务", "App Service")}</div>
        <div className="mt-2 grid gap-1 text-xs text-slate-200">
          <div className="flex items-center justify-between">
            <span>{text("归档", "Archive")}</span>
            <span className="font-semibold text-white">{backendConnected ? text("待检测", "Pending") : backendConnected === false ? text("未连接", "Disconnected") : text("检测中", "Checking")}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>{text("模型", "Models")}</span>
            <span className="font-semibold text-white">{backendConnected ? text("待检测", "Pending") : backendConnected === false ? text("未知", "Unknown") : text("检测中", "Checking")}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
