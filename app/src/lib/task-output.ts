import type { AssetRecord, ExtractedItemRecord } from "../types";

export function firstResultAsset(output?: Record<string, unknown>): AssetRecord | undefined {
  const assets = output?.assets;
  return Array.isArray(assets) ? (assets[0] as AssetRecord | undefined) : undefined;
}

export function extractedResultItems(output?: Record<string, unknown>): ExtractedItemRecord[] {
  const items = output?.extracted_items;
  return Array.isArray(items) ? (items as ExtractedItemRecord[]) : [];
}
