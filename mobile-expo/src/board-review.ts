import type { ExtractedItem } from "./types";

export function reviewedState(item: ExtractedItem): "keep" | "remove" | "undecided" {
  if (item.review_schema_version !== 2 || !item.selection_updated_at) return "undecided";
  return item.selection_state === "keep" ? "keep" : item.selection_state === "remove" || item.selection_state === "replace" ? "remove" : "undecided";
}

export function keptItems(items: ExtractedItem[]): ExtractedItem[] {
  return items.filter((item) => reviewedState(item) === "keep");
}

export function reviewSnapshot(items: ExtractedItem[]): string {
  return JSON.stringify(
    keptItems(items)
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
