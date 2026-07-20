import type { ExtractedItemRecord } from "../types";

export type ItemReviewState = "keep" | "remove" | "undecided";

export function itemReviewState(item: ExtractedItemRecord): ItemReviewState {
  if (item.review_schema_version !== 2 || !item.selection_updated_at) return "undecided";
  if (item.selection_state === "keep") return "keep";
  if (item.selection_state === "remove" || item.selection_state === "replace") return "remove";
  return "undecided";
}

export function keptReviewedItems(items: ExtractedItemRecord[]): ExtractedItemRecord[] {
  return items.filter((item) => itemReviewState(item) === "keep");
}

export function itemBudgetTotals(items: ExtractedItemRecord[]): { min: number; max: number } {
  return keptReviewedItems(items).reduce(
    (totals, item) => ({
      min: totals.min + Number(item.price_min ?? 0),
      max: totals.max + Number(item.price_max ?? 0),
    }),
    { min: 0, max: 0 },
  );
}

export function itemReviewSnapshot(items: ExtractedItemRecord[]): string {
  return JSON.stringify(
    keptReviewedItems(items)
      .sort((left, right) => left.id - right.id)
      .map((item) => ({
        id: item.id,
        price_min: item.price_min ?? null,
        price_max: item.price_max ?? null,
        procurement_status: item.procurement_status ?? "pending",
        quantity: item.quantity ?? null,
        purchase_method: item.purchase_method ?? "",
        purchase_url: item.purchase_url ?? "",
      })),
  );
}
