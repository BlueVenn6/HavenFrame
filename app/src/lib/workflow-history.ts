import type { AssetRecord } from "../types";

export const OUTPUT_ASSET_TYPES = ["board_output", "render_output", "floorplan"];

export function latestOutputForModule(
  assets: AssetRecord[],
  moduleName: string,
  projectId?: number,
  inputAssetIds: number[] = [],
  allowInputless = false,
): AssetRecord | undefined {
  if (inputAssetIds.length === 0 && !allowInputless) return undefined;
  return assets
    .filter((asset) => (projectId ? asset.project_id === projectId : true))
    .filter((asset) => OUTPUT_ASSET_TYPES.includes(asset.type))
    .filter((asset) => moduleOf(asset) === moduleName)
    .filter((asset) => inputAssetIds.length === 0 || outputUsesInputs(asset, inputAssetIds))
    .sort(byNewest)[0];
}

export function outputMatchesBoardReview(
  asset: AssetRecord | undefined,
  sourceAssetIds: number[],
  selectedItemIds: number[],
  reviewSnapshot: string,
): boolean {
  const metadata = asset?.metadata_json ?? {};
  return metadata.review_schema_version === 2
    && metadata.delivery_prompt_version === "qigou-board-delivery-v2"
    && metadata.review_snapshot === reviewSnapshot
    && sameIds(metadata.source_asset_ids, sourceAssetIds)
    && sameIds(metadata.selected_item_ids, selectedItemIds);
}

export function outputMatchesSpaceRenderReferences(
  asset: AssetRecord | undefined,
  inputAssetIds: number[],
  referenceReviewSnapshot: string,
): boolean {
  const metadata = asset?.metadata_json ?? {};
  if (!sameIds(metadata.source_asset_ids, inputAssetIds)) return false;
  if (metadata.reference_review_snapshot === referenceReviewSnapshot) return true;
  return metadata.reference_review_snapshot == null && referenceSnapshotHasNoAssets(referenceReviewSnapshot);
}

function referenceSnapshotHasNoAssets(snapshot: string): boolean {
  try {
    const parsed = JSON.parse(snapshot) as { references?: unknown };
    return Array.isArray(parsed.references) && parsed.references.length === 0;
  } catch {
    return false;
  }
}

function sameIds(value: unknown, expected: number[]): boolean {
  if (!Array.isArray(value)) return false;
  const actual = value.map(Number).filter(Number.isInteger).sort((a, b) => a - b);
  const normalizedExpected = [...new Set(expected)].sort((a, b) => a - b);
  return actual.length === normalizedExpected.length
    && actual.every((item, index) => item === normalizedExpected[index]);
}

export function outputUsesInputs(output: AssetRecord, inputAssetIds: number[]): boolean {
  if (inputAssetIds.length === 0) return false;
  const sourceIds = output.metadata_json?.source_asset_ids;
  if (!Array.isArray(sourceIds)) return false;
  const normalized = new Set(sourceIds.filter((value): value is number => typeof value === "number"));
  return inputAssetIds.every((assetId) => normalized.has(assetId));
}

export function latestInputsForSource(assets: AssetRecord[], source: string, projectId?: number): AssetRecord[] {
  return assets
    .filter((asset) => (projectId ? asset.project_id === projectId : true))
    .filter((asset) => asset.source === source)
    .filter((asset) => !OUTPUT_ASSET_TYPES.includes(asset.type))
    .sort(byNewest)
    .slice(0, 8);
}

export function moduleOf(asset: AssetRecord): string {
  const moduleValue = asset.metadata_json?.module;
  if (typeof moduleValue === "string" && moduleValue) return moduleValue;
  if (asset.source && ["floorplan", "space_render", "single_room_board", "multi_room_board", "custom_tasks"].includes(asset.source)) {
    return asset.source;
  }
  if (asset.type === "floorplan") return "floorplan";
  if (asset.type === "board_output") return "boards";
  return "space_render";
}

function byNewest(left: AssetRecord, right: AssetRecord): number {
  return Date.parse(right.created_at) - Date.parse(left.created_at);
}
