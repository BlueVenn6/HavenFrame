import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";

import { ensureLocalSession } from "../api/client";
import { AppSidebar } from "../components/AppSidebar";
import { TaskDetailDrawer } from "../components/TaskDetailDrawer";
import { TaskQueueBar } from "../components/TaskQueueBar";
import { TopBar } from "../components/TopBar";
import { useModelStore } from "../stores/useModelStore";
import { useProjectStore } from "../stores/useProjectStore";
import { useTaskStore } from "../stores/useTaskStore";

export function MainLayout() {
  const [, setLocalSessionReady] = useState(false);
  const loadProjects = useProjectStore((state) => state.loadProjects);
  const loadTasks = useTaskStore((state) => state.loadTasks);
  const loadProviderConfigs = useModelStore((state) => state.loadProviderConfigs);

  useEffect(() => {
    let mounted = true;
    void ensureLocalSession().finally(() => {
      if (mounted) {
        setLocalSessionReady(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    void loadProjects();
    void loadTasks();
    void loadProviderConfigs();
  }, [loadProjects, loadProviderConfigs, loadTasks]);

  return (
    <div className="h-screen overflow-hidden bg-[#eef2f7] p-3 text-studio-navy sm:p-4">
      <div className="grid h-[calc(100vh-24px)] min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden sm:h-[calc(100vh-32px)] sm:gap-4 lg:grid-cols-workstation lg:grid-rows-1">
        <AppSidebar />
        <div className="flex min-h-0 min-w-0 flex-col">
          <TopBar />
          <div className="workspace-scroll mt-4 min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pb-16">
            <main className="min-w-0">
              <Outlet />
            </main>
            <TaskQueueBar />
          </div>
        </div>
      </div>
      <TaskDetailDrawer />
    </div>
  );
}
