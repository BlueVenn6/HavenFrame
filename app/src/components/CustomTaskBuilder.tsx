import { useEffect, useState } from "react";

import { useCustomTaskStore } from "../stores/useCustomTaskStore";
import { localeLabel } from "../lib/zh-labels";
import { useLocale } from "../i18n/locale";
import { localizeBuiltinText } from "../i18n/builtin-content";

export function CustomTaskBuilder() {
  const { locale, message: localizeMessage, text } = useLocale();
  const templates = useCustomTaskStore((state) => state.templates);
  const createTemplate = useCustomTaskStore((state) => state.createTemplate);
  const loadTemplates = useCustomTaskStore((state) => state.loadTemplates);
  const isLoading = useCustomTaskStore((state) => state.isLoading);
  const error = useCustomTaskStore((state) => state.error);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const handleCreateTemplate = async () => {
    setMessage("");
    try {
      const template = await createTemplate();
      setMessage(text(`已归档模板：${template.name}`, `Template archived: ${localizeBuiltinText(template.name, locale)}`));
    } catch (createError) {
      setMessage(createError instanceof Error ? createError.message : text("模板创建失败。", "Failed to create template."));
    }
  };

  return (
    <div className="panel-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="eyebrow">{text("模板构建器", "Template builder")}</div>
          <h3 className="section-title mt-2">{text("表单式工作流模板", "Form-based workflow templates")}</h3>
        </div>
        <button type="button" className="btn-primary" onClick={() => void handleCreateTemplate()} disabled={isLoading}>
          {isLoading ? text("加载中", "Loading") : text("创建模板", "Create template")}
        </button>
      </div>
      {message ? <div className="mb-3 rounded-lg border border-studio-border bg-studio-panelBg p-3 text-xs font-medium text-studio-mutedText">{message}</div> : null}
      {error ? <div className="mb-3 soft-alert">{localizeMessage(error)}</div> : null}
      <div className="space-y-3">
        {templates.map((template) => (
          <div key={template.id} className="panel-muted p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-studio-navy">{localizeBuiltinText(template.name, locale)}</div>
                <div className="text-sm text-studio-mutedText">{template.description ? localizeBuiltinText(template.description, locale) : ""}</div>
              </div>
              <span className="tag-chip">v{template.version}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {template.module_chain_json.map((module) => (
                <span key={module} className="tag-chip">
                  {localeLabel(module, locale)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
