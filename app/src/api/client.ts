const DEFAULT_API_BASE = "http://127.0.0.1:8010";
const EXPECTED_BACKEND_SERVICE_ID = "com.havenframe.desktop.backend";
const EXPECTED_API_CONTRACT_VERSION = "2026-07-13-model-persistence-v1";
let localApiToken: string | undefined;
let localSessionPromise: Promise<string | undefined> | undefined;
let backendIdentityPromise: Promise<void> | undefined;
const sessionListeners = new Set<() => void>();

function uiText(zh: string, en: string): string {
  return window.localStorage.getItem("havenframe.ui-locale") === "zh-CN" ? zh : en;
}

export class ApiError extends Error {
  status?: number;
  detail: string;

  constructor(detail: string, status?: number) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export function getApiBase(): string {
  const envBase =
    typeof import.meta !== "undefined" && (import.meta as ImportMeta & { env?: Record<string, string> }).env
      ? (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_API_BASE_URL
      : undefined;

  if (envBase) {
    return envBase;
  }

  return DEFAULT_API_BASE;
}

export function getAssetContentUrl(assetId?: number | null, cacheBust?: number): string | undefined {
  if (!assetId) {
    return undefined;
  }
  const params = new URLSearchParams();
  if (localApiToken) {
    params.set("local_token", localApiToken);
  }
  if (cacheBust) {
    params.set("v", String(cacheBust));
  }
  const query = params.toString();
  return `${getApiBase()}/api/assets/${assetId}/content${query ? `?${query}` : ""}`;
}

export function subscribeLocalSession(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

function notifyLocalSessionChanged(): void {
  sessionListeners.forEach((listener) => listener());
}

export async function ensureLocalSession(): Promise<string | undefined> {
  if (localApiToken) return localApiToken;
  if (!localSessionPromise) {
    localSessionPromise = ensureBackendIdentity()
      .then(() => fetch(`${getApiBase()}/api/security/session`, {
        credentials: "include",
      }))
      .then(async (response) => {
        if (!response.ok) {
          throw new ApiError(uiText(`本地会话获取失败：${response.status}`, `Could not establish the local session (${response.status}).`), response.status);
        }
        const payload = (await response.json()) as { token?: string };
        const previousToken = localApiToken;
        localApiToken = payload.token;
        if (localApiToken && localApiToken !== previousToken) {
          notifyLocalSessionChanged();
        }
        return localApiToken;
      })
      .catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(uiText(`栖构本地会话建立失败（${getApiBase()}）。请重新启动应用。`, `HavenFrame could not establish a local session at ${getApiBase()}. Restart the application.`));
      })
      .finally(() => {
        localSessionPromise = undefined;
      });
  }
  return localSessionPromise;
}

async function ensureBackendIdentity(): Promise<void> {
  if (!backendIdentityPromise) {
    backendIdentityPromise = (async () => {
      let lastNetworkError: unknown;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        let response: Response;
        try {
          response = await fetch(`${getApiBase()}/health`, { credentials: "include" });
        } catch (error) {
          lastNetworkError = error;
          if (attempt < 19) {
            await new Promise((resolve) => window.setTimeout(resolve, 1000));
            continue;
          }
          break;
        }
        if (!response.ok) {
          throw new ApiError(uiText(`栖构后端健康检查失败：${response.status}`, `HavenFrame backend health check failed (${response.status}).`), response.status);
        }
        const payload = (await response.json()) as {
          service_id?: string;
          api_contract_version?: string;
        };
        if (
          payload.service_id !== EXPECTED_BACKEND_SERVICE_ID
          || payload.api_contract_version !== EXPECTED_API_CONTRACT_VERSION
        ) {
          throw new ApiError(uiText("8010 端口不是当前版本的栖构后端。请关闭旧版程序后重新启动本应用。", "Port 8010 is not running this HavenFrame backend. Close the older application and restart HavenFrame."));
        }
        return;
      }
      throw new ApiError(
        uiText(`无法连接栖构本地后端（${getApiBase()}）。应用已等待 20 秒，请关闭旧版程序后重新启动栖构。`, `Could not connect to the HavenFrame backend at ${getApiBase()} after 20 seconds. Close older instances and restart HavenFrame.`),
        lastNetworkError instanceof ApiError ? lastNetworkError.status : undefined,
      );
    })()
      .catch((error) => {
        backendIdentityPromise = undefined;
        if (error instanceof ApiError) throw error;
        throw new ApiError(uiText(`无法连接栖构本地后端（${getApiBase()}）。请重新启动栖构。`, `Could not connect to the HavenFrame backend at ${getApiBase()}. Restart HavenFrame.`));
      });
  }
  return backendIdentityPromise;
}

function clearLocalSession(): void {
  localApiToken = undefined;
  backendIdentityPromise = undefined;
  notifyLocalSessionChanged();
}

export async function openAssetFolder(assetId: number): Promise<{ opened: boolean; path: string }> {
  return apiRequest<{ opened: boolean; path: string }>(`/api/assets/${assetId}/open-folder`, {
    method: "POST",
  });
}

export async function openAssetFile(assetId: number): Promise<{ opened: boolean; path: string }> {
  return apiRequest<{ opened: boolean; path: string }>(`/api/assets/${assetId}/open-file`, {
    method: "POST",
  });
}

