import { useRef, useState } from "react";

import { useAssetStore } from "../stores/useAssetStore";
import type { AssetRecord } from "../types";
import { AssetImage } from "./AssetImage";
import { useLocale } from "../i18n/locale";

export function AssetUploader({
  title,
  description,
  multiple = false,
  selectedFiles = [],
  existingAssets = [],
  onFilesSelected,
  uploadOptions,
  onAssetsUploaded,
  onAssetRemoved,
  accept = "image/*",
  maxFiles,
}: {
  title: string;
  description: string;
  multiple?: boolean;
  selectedFiles?: File[];
  existingAssets?: AssetRecord[];
  accept?: string;
  maxFiles?: number;
  onFilesSelected?: (files: File[]) => void;
  uploadOptions?: {
    projectId: number;
    assetType: string;
    roomType?: string;
    source?: string;
  };
  onAssetsUploaded?: (assets: AssetRecord[]) => void;
  onAssetRemoved?: (asset: AssetRecord) => void;
}) {
  const { text } = useLocale();
  const uploadAssets = useAssetStore((state) => state.uploadAssets);
  const deleteAsset = useAssetStore((state) => state.deleteAsset);
  const isUploading = useAssetStore((state) => state.isUploading);
  const uploadError = useAssetStore((state) => state.error);
  const [uploadedAssets, setUploadedAssets] = useState<AssetRecord[]>([]);
  const [localError, setLocalError] = useState<string | undefined>();
  const [deletingAssetIds, setDeletingAssetIds] = useState<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const displayedAssets = uploadedAssets.length > 0 ? uploadedAssets : existingAssets;

  const handleFiles = async (files: File[]) => {
    setLocalError(undefined);
    setUploadedAssets([]);
    if (maxFiles && files.length > maxFiles) {
      setLocalError(text(`一次最多选择 ${maxFiles} 个文件。`, `Select no more than ${maxFiles} files at a time.`));
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    onFilesSelected?.(files);
    if (files.length === 0) return;
    if (!uploadOptions) {
      setLocalError(text("请先创建或选择项目，然后再上传图片。", "Create or select a project before uploading images."));
      onAssetsUploaded?.([]);
      return;
    }
    try {
      const assets = await uploadAssets(files, uploadOptions);
      setUploadedAssets(assets);
      onAssetsUploaded?.(assets);
    } catch (error) {
      setUploadedAssets([]);
      onAssetsUploaded?.([]);
      setLocalError(error instanceof Error ? error.message : text("上传失败，请检查应用后端。", "Upload failed. Check the app backend."));
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRemoveAsset = async (asset: AssetRecord) => {
    setLocalError(undefined);
    setDeletingAssetIds((current) => [...new Set([...current, asset.id])]);
    try {
      await deleteAsset(asset.id);
      setUploadedAssets((current) => current.filter((item) => item.id !== asset.id));
      onAssetRemoved?.(asset);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : text("素材删除失败。", "Failed to remove the asset."));
    } finally {
      setDeletingAssetIds((current) => current.filter((id) => id !== asset.id));
    }
  };

  return (
    <div className="panel-surface border-dashed p-6">
      <label className="block cursor-pointer rounded-lg border border-dashed border-studio-border bg-studio-panelBg p-6 text-center transition hover:border-studio-primary hover:bg-teal-50/40">
        <div className="text-sm font-semibold text-studio-navy">{title}</div>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-studio-mutedText">{description}</p>
        <div className="btn-primary mt-4">
          {isUploading ? text("上传中...", "Uploading...") : text("选择文件", "Choose files")}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple={multiple}
          accept={accept}
          onChange={(event) => void handleFiles(Array.from(event.target.files ?? []))}
        />
      </label>
      {displayedAssets.length > 0 ? (
        <div className="mt-5 grid gap-3 text-left sm:grid-cols-2">
          {displayedAssets.map((asset) => (
            <div key={asset.id} className="min-w-0 rounded-lg border border-studio-border bg-white p-3 text-sm font-medium text-studio-ink">
              {asset.mime_type?.startsWith("image/") ? (
                <AssetImage assetId={asset.id} alt={asset.file_name} className="mb-3 aspect-[16/9] w-full rounded-md border border-studio-border object-cover" />
              ) : null}
              <div className="break-words">{asset.file_name}</div>
              <div className="mt-1 text-xs text-studio-mutedText">{text("已上传素材", "Uploaded asset")} #{asset.id}</div>
              <button type="button" disabled={deletingAssetIds.includes(asset.id)} onClick={() => void handleRemoveAsset(asset)} className="btn-secondary mt-3 px-3 py-2 text-xs">
                {deletingAssetIds.includes(asset.id) ? text("正在删除...", "Removing...") : text("删除此素材", "Remove asset")}
              </button>
            </div>
          ))}
        </div>
      ) : selectedFiles.length > 0 ? (
          <div className="mt-5 space-y-2 text-left">
            {selectedFiles.map((file) => (
              <div key={`${file.name}-${file.size}`} className="rounded-lg border border-studio-border bg-white px-4 py-3 text-sm font-medium text-studio-ink">
                {file.name} · {(file.size / 1024).toFixed(1)} KB
              </div>
            ))}
          </div>
      ) : (
          <div className="mt-5 text-xs font-medium text-studio-mutedText">
            {text("还没有选择文件。", "No files selected.")}
          </div>
      )}
      {localError || uploadError ? <div className="mt-3 text-xs font-semibold text-amber-800">{localError ?? uploadError}</div> : null}
    </div>
  );
}
