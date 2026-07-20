import { useState } from "react";
import type { CSSProperties } from "react";

import { useAssetContentUrl } from "../hooks/useAssetContentUrl";
import { useLocale } from "../i18n/locale";

export function AssetImage({
  assetId,
  alt,
  className,
  style,
}: {
  assetId?: number | null;
  alt: string;
  className?: string;
  style?: CSSProperties;
}) {
  const { text } = useLocale();
  const src = useAssetContentUrl(assetId);
  const [failedSrc, setFailedSrc] = useState<string | undefined>();

  if (!src || failedSrc === src) {
    return (
      <div className={`flex h-full w-full items-center justify-center bg-slate-50 p-3 text-center text-xs font-semibold text-studio-mutedText ${className ?? ""}`} style={style}>
        {text("图片无法显示，请确认应用后端已连接并且会话有效。", "Image unavailable. Confirm that the application backend is connected and the session is valid.")}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      onError={() => setFailedSrc(src)}
    />
  );
}
