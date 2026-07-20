import * as Localization from "expo-localization";
import * as SecureStore from "expo-secure-store";
import React, { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useState } from "react";

export type MobileLocale = "zh-CN" | "en";

const STORAGE_KEY = "havenframe.mobile.ui-locale";

interface MobileLocaleContextValue {
  locale: MobileLocale;
  setLocale: (locale: MobileLocale) => void;
  text: (zh: string, en: string) => string;
}

const MobileLocaleContext = createContext<MobileLocaleContextValue | undefined>(undefined);

export function MobileLocaleProvider({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<MobileLocale>(systemLocale);

  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(STORAGE_KEY).then((saved) => {
      if (active && (saved === "zh-CN" || saved === "en")) setLocaleState(saved);
    });
    return () => { active = false; };
  }, []);

  const value = useMemo<MobileLocaleContextValue>(() => ({
    locale,
    setLocale: (nextLocale) => {
      setLocaleState(nextLocale);
      void SecureStore.setItemAsync(STORAGE_KEY, nextLocale);
    },
    text: (zh, en) => locale === "zh-CN" ? zh : en,
  }), [locale]);

  return <MobileLocaleContext.Provider value={value}><React.Fragment key={locale}>{children}</React.Fragment></MobileLocaleContext.Provider>;
}

export function useMobileLocale(): MobileLocaleContextValue {
  const value = useContext(MobileLocaleContext);
  if (!value) throw new Error("useMobileLocale must be used inside MobileLocaleProvider");
  return value;
}

const optionLabels: Record<string, string> = {
  "客厅": "Living room",
  "餐厅": "Dining room",
  "卧室": "Bedroom",
  "厨房": "Kitchen",
  "卫生间": "Bathroom",
  "书房": "Study",
  "展厅": "Showroom",
  "自定义": "Custom",
  "现代暖调": "Warm modern",
  "柔和极简": "Soft minimal",
  "侘寂日式": "Japanese wabi-sabi",
  "酒店轻奢": "Hotel luxury",
  "新中式": "Modern Chinese",
  "自然现代": "Natural modern",
  "胡桃木": "Walnut",
  "洞石": "Travertine",
  "羊羔绒": "Boucle",
  "亚麻": "Linen",
  "黄铜": "Brass",
  "微水泥": "Microcement",
  "橡木": "Oak",
  "使用参考图": "Use references",
  "不使用参考图": "No references",
  "未确认发送": "Not confirmed",
  "已确认发送": "Confirmed",
  "风格与配色": "Style and color",
  "材质与饰面": "Materials and finishes",
  "指定家具": "Selected furniture",
  "灯光与氛围": "Lighting and atmosphere",
};

export function localizedOption(value: string, locale: MobileLocale): string {
  return locale === "zh-CN" ? value : optionLabels[value] ?? value;
}

