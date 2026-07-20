export function providerHttpError(
  status: number,
  rawBody: string,
  endpoint: string,
  contentType = "",
): Error {
  const body = compactText(rawBody).slice(0, 600);
  let detail = "";
  try {
    const payload = JSON.parse(rawBody);
    const value = payload?.error?.message || payload?.error || payload?.message || payload?.detail;
    if (typeof value === "string") detail = compactText(value).slice(0, 600);
  } catch {
    // A gateway can return HTML or plain text. Preserve a bounded diagnostic instead of
    // incorrectly presenting an upstream HTTP failure as a JSON parsing failure.
  }
  if (!detail) {
    const kind = contentType.toLowerCase().includes("text/html")
      ? "Provider 网关返回了非 JSON 错误页"
      : "Provider 返回了非 JSON 错误内容";
    detail = body ? `${kind}: ${body}` : kind;
  }
  return new Error(`HTTP ${status}: ${detail}。Endpoint: ${endpoint}`);
}

export function providerInvalidSuccessResponse(status: number, endpoint: string): Error {
  return new Error(`Provider 成功响应不是有效 JSON。HTTP ${status}，Endpoint: ${endpoint}`);
}

export function normalizeProviderNetworkError(error: unknown, endpoint: string): Error {
  const message = error instanceof Error ? error.message : String(error || "Provider 网络请求失败。");
  const host = providerHost(endpoint);
  if (/UnknownHostException|Unable to resolve host|getaddrinfo[^\n]*failed|ENOTFOUND|specified hostname could not be found/i.test(message)) {
    return new Error(`手机当前网络无法解析 Provider 域名 ${host}。请检查当前 Wi-Fi/移动网络、VPN 或私有 DNS 后重试。Endpoint: ${endpoint}`);
  }
  return new Error(`${message}。Endpoint: ${endpoint}`);
}

function providerHost(endpoint: string): string {
  try {
    return new URL(endpoint).hostname || endpoint;
  } catch {
    return endpoint;
  }
}

function compactText(value: string): string {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
