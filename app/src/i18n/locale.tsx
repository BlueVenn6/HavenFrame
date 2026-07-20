import { getCurrentWindow } from "@tauri-apps/api/window";
import { createContext, Fragment, type PropsWithChildren, useContext, useEffect, useMemo, useState } from "react";

export type AppLocale = "zh-CN" | "en";

const STORAGE_KEY = "havenframe.ui-locale";

interface LocaleContextValue {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  text: (zh: string, en: string) => string;
  message: (value?: string | null) => string;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

export function LocaleProvider({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<AppLocale>(initialLocale);
  useEffect(() => {
    const title = locale === "zh-CN" ? "栖构" : "HavenFrame";
    document.title = title;
    if ("__TAURI_INTERNALS__" in window) {
      void getCurrentWindow().setTitle(title).catch(() => undefined);
    }
  }, [locale]);
  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale: (nextLocale) => {
      window.localStorage.setItem(STORAGE_KEY, nextLocale);
      document.documentElement.lang = nextLocale;
      setLocaleState(nextLocale);
    },
    text: (zh, en) => locale === "zh-CN" ? zh : en,
    message: (message) => localizeRuntimeMessage(message, locale),
  }), [locale]);

  return <LocaleContext.Provider value={value}><Fragment key={locale}>{children}</Fragment></LocaleContext.Provider>;
}

