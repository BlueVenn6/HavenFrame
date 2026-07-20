import { usePromptStore } from "../stores/usePromptStore";
import { useLocale } from "../i18n/locale";
import { localizeBuiltinPrompt } from "../i18n/builtin-content";
import { localeLabel } from "../lib/zh-labels";

export function PromptEditor() {
  const { locale, text } = useLocale();
  const prompts = usePromptStore((state) => state.prompts);
  const activePromptId = usePromptStore((state) => state.activePromptId);
  const setActivePromptId = usePromptStore((state) => state.setActivePromptId);
  const promptSearch = usePromptStore((state) => state.promptSearch);
  const moduleFilter = usePromptStore((state) => state.moduleFilter);
  const setPromptSearch = usePromptStore((state) => state.setPromptSearch);
  const setModuleFilter = usePromptStore((state) => state.setModuleFilter);
  const toggleFavorite = usePromptStore((state) => state.toggleFavorite);
  const clonePrompt = usePromptStore((state) => state.clonePrompt);
  const displayPrompts = prompts.map((prompt) => localizeBuiltinPrompt(prompt, locale));

  const filteredPrompts = displayPrompts.filter((prompt) => {
    const matchesSearch =
      prompt.name.toLowerCase().includes(promptSearch.toLowerCase()) ||
      prompt.user_prompt.toLowerCase().includes(promptSearch.toLowerCase());
    const matchesModule = moduleFilter === "all" || prompt.module === moduleFilter;
    return matchesSearch && matchesModule;
  });
  const activePrompt = displayPrompts.find((prompt) => prompt.id === activePromptId) ?? filteredPrompts[0] ?? displayPrompts[0];

  return (
    <div className="panel-surface p-5">
      <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="eyebrow">{text("提示词中心", "Prompt center")}</div>
          <h3 className="section-title mt-2">{text("内置和自定义提示词", "Built-in and custom prompts")}</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            value={promptSearch}
            onChange={(event) => setPromptSearch(event.target.value)}
            placeholder={text("搜索提示词名称或内容", "Search prompt names or content")}
            className="form-field"
          />
          <select
            value={moduleFilter}
            onChange={(event) => setModuleFilter(event.target.value)}
            className="form-field"
          >
            <option value="all">{text("全部模块", "All modules")}</option>
            {Array.from(new Set(prompts.map((prompt) => prompt.module))).map((moduleName) => (
              <option key={moduleName} value={moduleName}>
                {localeLabel(moduleName, locale)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.4fr]">
        <div className="space-y-3">
          {filteredPrompts.map((prompt) => (
            <button
              key={prompt.id}
              type="button"
              onClick={() => setActivePromptId(prompt.id)}
              className={`panel-muted w-full p-4 text-left transition ${
                prompt.id === activePromptId ? "border-teal-500 bg-teal-50/50" : "hover:border-teal-300"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-studio-navy">{prompt.name}</div>
                  <div className="text-xs font-medium text-studio-mutedText">{localeLabel(prompt.module, locale)}</div>
                </div>
                <span className="tag-chip">{prompt.is_builtin ? text("内置", "Built-in") : text("自定义", "Custom")}</span>
              </div>
            </button>
          ))}
        </div>
        <div className="panel-muted p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="eyebrow">{activePrompt ? localeLabel(activePrompt.module, locale) : ""}</div>
              <h3 className="mt-2 text-xl font-semibold text-studio-navy">{activePrompt?.name}</h3>
              <p className="mt-2 text-sm font-medium text-studio-mutedText">
                {text("版本", "Version")} {activePrompt?.version} · {text("更新于", "Updated")} {activePrompt?.updated_at ?? text("暂无", "None")}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => activePrompt && void toggleFavorite(activePrompt.id)}
                className="btn-secondary"
              >
                {activePrompt?.is_favorite ? text("取消收藏", "Unfavorite") : text("收藏", "Favorite")}
              </button>
              <button
                type="button"
                onClick={() => activePrompt && void clonePrompt(activePrompt.id)}
                className="btn-primary"
              >
                {text("复制", "Duplicate")}
              </button>
            </div>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div>
              <div className="eyebrow mb-2">{text("系统提示词", "System prompt")}</div>
              <textarea
                readOnly
                value={activePrompt?.system_prompt ?? text("还没有配置系统提示词。", "No system prompt configured.")}
                className="textarea-field h-32 w-full"
              />
            </div>
            <div>
              <div className="eyebrow mb-2">{text("负面提示词", "Negative prompt")}</div>
              <textarea
                readOnly
                value={activePrompt?.negative_prompt ?? text("还没有配置负面提示词。", "No negative prompt configured.")}
                className="textarea-field h-32 w-full"
              />
            </div>
          </div>
          <div className="mt-4">
            <div className="eyebrow mb-2">{text("用户提示词", "User prompt")}</div>
            <textarea
              readOnly
              value={activePrompt?.user_prompt ?? ""}
              className="textarea-field h-44 w-full"
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {(activePrompt?.variables_json ?? []).map((variable) => (
              <span key={variable} className="tag-chip">
                {`{${variable}}`}
              </span>
            ))}
          </div>
          <div className="mt-5">
            <div className="eyebrow mb-2">{text("版本历史", "Version history")}</div>
            <div className="space-y-2">
              {(activePrompt?.version_history ?? []).map((version) => (
                <div key={`${activePrompt?.id}-${version.version}`} className="rounded-lg border border-studio-border bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-studio-navy">{version.label}</div>
                    <span className="tag-chip">v{version.version}</span>
                  </div>
                  <div className="mt-1 text-sm text-studio-mutedText">{version.summary}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
