import { createBrowserRouter } from "react-router-dom";

import { MainLayout } from "../layouts/MainLayout";
import { CustomTasksPage } from "../pages/CustomTasksPage";
import { DashboardPage } from "../pages/DashboardPage";
import { FloorplanPage } from "../pages/FloorplanPage";
import { ModelSettingsPage } from "../pages/ModelSettingsPage";
import { MultiRoomBoardPage } from "../pages/MultiRoomBoardPage";
import { ProjectDetailPage } from "../pages/ProjectDetailPage";
import { ProjectsPage } from "../pages/ProjectsPage";
import { PromptCenterPage } from "../pages/PromptCenterPage";
import { SingleRoomBoardPage } from "../pages/SingleRoomBoardPage";
import { SpaceRenderPage } from "../pages/SpaceRenderPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <MainLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "projects", element: <ProjectsPage /> },
      { path: "projects/:projectId", element: <ProjectDetailPage /> },
      { path: "floorplan", element: <FloorplanPage /> },
      { path: "single-room-board", element: <SingleRoomBoardPage /> },
      { path: "multi-room-board", element: <MultiRoomBoardPage /> },
      { path: "space-render", element: <SpaceRenderPage /> },
      { path: "custom-tasks", element: <CustomTasksPage /> },
      { path: "prompt-center", element: <PromptCenterPage /> },
      { path: "model-settings", element: <ModelSettingsPage /> },
    ],
  },
]);
