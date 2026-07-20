import { useCallback, useEffect, useState } from "react";

import { ensureLocalSession, getApiBase } from "../api/client";
import { useLocale } from "../i18n/locale";

export function TopBar() {
  const { locale, setLocale, text } = useLocale();
  const [backendStatus, setBackendStatus] = useState<"checking" | "running" | "failed">("checking");

  const checkBackend = useCallback(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2500);
    void ensureLocalSession()
      .then(() => fetch(`${getApiBase()}/health`, { credentials: "include", signal: controller.signal }))
      .then((response) => {
        setBackendStatus(response.ok ? "running" : "failed");
      })
      .catch(() => setBackendStatus("failed"))
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

  const backendBadge =
    backendStatus === "running"
      ? { text: text("后端运行中", "Backend running"), className: "bg-emerald-50 text-emerald-700" }
      : backendStatus === "checking"
        ? { text: text("后端检测中", "Checking backend"), className: "bg-amber-50 text-amber-700" }
        : { text: text("后端未连接", "Backend disconnected"), className: "bg-rose-50 text-rose-700" };

  return (
    <header className="panel-surface flex min-w-0 flex-wrap items-center justify-between gap-3 px-5 py-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-studio-primaryHover">{text("设计交付系统", "Design Delivery System")}</p>
        <h2 className="mt-1 text-lg font-semibold text-studio-navy">{text("栖构工作区", "HavenFrame Workspace")}</h2>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-studio-mutedText">
        <span className={`rounded-full px-3 py-1 font-medium ${backendBadge.className}`}>{backendBadge.text}</span>
        <label className="sr-only" htmlFor="app-locale">{text("界面语言", "Interface language")}</label>
        <select
          id="app-locale"
          value={locale}
          onChange={(event) => setLocale(event.target.value as "zh-CN" | "en")}
          className="rounded-lg border border-studio-border bg-white px-3 py-1.5 font-semibold text-studio-ink"
        >
          <option value="zh-CN">中文</option>
          <option value="en">English</option>
        </select>
        <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-studio-ink">{text("桌面应用", "Desktop app")}</span>
        <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-studio-ink">
          {backendStatus === "running" ? text("本机归档", "Local archive") : text("归档待检测", "Archive pending")}
        </span>
      </div>
    </header>
  );
}