export async function openProjectFolder(projectId: number): Promise<{ opened: boolean; path: string }> {
  return apiRequest<{ opened: boolean; path: string }>(`/api/projects/${projectId}/open-folder`, {
    method: "POST",
  });
}

export async function openExportFile(exportId: number): Promise<{ opened: boolean; path: string }> {
  return apiRequest<{ opened: boolean; path: string }>(`/api/exports/${exportId}/open-file`, {
    method: "POST",
  });
}

export async function openExportFolder(exportId: number): Promise<{ opened: boolean; path: string }> {
  return apiRequest<{ opened: boolean; path: string }>(`/api/exports/${exportId}/open-folder`, {
    method: "POST",
  });
}

export async function exportImageFile(payload: {
  project_id?: number | null;
  task_id?: number | null;
  asset_id: number;
  file_name: string;
  export_config_json?: Record<string, unknown>;
}): Promise<{
  id: number;
  project_id?: number | null;
  task_id?: number | null;
  type: string;
  file_name: string;
  file_path: string;
  export_config_json?: Record<string, unknown>;
  created_at: string;
}> {
  return apiRequest("/api/exports/image", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function exportReportImage(payload: {
  project_id?: number | null;
  task_id?: number | null;
  file_name: string;
  title?: string;
  board_document_ids?: number[];
  mode: "single" | "multi";
  source_asset_ids: number[];
  selected_item_ids: number[];
  review_snapshot: string;
  generated_asset_id?: number;
  delivery_prompt_version: string;
  output_language?: "zh-CN" | "en";
  export_config_json?: Record<string, unknown>;
}): Promise<{
  id: number;
  project_id?: number | null;
  task_id?: number | null;
  type: string;
  file_name: string;
  file_path: string;
  export_config_json?: Record<string, unknown>;
  created_at: string;
}> {
  return apiRequest("/api/exports/report-image", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function exportStructuredTable(payload: {
  project_id: number;
  task_id?: number | null;
  file_name: string;
  asset_ids?: number[];
  selected_item_ids?: number[];
  review_snapshot?: string;
  selected_only?: boolean;
  output_language?: "zh-CN" | "en";
  export_config_json?: Record<string, unknown>;
}): Promise<{
  id: number;
  project_id?: number | null;
  task_id?: number | null;
  type: string;
  file_name: string;
  file_path: string;
  export_config_json?: Record<string, unknown>;
  created_at: string;
}> {
  return apiRequest("/api/exports/table", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

interface ApiRequestInit extends RequestInit {
  timeoutMs?: number;
}

export async function apiRequest<T>(path: string, init?: ApiRequestInit): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = init?.timeoutMs ?? 45000;
  const { timeoutMs: _timeoutMs, ...requestInit } = init ?? {};
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const token = await ensureLocalSession();
    const headers =
      init?.body instanceof FormData
        ? { ...(init?.headers ?? {}), ...(token ? { "X-Qigou-Local-Token": token } : {}) }
        : {
            "Content-Type": "application/json",
            ...(token ? { "X-Qigou-Local-Token": token } : {}),
            ...(init?.headers ?? {}),
          };

    let response: Response;
    try {
      response = await fetch(`${getApiBase()}${path}`, {
        ...requestInit,
        signal: controller.signal,
        headers,
        credentials: "include",
      });
      if (response.status === 401) {
        clearLocalSession();
        const refreshedToken = await ensureLocalSession();
        if (refreshedToken && refreshedToken !== token) {
          const retryHeaders =
            init?.body instanceof FormData
              ? { ...(init?.headers ?? {}), "X-Qigou-Local-Token": refreshedToken }
              : {
                  "Content-Type": "application/json",
                  ...(init?.headers ?? {}),
                  "X-Qigou-Local-Token": refreshedToken,
                };
          response = await fetch(`${getApiBase()}${path}`, {
            ...requestInit,
            signal: controller.signal,
            headers: retryHeaders,
            credentials: "include",
          });
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ApiError(uiText(`本地后端请求超时：${Math.round(timeoutMs / 1000)} 秒。请检查 FastAPI 是否正在 ${getApiBase()} 运行。`, `The local backend request timed out after ${Math.round(timeoutMs / 1000)} seconds. Confirm that HavenFrame is running at ${getApiBase()}.`));
      }
      throw new ApiError(uiText(`后端未启动或端口未监听。请确认 FastAPI 正在 ${getApiBase()} 运行，并检查该地址的端口是否被其他程序占用。`, `The backend is not running or its port is unavailable. Confirm that HavenFrame is listening at ${getApiBase()}.`));
    }

    if (!response.ok) {
      let detail = uiText(`栖构 API 请求失败（HTTP ${response.status}）。`, `HavenFrame API request failed (HTTP ${response.status}).`);
      try {
        const payload = await response.json();
        detail = formatApiErrorDetail(payload?.detail, detail);
      } catch {
        // keep status-only error
      }
      throw new ApiError(detail, response.status);
    }

    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

function formatApiErrorDetail(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (!Array.isArray(value)) return fallback;
  const messages = value
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const detail = item as { loc?: unknown; msg?: unknown };
      const field = Array.isArray(detail.loc)
        ? detail.loc.filter((part) => part !== "body").map(String).join(".")
        : "";
      const message = typeof detail.msg === "string" ? detail.msg : "";
      return field && message ? `${field}：${message}` : message;
    })
    .filter(Boolean);
  return messages.length > 0 ? messages.join("；") : fallback;
}