const runtimeMessageMap: Record<string, string> = {
  "模板列表加载失败。": "Could not load templates.",
  "方案板归档数据加载失败。": "Could not load board archive data.",
  "已保存的元素记录无法重新加载。": "Could not reload saved extracted items.",
  "元素提取失败。": "Item extraction failed.",
  "当前提取元素不存在，请刷新后重试。": "The extracted item no longer exists. Refresh and try again.",
  "选择状态未能保存到本地归档，界面已恢复为保存前状态。": "The selection could not be saved. The previous state has been restored.",
  "单房间方案板生成失败。": "Single-room board generation failed.",
  "多房间方案板生成失败。": "Multi-room board generation failed.",
  "报价卡生成失败。": "Quote card generation failed.",
  "当前图片还没有报告内容，请先点击“生成报告内容”。": "This image has no report content. Generate report content first.",
  "图片报告导出失败。": "Report export failed.",
  "没有当前图片，无法导出对应的结构化表格。": "No current image is available for structured table export.",
  "结构化表格导出失败。": "Structured table export failed.",
  "报告摘要内容过长，无法在 A4 页面内完整排版；请精简异常字段后重试。": "The report summary is too long to fit completely on an A4 page. Shorten the unusually long fields and try again.",
  "项目列表加载失败。": "Could not load projects.",
  "项目复盘数据加载失败。": "Could not load project review data.",
  "模型配置加载失败。": "Could not load model configurations.",
  "模型配置保存失败。": "Could not save the model configuration.",
  "API Key 清除失败。": "Could not clear the API key.",
  "连接测试失败。": "Connection test failed.",
  "批量连接测试失败。": "Batch connection test failed.",
  "模块默认模型更新失败。": "Could not update the module default model.",
  "任务列表加载失败。": "Could not load tasks.",
  "图片模型生成失败。": "Image generation failed.",
  "图片模型任务已取消。": "Image generation task was cancelled.",
  "图片模型任务仍在运行，已超过前端等待时间；请在任务队列查看最终状态。": "The image task is still running beyond the UI wait period. Check the task queue for its final status.",
  "素材删除失败。": "Could not delete the asset.",
  "无法加载素材列表，请检查本地后端是否正在运行。": "Could not load assets. Confirm that the application backend is running.",
  "上传失败，请检查本地后端和项目是否可用。": "Upload failed. Confirm that the application backend and project are available.",
  "提示词列表加载失败。": "Could not load prompts.",
  "收藏状态保存失败。": "Could not save the favorite state.",
  "提示词复制失败。": "Could not duplicate the prompt.",
  "所选 GLM 提取模型配置不存在、已删除或不兼容，请重新选择提取模型。": "The selected GLM extraction configuration is missing or incompatible. Select the GLM extraction route again.",
  "没有可用的 GLM 信息提取配置，请先在模型设置中保存 Zhipu GLM 或 GLM 兼容中转。": "No usable GLM extraction configuration is available. Save a Zhipu GLM or GLM-compatible route in Model Settings.",
  "没有可用的 GLM 信息提取配置，请先在模型设置中保存中国大陆智谱 GLM、国际 Z.AI GLM 或 GLM 兼容中转。": "No usable GLM extraction configuration is available. Save a mainland Zhipu GLM, international Z.AI GLM, or GLM-compatible relay route in Model Settings.",
  "Provider 返回的图片文件为空。": "The Provider returned an empty image file.",
  "Provider 返回的图片超过允许的文件大小。": "The Provider image exceeds the allowed file size.",
  "Provider 返回的 PNG 文件签名无效。": "The Provider response does not have a valid PNG signature.",
  "Provider 返回的 JPEG 文件签名无效。": "The Provider response does not have a valid JPEG signature.",
  "Provider 返回的 WebP 文件签名无效。": "The Provider response does not have a valid WebP signature.",
  "API Key 不能为空。": "API Key is required.",
  "当前平台暂不支持本机安全存储。请使用环境变量引用，例如 env://OPENAI_API_KEY。": "Secure local storage is unavailable on this platform. Use an environment reference such as env://OPENAI_API_KEY.",
  "任务已取消，停止后台执行。": "The task was cancelled and background processing stopped.",
  "安全文件名没有对应的 MIME 类型。": "The sanitized file name has no matching MIME type.",
  "必须上传至少 1 个文件。": "Upload at least one file.",
  "上传文件不能为空。": "The uploaded file is empty.",
  "不允许上传可执行文件、脚本文件或压缩包。": "Executable files, scripts, and archives are not allowed.",
  "文件扩展名不在上传白名单内。": "The file extension is not allowed.",
  "文件 MIME 类型不在上传白名单内。": "The file MIME type is not allowed.",
  "文件内容疑似可执行文件或压缩包，已拒绝上传。": "The upload was rejected because its content resembles an executable or archive.",
  "文件内容签名与声明的 MIME 类型不匹配。": "The file signature does not match the declared MIME type.",
  "文件名不能为空。": "File name is required.",
  "文件名不能包含路径。": "The file name must not contain a path.",
  "文件名不能包含路径穿越片段。": "The file name must not contain path traversal segments.",
  "文件名包含非法控制字符。": "The file name contains invalid control characters.",
  "购买链接必须使用 http:// 或 https://": "The purchase URL must use http:// or https://.",
  "最低预算不能高于最高预算": "Minimum budget cannot exceed maximum budget.",
  "最低预算不能高于最高预算。": "Minimum budget cannot exceed maximum budget.",
  "当前系统没有可用的打开路径命令。": "No command is available to open this path on the current system.",
  "上传素材所属项目不存在。": "The project for this uploaded asset no longer exists.",
  "资产文件不在受控 workspace 中。": "The asset file is outside the managed workspace.",
  "GLM 信息提取前必须确认数据流和素材授权。": "Confirm data transfer and asset authorization before GLM extraction.",
  "所选素材不属于当前项目。": "The selected asset does not belong to the current project.",
  "请先上传并标注至少一个房间图片。": "Upload and label at least one room image.",
  "GLM 提取模型缺少 Base URL。请在模型设置中检查所选大陆或国际 GLM 配置。": "The GLM extraction route has no Base URL. Check the selected mainland or international GLM configuration in Model Settings.",
  "方案板所属项目不存在。": "The project for this board no longer exists.",
  "方案板没有绑定当前图片素材。": "The board is not linked to the current image asset.",
  "部分已选元素不存在或不属于当前图片，请刷新后重试。": "Some selected items are missing or do not belong to the current image. Refresh and try again.",
  "已删除的元素不能进入方案板。": "Removed items cannot be included in the board.",
  "所选 extractionProvider/extractionModel 与已保存的 GLM 配置不一致。": "The selected extractionProvider/extractionModel does not match the saved GLM configuration.",
  "部分报价项不存在或不属于当前项目/素材。": "Some quote items are missing or do not belong to the current project and asset.",
  "导出项目不存在。": "The project for this export no longer exists.",
  "导出快照与当前预算或采购信息不一致，请刷新后重试。": "The export snapshot does not match the current budget or procurement data. Refresh and try again.",
  "没有可导出的真实提取项。请先完成 GLM 信息提取。": "There are no real extracted items to export. Complete GLM extraction first.",
  "图片导出的素材不存在。": "The asset for this image export no longer exists.",
  "图片导出的素材不属于当前项目。": "The image export asset does not belong to the current project.",
  "图片导出的素材文件不存在或不在受控工作区。": "The image export file is missing or outside the managed workspace.",
  "图片导出只支持图片文件。": "Image export accepts image files only.",
  "部分方案板记录不存在，无法创建完整图片交付。": "Some board records are missing, so a complete image delivery cannot be created.",
  "方案板文档不属于当前项目或当前生成任务。": "The board document does not belong to the current project or generation task.",
  "当前方案板任务缺少正式交付所需文档。": "The current board task is missing documents required for delivery.",
  "分房间方案板数量与当前上传图片不一致。": "The number of room boards does not match the current uploaded images.",
  "部分当前房间图片不存在或不属于当前项目。": "Some current room images are missing or do not belong to the project.",
  "部分导出元素不存在或不属于当前图片。": "Some export items are missing or do not belong to the current image.",
  "已删除的元素不能进入导出结果。": "Removed items cannot be included in the export.",
  "当前方案板图片不是由本次图片、人工确认结果和交付提示词真实生成的。": "The current board image was not generated from the current images, review state, and delivery prompt.",
  "表格快照与当前预算或采购信息不一致，请刷新后重试。": "The table snapshot does not match the current budget or procurement data. Refresh and try again.",
  "方案板文档与当前图片或人工确认结果不一致，请重新生成。": "The board document does not match the current images or review state. Generate it again.",
  "移动端信息提取线路只允许 GLM 模型。": "Mobile extraction routes accept GLM models only.",
  "中转 Base URL 不能为空。请保存完整的 HTTPS 中转地址后再应用模型线路。": "Relay Base URL is required. Save a complete HTTPS relay address before applying the route.",
  "图片生成任务所属项目不存在，请先创建或选择项目。": "The project for this image task does not exist. Create or select a project first.",
  "只有失败或已取消的任务可以重试。": "Only failed or cancelled tasks can be retried.",
  "该任务无法从安全快照自动重放，请回到对应工作流重新提交。": "This task cannot be replayed safely from its snapshot. Return to the workflow and submit it again.",
  "中转 Base URL 不能为空。请在模型设置里填写中转地址，或配置对应的 *_RELAY_BASE_URL 环境变量。": "Relay Base URL is required. Enter it in Model Settings or configure the corresponding *_RELAY_BASE_URL environment variable.",
  "图片生成模型配置不存在或已删除，请重新选择模型。": "The image model configuration is missing or was deleted. Select the model again.",
  "客户端显示的 generationProvider 与 provider_config_id 不一致，请刷新模型配置。": "The displayed generationProvider does not match provider_config_id. Refresh model configurations.",
  "客户端显示的 generationModel 与 provider_config_id 不一致，请刷新模型配置。": "The displayed generationModel does not match provider_config_id. Refresh model configurations.",
  "该图片任务要求参考图，但没有可读取的项目图片素材。": "This image task requires references, but no readable project image assets are available.",
  "图片生成模型配置 ID 无效，请重新选择模型。": "The image model configuration ID is invalid. Select the model again.",
  "所选图片生成 provider/model 与已保存配置不一致，请在模型设置中重新保存。": "The selected image generation provider/model does not match the saved configuration. Save it again in Model Settings.",
};

