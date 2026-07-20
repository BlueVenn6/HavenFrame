import * as FileSystem from "expo-file-system/legacy";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import type { ExtractedItem, ProviderConfig } from "./types";
import { normalizeProviderNetworkError, providerHttpError, providerInvalidSuccessResponse } from "./provider-errors";

export interface DirectImageResult {
  mimeType: string;
  base64?: string;
  url?: string;
  endpoint: string;
}

export async function generateDirectImage(args: {
  config: ProviderConfig;
  apiKey: string;
  prompt: string;
  sourceUris: Array<{ uri: string; fileName: string; mimeType: string }>;
  aspectRatio: string;
}): Promise<DirectImageResult> {
  const providerId = String(args.config.provider_id ?? args.config.extra_config_json?.provider_id ?? "").toLowerCase();
  if (providerId === "google_gemini") return generateGeminiImage(args);
  return generateOpenAIImage(args);
}

export async function extractDirectItems(args: {
  config: ProviderConfig;
  apiKey: string;
  imageUri: string;
  mimeType: string;
  roomType: string;
  style: string;
  outputLanguage: "zh-CN" | "en";
}): Promise<Array<Omit<ExtractedItem, "id">>> {
  const baseUrl = normalizeBaseUrl(args.config.base_url || "");
  const endpoint = `${baseUrl}/chat/completions`;
  const preparedImage = await prepareVisionImage(args.imageUri);
  const prompt = args.outputLanguage === "en" ? [
    "You are a multimodal interior-design extraction assistant. Extract only furniture, lighting, furnishings, and major materials genuinely visible in this image. Do not use historical images or invent bedrooms, beds, or other unseen items.",
    `Room: ${args.roomType || "Not specified"}; style: ${args.style || "Not specified"}.`,
    "Return strict JSON only: {\"items\":[{\"name\":\"\",\"category\":\"\",\"material\":\"\",\"color\":\"\",\"color_hex\":\"#RRGGBB\",\"bbox\":{\"x\":0,\"y\":0,\"width\":0,\"height\":0},\"selection_state\":\"undecided\",\"notes\":\"\"}]}. Normalize bbox coordinates to 0-1. Do not output Markdown.",
  ].join("\n") : [
    "你是室内设计多模态信息提取助手。仅提取图片中真实可见的家具、灯具、软装和主要材质，不得引用历史图片或虚构卧室/床等元素。",
    `房间：${args.roomType || "未指定"}；风格：${args.style || "未指定"}。`,
    "返回严格 JSON：{\"items\":[{\"name\":\"\",\"category\":\"\",\"material\":\"\",\"color\":\"\",\"color_hex\":\"#RRGGBB\",\"bbox\":{\"x\":0,\"y\":0,\"width\":0,\"height\":0},\"selection_state\":\"undecided\",\"notes\":\"\"}]}。bbox 使用 0-1 归一化坐标。不要输出 Markdown。",
  ].join("\n");
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: args.config.model_name,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${preparedImage.mimeType};base64,${preparedImage.base64}` } },
        ],
      }],
      temperature: 0.1,
      thinking: { type: "disabled" },
    }),
  }, 240000);
  const payload = await parseJsonResponse(response, endpoint);
  const raw = extractText(payload);
  const parsed = parseEmbeddedJson(raw);
  const items = Array.isArray(parsed) ? parsed : parsed?.items;
  if (!Array.isArray(items)) throw new Error("GLM 返回中没有 items 数组。");
  const normalized = items.slice(0, 24).flatMap((item): Array<Omit<ExtractedItem, "id">> => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const name = String(record.name || "").trim();
    if (!name) return [];
    const bbox = normalizeBoundingBox(record.bbox);
    return [{
      name: name.slice(0, 255),
      category: optionalText(record.category) || (args.outputLanguage === "en" ? "Uncategorized" : "未分类"),
      material: optionalText(record.material),
      color: optionalText(record.color),
      color_hex: normalizeColorHex(record.color_hex),
      bbox,
      selection_state: "undecided",
      notes: optionalText(record.notes),
    }];
  });
  if (!normalized.length) throw new Error("GLM 没有返回可用的真实图片元素。");
  return normalized;
}

async function generateOpenAIImage(args: {
  config: ProviderConfig;
  apiKey: string;
  prompt: string;
  sourceUris: Array<{ uri: string; fileName: string; mimeType: string }>;
  aspectRatio: string;
}): Promise<DirectImageResult> {
  const baseUrl = normalizeBaseUrl(args.config.base_url || "");
  const size = openAIImageSize(args.aspectRatio);
  const sourceUris = args.sourceUris.filter((item) => Boolean(item.uri));
  const endpoint = `${baseUrl}${sourceUris.length ? "/images/edits" : "/images/generations"}`;
  let response: Response;
  if (sourceUris.length) {
    const data = new FormData();
    data.append("model", args.config.model_name);
    data.append("prompt", args.prompt);
    data.append("n", "1");
    data.append("size", size);
    const field = sourceUris.length > 1 ? "image[]" : "image";
    sourceUris.forEach((source) => data.append(field, {
      uri: source.uri,
      name: source.fileName,
      type: source.mimeType,
    } as unknown as Blob));
    response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.apiKey}` },
      body: data,
    }, 900000);
  } else {
    response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: args.config.model_name, prompt: args.prompt, n: 1, size }),
    }, 900000);
  }
  const payload = await parseJsonResponse(response, endpoint);
  const item = Array.isArray(payload?.data) ? payload.data[0] : undefined;
  if (typeof item?.b64_json === "string" && item.b64_json) {
    return { mimeType: "image/png", base64: item.b64_json, endpoint };
  }
  if (typeof item?.url === "string" && /^https:\/\//i.test(item.url)) {
    return { mimeType: "image/png", url: item.url, endpoint };
  }
  throw new Error("OpenAI 图片响应没有 b64_json 或可下载 URL。");
}

