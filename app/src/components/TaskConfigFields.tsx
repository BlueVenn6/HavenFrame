import { useMemo, useState } from "react";
import type React from "react";
import { useLocale } from "../i18n/locale";
import { localizeBuiltinText } from "../i18n/builtin-content";
import { localeLabel } from "../lib/zh-labels";

type Option = string | { label: string; value: string };

function optionLabel(option: Option): string {
  return typeof option === "string" ? option : option.label;
}

function optionValue(option: Option): string {
  return typeof option === "string" ? option : option.value;
}

export function SectionPanel({
  eyebrow,
  title,
  action,
  children,
}: {
  eyebrow?: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel-surface min-w-0 p-5">
      <div className="section-header">
        <div className="min-w-0">
          {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
          <h3 className="section-title mt-2">{title}</h3>
        </div>
        {action}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function StatusPill({ tone = "slate", children }: { tone?: "teal" | "amber" | "rose" | "slate"; children: React.ReactNode }) {
  const className =
    tone === "teal"
      ? "border-teal-200 bg-teal-50 text-teal-800"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : tone === "rose"
          ? "border-rose-200 bg-rose-50 text-rose-800"
          : "border-studio-border bg-slate-100 text-studio-ink";
  return <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${className}`}>{children}</span>;
}

export function CustomizableSelect({
  label,
  value,
  customValue,
  options,
  onChange,
  onCustomChange,
  help,
}: {
  label: string;
  value: string;
  customValue?: string;
  options: Option[];
  onChange: (value: string) => void;
  onCustomChange?: (value: string) => void;
  help?: string;
}) {
  const { locale, text } = useLocale();
  const isCustom = value === "Custom" || value === "自定义";
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="form-field w-full">
        {options.map((option) => (
          <option key={optionValue(option)} value={optionValue(option)}>
            {localeLabel(optionLabel(option), locale)}
          </option>
        ))}
      </select>
      {isCustom ? (
        <input
          value={customValue ?? ""}
          onChange={(event) => onCustomChange?.(event.target.value)}
          placeholder={text(`自定义${label}`, `Custom ${label}`)}
          className="form-field mt-2 w-full"
        />
      ) : null}
      {help ? <div className="mt-1 text-xs font-medium text-studio-mutedText">{help}</div> : null}
    </label>
  );
}

export function TagInput({
  label,
  values,
  onChange,
  suggestions = [],
  placeholder,
  help,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  help?: string;
}) {
  const { locale, text } = useLocale();
  const [draft, setDraft] = useState("");
  const normalizedValues = useMemo(() => values.filter(Boolean), [values]);

  const addValue = (nextValue: string) => {
    const cleaned = nextValue.trim();
    if (!cleaned || normalizedValues.includes(cleaned)) return;
    onChange([...normalizedValues, cleaned]);
    setDraft("");
  };

  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{label}</div>
      <div className="flex min-w-0 flex-wrap gap-2 rounded-lg border border-studio-border bg-white p-2">
        {normalizedValues.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onChange(normalizedValues.filter((item) => item !== value))}
            className="max-w-full rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-800 transition hover:bg-teal-100"
            title={text("点击移除", "Click to remove")}
          >
            <span className="break-words">{localeLabel(value, locale)}</span>
          </button>
        ))}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addValue(draft);
            }
          }}
          onBlur={() => addValue(draft)}
          placeholder={placeholder ?? text("添加标签", "Add tag")}
          className="min-w-[150px] flex-1 bg-transparent px-2 py-1 text-sm font-medium text-studio-navy outline-none placeholder:text-slate-500"
        />
      </div>
      {suggestions.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {suggestions
            .filter((suggestion) => !normalizedValues.includes(suggestion))
            .slice(0, 8)
            .map((suggestion) => (
              <button key={suggestion} type="button" onClick={() => addValue(suggestion)} className="tag-chip hover:border-studio-primary">
                + {localeLabel(suggestion, locale)}
              </button>
            ))}
        </div>
      ) : null}
      {help ? <div className="mt-1 text-xs font-medium text-studio-mutedText">{help}</div> : null}
    </div>
  );
}

export function SliderField({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  help,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  help?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="panel-muted block min-w-0 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-studio-navy">{label}</span>
        <span className="status-pill">{value}</span>
      </div>
      {help ? <div className="mt-1 text-xs leading-5 text-studio-mutedText">{help}</div> : null}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-3 w-full accent-studio-primary"
      />
    </label>
  );
}

export function PromptTextarea({
  label,
  value,
  onChange,
  help,
  rows = 5,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  help?: string;
  rows?: number;
  placeholder?: string;
}) {
  const { text } = useLocale();
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-studio-mutedText">{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="textarea-field w-full resize-y"
      />
      <div className="mt-1 flex items-center justify-between gap-3 text-xs font-medium text-studio-mutedText">
        <span>{help}</span>
        <span>{text(`${value.length} 字`, `${value.length} chars`)}</span>
      </div>
    </label>
  );
}

export function ReferenceSlotCard({
  label,
  status,
  required,
  note,
  onStatusChange,
}: {
  label: string;
  status: "empty" | "attached" | "required" | "optional";
  required?: boolean;
  note?: string;
  onStatusChange: (status: "empty" | "attached" | "required" | "optional") => void;
}) {
  const { locale, text } = useLocale();
  const tone = status === "attached" ? "teal" : required || status === "required" ? "amber" : "slate";
  return (
    <div className="panel-muted min-w-0 p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-studio-navy">{localeLabel(label, locale)}</div>
          <div className="mt-1 text-xs leading-5 text-studio-mutedText">{note ? localizeBuiltinText(note, locale) : text("仅占位，不会触发上传。", "Placeholder only; it does not trigger an upload.")}</div>
        </div>
        <StatusPill tone={tone}>{statusLabel(status, text)}</StatusPill>
      </div>
      <select value={status} onChange={(event) => onStatusChange(event.target.value as "empty" | "attached" | "required" | "optional")} className="form-field mt-3 w-full">
        <option value="empty">{text("空", "Empty")}</option>
        <option value="attached">{text("已附加", "Attached")}</option>
        <option value="required">{text("必需", "Required")}</option>
        <option value="optional">{text("可选", "Optional")}</option>
      </select>
    </div>
  );
}

export function PayloadPreview({
  payload,
  title,
  defaultExpanded = false,
  eyebrow,
}: {
  payload: unknown;
  title?: string;
  defaultExpanded?: boolean;
  eyebrow?: string;
}) {
  const { text } = useLocale();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const json = JSON.stringify(payload, null, 2);

  return (
    <div className="panel-surface min-w-0 p-5">
      <div className="section-header">
        <div>
          <div className="eyebrow">{eyebrow ?? text("高级", "Advanced")}</div>
          <h3 className="section-title mt-2">{title ?? text("请求预览", "Request preview")}</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setExpanded((value) => !value)} className="btn-secondary">
            {expanded ? text("收起", "Collapse") : text("展开", "Expand")}
          </button>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(json)} className="btn-secondary">
            {text("复制请求内容", "Copy request")}
          </button>
        </div>
      </div>
      {expanded ? (
        <pre className="max-h-[360px] overflow-auto rounded-lg border border-studio-border bg-slate-950 p-4 text-xs leading-5 text-slate-100">
          {json}
        </pre>
      ) : null}
    </div>
  );
}

export function ActionBar({
  onSave,
  onQueue,
  onReset,
  queueDisabled,
  queueLabel,
}: {
  onSave?: () => void;
  onQueue?: () => void;
  onReset?: () => void;
  queueDisabled?: boolean;
  queueLabel?: string;
}) {
  const { text } = useLocale();
  return (
    <div className="panel-surface flex min-w-0 flex-wrap items-center justify-between gap-3 p-4">
      <div className="text-sm font-medium text-studio-mutedText">{text("操作将提交到应用任务队列。", "Actions are submitted to the app task queue.")}</div>
      <div className="flex flex-wrap gap-2">
        {onSave ? <button type="button" onClick={onSave} className="btn-secondary">{text("保存草稿", "Save draft")}</button> : null}
        {onReset ? <button type="button" onClick={onReset} className="btn-secondary">{text("重置", "Reset")}</button> : null}
        {onQueue ? <button type="button" onClick={onQueue} disabled={queueDisabled} className="btn-primary">{queueLabel ?? text("加入任务队列", "Add to task queue")}</button> : null}
      </div>
    </div>
  );
}

function statusLabel(status: "empty" | "attached" | "required" | "optional", text: (zh: string, en: string) => string): string {
  const labels = {
    empty: text("空", "Empty"),
    attached: text("已附加", "Attached"),
    required: text("必需", "Required"),
    optional: text("可选", "Optional"),
  };
  return labels[status];
}
