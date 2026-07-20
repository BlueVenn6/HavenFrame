import { Link } from "react-router-dom";
import { useLocale } from "../i18n/locale";

const workflows = [
  {
    path: "/floorplan",
    zh: "平面图", en: "Floor Plans",
    descriptionZh: "上传草图或平面图，生成 2D / 3D 展示图。", descriptionEn: "Upload a sketch or floor plan to create a 2D/3D presentation image.",
  },
  {
    path: "/space-render",
    zh: "空间渲染", en: "Space Rendering",
    descriptionZh: "上传空间图、白模或 SU 截图，生成精修效果图。", descriptionEn: "Upload a room image, white model, or SU screenshot for a refined rendering.",
  },
  {
    path: "/single-room-board",
    zh: "单房间方案板", en: "Single-Room Board",
    descriptionZh: "上传单张房间图，提取元素并生成方案板。", descriptionEn: "Upload one room image, extract elements, and create a design board.",
  },
  {
    path: "/multi-room-board",
    zh: "多房间方案板", en: "Multi-Room Board",
    descriptionZh: "上传多张房间图，生成整案方案板和预算摘要。", descriptionEn: "Upload multiple room images to create whole-project boards and a budget summary.",
  },
  {
    path: "/custom-tasks",
    zh: "自定义任务", en: "Custom Tasks",
    descriptionZh: "按自定义提示词生成可复用输出。", descriptionEn: "Create reusable outputs from a custom prompt.",
  },
];

export function WorkflowLaunchPanel({
  title,
  eyebrow,
}: {
  title?: string;
  eyebrow?: string;
}) {
  const { text } = useLocale();
  return (
    <section className="panel-surface p-5">
      <div className="mb-4">
        <div className="eyebrow">{eyebrow ?? text("下一步", "Next")}</div>
        <h3 className="section-title mt-2">{title ?? text("选择工作流", "Choose a workflow")}</h3>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {workflows.map((workflow) => (
          <Link
            key={workflow.path}
            to={workflow.path}
            className="rounded-lg border border-studio-border bg-studio-panelBg p-4 transition hover:border-studio-primary hover:bg-white"
          >
            <div className="text-sm font-semibold text-studio-navy">{text(workflow.zh, workflow.en)}</div>
            <div className="mt-2 text-xs leading-5 text-studio-mutedText">{text(workflow.descriptionZh, workflow.descriptionEn)}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
