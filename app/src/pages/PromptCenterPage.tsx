import { useEffect, useState } from "react";

import { PromptEditor } from "../components/PromptEditor";
import { PromptTextarea, SectionPanel, TagInput } from "../components/TaskConfigFields";
import { usePromptStore } from "../stores/usePromptStore";
import { useLocale } from "../i18n/locale";

export function PromptCenterPage() {
  const { locale, message: localizeMessage, text } = useLocale();
  const prompts = usePromptStore((state) => state.prompts);
  const savePromptDraft = usePromptStore((state) => state.savePromptDraft);
  const loadPrompts = usePromptStore((state) => state.loadPrompts);
  const promptError = usePromptStore((state) => state.error);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [draftName, setDraftName] = useState(locale === "zh-CN" ? "客户提案渲染提示词" : "Client proposal rendering prompt");
  const [draftPrompt, setDraftPrompt] = useState(locale === "zh-CN" ? "生成一个精修的 {room_type}，风格为 {style}，材质关键词为 {material_keywords}。" : "Create a refined {room_type} in {style} style using these material keywords: {material_keywords}.");
  const [draftNegative, setDraftNegative] = useState(locale === "zh-CN" ? "结构变形、杂乱、文字不可读" : "distorted structure, clutter, unreadable text");
  const [variables, setVariables] = useState(["room_type", "style", "material_keywords"]);
  const [negativeLibrary, setNegativeLibrary] = useState(["warped geometry", "low resolution", "bad lighting"]);
  const [message, setMessage] = useState("");

  const insertVariable = () => {
    const variable = variables[0] ?? "room_type";
    setDraftPrompt((current) => `${current}${current.endsWith(" ") || current.length === 0 ? "" : " "}{${variable}}`);
    setMessage(text(`已插入变量：{${variable}}`, `Variable inserted: {${variable}}`));
  };

  useEffect(() => {
    void loadPrompts();
  }, [loadPrompts]);

  const saveDraft = async () => {
    setMessage("");
    try {
      const saved = await savePromptDraft({
        name: draftName,
        module: categoryFilter,
        userPrompt: draftPrompt,
        negativePrompt: draftNegative,
        variables,
      });
      setMessage(text(`已保存草稿：${saved.name}`, `Draft saved: ${saved.name}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text("提示词保存失败。", "Failed to save prompt."));
    }
  };

  return (
    <div className="page-stack">
      <section className="page-hero">
        <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
          <div>
            <div className="eyebrow">{text("提示词", "Prompts")}</div>
            <h2 className="hero-title">{text("提示词库。", "Prompt library.")}</h2>
            <p className="body-muted mt-2 max-w-3xl">{text("搜索、收藏和复制工作室常用提示词模板。", "Search, favorite, and copy prompt templates used by the studio.")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <div className="panel-muted p-4">
              <div className="eyebrow">{text("模板", "Templates")}</div>
              <div className="mt-2 text-2xl font-semibold text-studio-navy">{prompts.length}</div>
            </div>
            <div className="panel-muted p-4">
              <div className="eyebrow">{text("收藏", "Favorites")}</div>
              <div className="mt-2 text-2xl font-semibold text-studio-navy">
                {prompts.filter((prompt) => prompt.is_favorite).length}
              </div>
            </div>
          </div>
        </div>
      </section>
      <SectionPanel eyebrow={text("提示词草稿", "Prompt draft")} title={text("模板编辑器", "Template editor")}>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
          <div className="space-y-4">
            <label>
              <span className="eyebrow mb-2 block">{text("分类", "Category")}</span>
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="form-field w-full">
                <option value="all">{text("全部分类", "All categories")}</option>
                <option value="space_render">{text("空间渲染", "Space Rendering")}</option>
                <option value="floorplan">{text("平面图", "Floor Plan")}</option>
                <option value="single_room_board">{text("方案板", "Board")}</option>
              </select>
            </label>
            <label>
              <span className="eyebrow mb-2 block">{text("提示词名称", "Prompt name")}</span>
              <input value={draftName} onChange={(event) => setDraftName(event.target.value)} className="form-field w-full" />
            </label>
            <TagInput label={text("变量", "Variables")} values={variables} suggestions={["room_type", "style", "budget_level", "material_keywords", "aspect_ratio"]} onChange={setVariables} />
            <TagInput label={text("负面提示词库", "Negative prompt library")} values={negativeLibrary} suggestions={["结构变形", "光线差", "过曝", "杂乱", "文字伪影"]} onChange={setNegativeLibrary} />
          </div>
          <div className="space-y-4">
            <PromptTextarea label={text("用户提示词", "Prompt")} value={draftPrompt} onChange={setDraftPrompt} rows={7} />
            <PromptTextarea label={text("负面提示词", "Negative prompt")} value={draftNegative} onChange={setDraftNegative} rows={4} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => void navigator.clipboard?.writeText(draftPrompt)}>{text("复制", "Copy")}</button>
              <button type="button" className="btn-secondary" onClick={insertVariable}>{text("插入变量", "Insert variable")}</button>
              <button type="button" className="btn-primary" onClick={() => void saveDraft()}>{text("保存草稿", "Save draft")}</button>
            </div>
            {message ? <div className="rounded-lg border border-studio-border bg-studio-panelBg p-3 text-xs font-medium text-studio-mutedText">{message}</div> : null}
            {promptError ? <div className="soft-alert">{localizeMessage(promptError)}</div> : null}
          </div>
        </div>
      </SectionPanel>
      <PromptEditor />
    </div>
  );
}