export function localizeRuntimeMessage(value: string | null | undefined, locale: AppLocale): string {
  if (!value) return "";
  if (locale === "zh-CN" || !/\p{Script=Han}/u.test(value)) return value;
  const exact = runtimeMessageMap[value];
  if (exact) return exact;
  if (value.startsWith("中转失败，未改发官方服务。")) {
    return `The relay request failed and was not redirected to an official API. ${value.slice("中转失败，未改发官方服务。".length).trim()}`;
  }
  if (value.startsWith("请求超时")) {
    return `The request timed out. ${value.slice("请求超时".length).replace(/^[:：。\s]+/, "")}`;
  }
  if (value.startsWith("模型请求超过配置的超时时间")) {
    return `The model request exceeded its configured timeout. ${value.slice("模型请求超过配置的超时时间".length).replace(/^[:：，。\s]+/, "")}`;
  }
  if (value.startsWith("Provider 请求失败")) {
    return `The Provider request failed. ${value.slice("Provider 请求失败".length).replace(/^[:：，。\s]+/, "")}`;
  }
  if (value.startsWith("图片生成失败")) {
    return `Image generation failed. ${value.slice("图片生成失败".length).replace(/^[:：，。\s]+/, "")}`;
  }
  if (value.startsWith("元素提取失败")) {
    return `Item extraction failed. ${value.slice("元素提取失败".length).replace(/^[:：，。\s]+/, "")}`;
  }
  if (value.includes("getaddrinfo failed")) {
    return `DNS resolution failed before the request reached the Provider. ${value.replace(/^.*?(?=\[Errno|getaddrinfo)/, "")}`;
  }
  const sourceMissing = value.match(/^来源素材 (\d+) 不存在。$/);
  if (sourceMissing) return `Source asset ${sourceMissing[1]} no longer exists.`;
  const sourceUnreadable = value.match(/^来源素材 (\d+) 的文件不存在或不可读取。$/);
  if (sourceUnreadable) return `Source asset ${sourceUnreadable[1]} is missing or unreadable.`;
  return value;
}

export function currentAppLocale(): AppLocale {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "zh-CN" || saved === "en") return saved;
  return window.navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used inside LocaleProvider");
  return value;
}

function initialLocale(): AppLocale {
  const locale = currentAppLocale();
  document.documentElement.lang = locale;
  return locale;
}
