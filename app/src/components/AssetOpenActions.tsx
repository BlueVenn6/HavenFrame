import { useState } from "react";

import { openAssetFile, openAssetFolder } from "../api/client";
import type { AssetRecord } from "../types";
import { useLocale } from "../i18n/locale";

type ButtonSize = "sm" | "md";

export function AssetOpenActions({
  asset,
  size = "md",
  className = "",
}: {
  asset: Pick<AssetRecord, "id" | "file_path">;
  size?: ButtonSize;
  className?: string;
}) {
  const { text } = useLocale();
  const [message, setMessage] = useState<{ text: string; path?: string; tone?: "default" | "error" } | null>(null);
  const [busyAction, setBusyAction] = useState<"file" | "folder" | null>(null);
  const buttonClass = size === "sm" ? "px-3 py-2 text-xs" : "";

  const runAction = async (action: "file" | "folder") => {
    if (busyAction) return;
    setMessage(null);
    setBusyAction(action);
    try {
      const result = action === "file" ? await openAssetFile(asset.id) : await openAssetFolder(asset.id);
      setMessage({
        text: action === "file" ? text("已打开图片。", "Image opened.") : text("已打开文件夹。", "Folder opened."),
        path: result.path,
      });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : text("打开失败。", "Open failed."), tone: "error" });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void runAction("file")}
          disabled={busyAction !== null}
          className={`btn-secondary ${buttonClass}`}
        >
          {busyAction === "file" ? text("正在打开...", "Opening...") : text("打开图片", "Open image")}
        </button>
        <button
          type="button"
          onClick={() => void runAction("folder")}
          disabled={busyAction !== null}
          className={`btn-primary ${buttonClass}`}
        >
          {busyAction === "folder" ? text("正在打开...", "Opening...") : text("打开文件夹", "Open folder")}
        </button>
      </div>
      {message ? (
        <div className={`mt-2 text-xs font-medium ${message.tone === "error" ? "text-amber-700" : "text-studio-mutedText"}`}>
          <div>{message.text}</div>
          {message.path ? (
            <div className="workspace-scroll mt-1 max-w-full overflow-x-auto whitespace-nowrap rounded-md bg-studio-panelBg px-2 py-1 font-mono text-[11px] text-studio-mutedText">
              {text("位置", "Location")}: {message.path}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