async function generateGeminiImage(args: {
  config: ProviderConfig;
  apiKey: string;
  prompt: string;
  sourceUris: Array<{ uri: string; fileName: string; mimeType: string }>;
}): Promise<DirectImageResult> {
  const baseUrl = normalizeBaseUrl(args.config.base_url || "");
  const endpoint = `${baseUrl}/models/${args.config.model_name}:generateContent`;
  const parts: Array<Record<string, unknown>> = [];
  for (const source of args.sourceUris) {
    const base64 = await FileSystem.readAsStringAsync(source.uri, { encoding: FileSystem.EncodingType.Base64 });
    parts.push({ inlineData: { mimeType: source.mimeType, data: base64 } });
  }
  parts.push({ text: args.prompt });
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { "x-goog-api-key": args.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
    }),
  }, 900000);
  const payload = await parseJsonResponse(response, endpoint);
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  for (const candidate of candidates) {
    const responseParts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of responseParts) {
      const inline = part?.inlineData || part?.inline_data;
      if (typeof inline?.data === "string" && inline.data) {
        return { mimeType: String(inline.mimeType || inline.mime_type || "image/png"), base64: inline.data, endpoint };
      }
    }
  }
  throw new Error("Gemini 图片响应没有 inlineData 图片。");
}

async function fetchWithTimeout(endpoint: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(endpoint, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Provider 请求超时（${Math.round(timeoutMs / 1000)} 秒）。`);
    }
    throw normalizeProviderNetworkError(error, endpoint);
  } finally {
    clearTimeout(timeout);
  }
}

async function parseJsonResponse(response: Response, endpoint: string): Promise<any> {
  const raw = await response.text();
  if (!response.ok) {
    throw providerHttpError(response.status, raw, endpoint, response.headers.get("content-type") || "");
  }
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw providerInvalidSuccessResponse(response.status, endpoint);
  }
  return payload;
}

async function prepareVisionImage(uri: string): Promise<{ base64: string; mimeType: "image/jpeg" }> {
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const context = ImageManipulator.manipulate(uri);
  const maxDimension = Math.max(original.width, original.height);
  if (maxDimension > 1600) {
    if (original.width >= original.height) context.resize({ width: 1600 });
    else context.resize({ height: 1600 });
  }
  const rendered = await context.renderAsync();
  let prepared = await rendered.saveAsync({ base64: true, compress: 0.78, format: SaveFormat.JPEG });

  // Keep the encoded request comfortably below common upstream gateway body limits.
  // The original project asset remains untouched; only this temporary Provider copy changes.
  if ((prepared.base64?.length || 0) > 5_000_000 && Math.max(prepared.width, prepared.height) > 1280) {
    const fallbackContext = ImageManipulator.manipulate(prepared.uri);
    if (prepared.width >= prepared.height) fallbackContext.resize({ width: 1280 });
    else fallbackContext.resize({ height: 1280 });
    const fallback = await fallbackContext.renderAsync();
    prepared = await fallback.saveAsync({ base64: true, compress: 0.68, format: SaveFormat.JPEG });
  }
  const base64 = prepared.base64
    || await FileSystem.readAsStringAsync(prepared.uri, { encoding: FileSystem.EncodingType.Base64 });
  if (!base64) throw new Error("GLM 图片预处理没有产生可发送的图像数据。");
  return { base64, mimeType: "image/jpeg" };
}

function extractText(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => item?.text || "").join("\n");
  if (typeof payload?.output_text === "string") return payload.output_text;
  return "";
}

function parseEmbeddedJson(raw: string): any {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || raw.trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const objectStart = candidate.indexOf("{");
    const objectEnd = candidate.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) return JSON.parse(candidate.slice(objectStart, objectEnd + 1));
    throw new Error("GLM 返回内容不是可解析的 JSON。");
  }
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/(chat\/completions|images\/generations|images\/edits)\/?$/i, "").replace(/\/+$/, "");
  if (!/^https:\/\//i.test(normalized)) throw new Error("手机正式版 Provider Base URL 必须使用 HTTPS。");
  return normalized;
}

function openAIImageSize(aspectRatio: string): string {
  if (["9:16", "3:4", "2:3"].includes(aspectRatio)) return "1024x1536";
  if (["16:9", "4:3", "3:2"].includes(aspectRatio)) return "1536x1024";
  return "1024x1024";
}

function optionalText(value: unknown): string | undefined {
  const text = value == null ? "" : String(value).trim();
  return text ? text.slice(0, 500) : undefined;
}

function normalizeColorHex(value: unknown): string | undefined {
  const text = optionalText(value)?.toUpperCase();
  if (!text) return undefined;
  if (/^#[0-9A-F]{6}$/.test(text)) return text;
  if (/^[0-9A-F]{6}$/.test(text)) return `#${text}`;
  return undefined;
}

function normalizeBoundingBox(value: unknown): ExtractedItem["bbox"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const bbox = value as Record<string, unknown>;
  const x = Number(bbox.x);
  const y = Number(bbox.y);
  const width = Number(bbox.width);
  const height = Number(bbox.height);
  if (![x, y, width, height].every(Number.isFinite)) return undefined;
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
    width: Math.max(0, Math.min(1, width)),
    height: Math.max(0, Math.min(1, height)),
  };
}
