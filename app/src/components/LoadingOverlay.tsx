import { useLocale } from "../i18n/locale";

export function LoadingOverlay({ label }: { label?: string }) {
  const { text } = useLocale();
  return (
    <div className="panel-muted flex items-center justify-center gap-3 p-6">
      <div className="h-3 w-3 animate-pulse rounded-full bg-studio-primary" />
      <span className="text-sm font-medium text-studio-mutedText">{label ?? text("正在准备工作区...", "Preparing workspace...")}</span>
    </div>
  );
}
