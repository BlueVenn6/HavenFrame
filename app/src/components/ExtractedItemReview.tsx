import { useEffect, useState } from "react";

import { itemReviewState, type ItemReviewState } from "../lib/board-item-review";
import { useLocale } from "../i18n/locale";
import { localeLabel } from "../lib/zh-labels";
import type { ExtractedItemRecord } from "../types";

interface ReviewUpdate {
  priceMin: number | null;
  priceMax: number | null;
  procurementStatus: "pending" | "purchased";
  quantity: number | null;
  purchaseMethod: string;
  purchaseUrl: string;
}

export function ExtractedItemReview({
  items,
  savingItemIds,
  emptyMessage,
  onSave,
}: {
  items: ExtractedItemRecord[];
  savingItemIds: number[];
  emptyMessage: string;
  onSave: (item: ExtractedItemRecord, state: ItemReviewState, details: ReviewUpdate) => Promise<void>;
}) {
  if (items.length === 0) {
    return <div className="panel-muted p-4 text-sm font-medium text-studio-mutedText xl:col-span-2">{emptyMessage}</div>;
  }

  return <>{items.map((item) => <ReviewItem key={item.id} item={item} isSaving={savingItemIds.includes(item.id)} onSave={onSave} />)}</>;
}

function ReviewItem({
  item,
  isSaving,
  onSave,
}: {
  item: ExtractedItemRecord;
  isSaving: boolean;
  onSave: (item: ExtractedItemRecord, state: ItemReviewState, details: ReviewUpdate) => Promise<void>;
}) {
  const { locale, text } = useLocale();
  const state = itemReviewState(item);
  const [priceMin, setPriceMin] = useState(valueForInput(item.price_min));
  const [priceMax, setPriceMax] = useState(valueForInput(item.price_max));
  const [procurementStatus, setProcurementStatus] = useState<"pending" | "purchased">(item.procurement_status ?? "pending");
  const [quantity, setQuantity] = useState(valueForInput(item.quantity));
  const [purchaseMethod, setPurchaseMethod] = useState(item.purchase_method ?? "");
  const [purchaseUrl, setPurchaseUrl] = useState(item.purchase_url ?? "");
  const [localError, setLocalError] = useState<string>();
  const [savedMessage, setSavedMessage] = useState<string>();
  const hasUnsavedChanges = priceMin !== valueForInput(item.price_min)
    || priceMax !== valueForInput(item.price_max)
    || procurementStatus !== (item.procurement_status ?? "pending")
    || quantity !== valueForInput(item.quantity)
    || purchaseMethod !== (item.purchase_method ?? "")
    || purchaseUrl !== (item.purchase_url ?? "");

  useEffect(() => {
    setPriceMin(valueForInput(item.price_min));
    setPriceMax(valueForInput(item.price_max));
    setProcurementStatus(item.procurement_status ?? "pending");
    setQuantity(valueForInput(item.quantity));
    setPurchaseMethod(item.purchase_method ?? "");
    setPurchaseUrl(item.purchase_url ?? "");
    setSavedMessage(undefined);
  }, [item.id, item.price_min, item.price_max, item.procurement_status, item.purchase_method, item.purchase_url, item.quantity]);

  const persist = async (nextState: ItemReviewState) => {
    const min = numberOrNull(priceMin);
    const max = numberOrNull(priceMax);
    if (min != null && max != null && min > max) {
      setLocalError(text("最低预算不能高于最高预算。", "Minimum budget cannot exceed maximum budget."));
      return;
    }
    const normalizedUrl = purchaseUrl.trim();
    const normalizedQuantity = integerOrNull(quantity);
    if (quantity.trim() && normalizedQuantity == null) {
      setLocalError(text("数量必须是大于 0 的整数。", "Quantity must be a positive integer."));
      return;
    }
    if (normalizedUrl && !/^https?:\/\//i.test(normalizedUrl)) {
      setLocalError(text("购买链接必须以 http:// 或 https:// 开头。", "Purchase URL must start with http:// or https://."));
      return;
    }
    setLocalError(undefined);
    setSavedMessage(undefined);
    try {
      await onSave(item, nextState, {
        priceMin: min,
        priceMax: max,
        procurementStatus,
        quantity: normalizedQuantity,
        purchaseMethod: purchaseMethod.trim(),
        purchaseUrl: normalizedUrl,
      });
      setSavedMessage(nextState === "remove"
        ? text("已删除，不会进入方案板或导出。", "Removed. This item will not be included in boards or exports.")
        : text("已保留；预算和采购信息按当前填写保存。", "Kept. Optional budget and procurement details were saved."));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : text("人工确认结果保存失败，请重试。", "Could not save the review. Please try again."));
    }
  };

  return (
    <div className={`min-w-0 rounded-lg border p-3 ${state === "remove" ? "border-rose-200 bg-rose-50/50" : "border-studio-border bg-studio-panelBg"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="break-words font-semibold text-studio-navy">{item.name}</div>
          <div className="mt-1 text-xs font-medium text-studio-mutedText">
            {localeLabel(item.room_type ?? item.category ?? text("房间元素", "Room item"), locale)} · {item.material ?? text("材质待确认", "Material pending")} · {item.color ?? text("颜色待确认", "Color pending")}
          </div>
        </div>
        <span className="status-pill">{state === "keep" ? text("保留", "Kept") : state === "remove" ? text("已删除", "Removed") : text("待确认", "Pending")}</span>
      </div>

      <div className="mt-3 flex gap-2">
        <button type="button" disabled={isSaving} onClick={() => void persist("keep")} className={state === "keep" ? "btn-primary px-3 py-2" : "btn-secondary px-3 py-2"}>{text("保留", "Keep")}</button>
        <button type="button" disabled={isSaving} onClick={() => void persist("remove")} className={state === "remove" ? "rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white" : "btn-secondary px-3 py-2"}>{text("删除", "Remove")}</button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="block min-w-0">
          <span className="mb-1 block text-xs font-semibold text-studio-mutedText">{text("最低预算（可选）", "Minimum budget (optional)")}</span>
          <input type="number" min={0} value={priceMin} disabled={isSaving} onChange={(event) => { setPriceMin(event.target.value); setSavedMessage(undefined); }} className="form-field w-full" />
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-xs font-semibold text-studio-mutedText">{text("最高预算（可选）", "Maximum budget (optional)")}</span>
          <input type="number" min={0} value={priceMax} disabled={isSaving} onChange={(event) => { setPriceMax(event.target.value); setSavedMessage(undefined); }} className="form-field w-full" />
        </label>
      </div>
      <div className="mt-3 border-t border-studio-border pt-3">
        <div className="text-xs font-semibold text-studio-mutedText">{text("采购信息（可选）", "Procurement (optional)")}</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-semibold text-studio-mutedText">{text("采购状态", "Procurement status")}</span>
            <select value={procurementStatus} disabled={isSaving} onChange={(event) => { setProcurementStatus(event.target.value as "pending" | "purchased"); setSavedMessage(undefined); }} className="form-field w-full">
              <option value="pending">{text("未采购", "Not purchased")}</option>
              <option value="purchased">{text("已采购", "Purchased")}</option>
            </select>
          </label>
          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-semibold text-studio-mutedText">{text("数量", "Quantity")}</span>
            <input type="number" min={1} step={1} value={quantity} disabled={isSaving} onChange={(event) => { setQuantity(event.target.value); setSavedMessage(undefined); }} className="form-field w-full" placeholder={text("可选", "Optional")} />
          </label>
        </div>
        <label className="mt-2 block min-w-0">
          <span className="mb-1 block text-xs font-semibold text-studio-mutedText">{text("购买方式 / 渠道", "Purchase method / channel")}</span>
          <input value={purchaseMethod} disabled={isSaving} onChange={(event) => { setPurchaseMethod(event.target.value); setSavedMessage(undefined); }} className="form-field w-full" placeholder={text("品牌官网、线下门店或电商平台", "Brand website, store, or marketplace")} />
        </label>
        <label className="mt-2 block min-w-0">
          <span className="mb-1 block text-xs font-semibold text-studio-mutedText">{text("购买链接", "Purchase URL")}</span>
          <input type="url" value={purchaseUrl} disabled={isSaving} onChange={(event) => { setPurchaseUrl(event.target.value); setSavedMessage(undefined); }} className="form-field w-full" placeholder="https://" />
        </label>
      </div>
      {state === "keep" ? <button type="button" disabled={isSaving} onClick={() => void persist("keep")} className="btn-secondary mt-2 px-3 py-2">{isSaving ? text("正在保存...", "Saving...") : text("保存可选信息", "Save optional details")}</button> : null}
      {hasUnsavedChanges ? <div className="mt-2 text-xs font-semibold text-amber-700">{text("当前修改尚未保存。", "Current changes are not saved.")}</div> : null}
      {localError ? <div className="mt-2 text-xs font-semibold text-rose-700">{localError}</div> : null}
      {savedMessage ? <div className="mt-2 text-xs font-semibold text-emerald-700">{savedMessage}</div> : null}
    </div>
  );
}

function valueForInput(value?: number | null): string {
  return value == null ? "" : String(value);
}

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function integerOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