const errorLabels: Record<string, string> = {
  "操作失败。": "Operation failed.",
  "当前模型线路不在移动端支持列表中。": "This model route is not supported on mobile.",
  "Base URL 不能为空。": "Base URL is required.",
  "手机正式版只允许 HTTPS Provider 地址。": "The mobile release accepts HTTPS Provider addresses only.",
  "请填写 API Key 后保存。": "Enter an API key before saving.",
  "请先保存 Base URL 和 API Key。": "Save the Base URL and API key first.",
  "当前任务引用的手机模型线路不存在。": "The model route referenced by this task no longer exists.",
  "当前任务引用的 API Key 尚未保存。": "The API key referenced by this task has not been saved.",
  "连接测试等待 90 秒后超时。": "The connection test timed out after 90 seconds.",
  "连接测试失败。": "Connection test failed.",
  "GLM 返回中没有 items 数组。": "The GLM response does not contain an items array.",
  "GLM 没有返回可用的真实图片元素。": "GLM did not return usable image elements.",
  "OpenAI 图片响应没有 b64_json 或可下载 URL。": "The OpenAI image response contains neither b64_json nor a downloadable URL.",
  "Gemini 图片响应没有 inlineData 图片。": "The Gemini response does not contain inline image data.",
  "GLM 返回内容不是可解析的 JSON。": "The GLM response is not valid JSON.",
  "手机正式版 Provider Base URL 必须使用 HTTPS。": "Provider Base URLs must use HTTPS in the mobile release.",
  "项目名称不能为空。": "Project name is required.",
  "任务不存在。": "Task not found.",
  "手机本机任务请回到对应工作流重新提交，避免在缺少原始表单状态时错误重试。": "Return to the original workflow and submit again. The on-device task cannot be retried safely without its original form state.",
  "发送图片到 Provider 前必须确认数据流。": "Confirm data transfer before sending images to the Provider.",
  "请先在模型页保存图片生成线路。": "Save an image generation route on the Models screen first.",
  "当前任务没有可读取的源图片。": "This task has no readable source images.",
  "当前任务没有可重试的模型线路快照。请回到工作流重新提交。": "This task has no reusable model-route snapshot. Return to the workflow and submit it again.",
  "当前任务的源图片已不存在，无法重试。": "The source images for this task no longer exist, so it cannot be retried.",
  "Provider 生成失败。": "Provider generation failed.",
  "Provider 重试失败。": "Provider retry failed.",
  "发送图片到 GLM 前必须确认数据流。": "Confirm data transfer before sending images to GLM.",
  "请先在模型页保存 GLM 提取线路。": "Save a GLM extraction route on the Models screen first.",
  "当前提取图片不存在。": "The extraction image no longer exists.",
  "GLM 提取失败。": "GLM extraction failed.",
  "提取元素不存在。": "The extracted item no longer exists.",
  "没有已保留的提取项，无法导出采购表格。": "No retained extraction items are available for the procurement export.",
  "没有已生成的方案板报告内容，无法导出图片报告。": "No board report content is available for the image export.",
  "当前报告所属项目不存在。": "The project for this report no longer exists.",
  "当前报告没有可读取的项目图片。": "This report has no readable project images.",
  "手机本机项目数据库无法解析。请先导出日志，不要清除应用数据。": "The on-device project database cannot be parsed. Export logs before clearing any app data.",
  "系统没有提供应用文档目录。": "The system did not provide an application documents directory.",
  "Provider 成功响应中没有可保存的图片。": "The successful Provider response contains no image that can be saved.",
  "中转可访问，但未提供模型查询接口；真实生图需在工作流中验证。": "The relay is reachable but does not expose a model lookup endpoint. Verify real image generation from a workflow.",
  "Provider 请求失败。": "Provider request failed.",
  "端点和凭据已通过文本检测；多模态图片提取尚未验证。": "The endpoint and credentials passed a text check; multimodal image extraction is not verified yet.",
  "GLM 图片预处理没有产生可发送的图像数据。": "GLM image preparation did not produce sendable image data.",
};

export function localizedError(message: string, locale: MobileLocale): string {
  if (locale === "zh-CN") return message;
  const exact = errorLabels[message];
  if (exact) return exact;
  const timeout = message.match(/^Provider 请求超时（(\d+) 秒）。$/);
  if (timeout) return `Provider request timed out after ${timeout[1]} seconds.`;
  const invalidJson = message.match(/^Provider 成功响应不是有效 JSON。HTTP (\d+)，Endpoint: (.+)$/);
  if (invalidJson) return `The Provider returned HTTP ${invalidJson[1]} success, but the response was not valid JSON. Endpoint: ${invalidJson[2]}`;
  const dns = message.match(/^手机当前网络无法解析 Provider 域名 (.+?)。请检查当前 Wi-Fi\/移动网络、VPN 或私有 DNS 后重试。Endpoint: (.+)$/);
  if (dns) return `The device network cannot resolve Provider host ${dns[1]}. Check Wi-Fi/mobile data, VPN, or Private DNS and retry. Endpoint: ${dns[2]}`;
  const nonJsonHttp = message.match(/^HTTP (\d+): Provider (?:网关返回了非 JSON 错误页|返回了非 JSON 错误内容)(?:: (.*))?。Endpoint: (.+)$/);
  if (nonJsonHttp) return `HTTP ${nonJsonHttp[1]}: the Provider returned a non-JSON error${nonJsonHttp[2] ? `: ${nonJsonHttp[2]}` : ""}. Endpoint: ${nonJsonHttp[3]}`;
  const reportAsset = message.match(/^报告素材无法读取：(.+)$/);
  if (reportAsset) return `Report asset is unreadable: ${reportAsset[1]}`;
  const emptyProviderResponse = message.match(/^HTTP (\d+): Provider 请求失败。$/);
  if (emptyProviderResponse) return `HTTP ${emptyProviderResponse[1]}: Provider request failed.`;
  return message;
}

function systemLocale(): MobileLocale {
  const languageTag = Localization.getLocales()[0]?.languageTag?.toLowerCase() || "";
  return languageTag.startsWith("zh") ? "zh-CN" : "en";
}
