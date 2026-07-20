import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "src/provider-errors.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const temporaryModule = path.join(root, ".provider-errors.test.mjs");
fs.writeFileSync(temporaryModule, compiled, "utf8");

try {
  const { normalizeProviderNetworkError, providerHttpError } = await import(`${pathToFileURL(temporaryModule).href}?t=${Date.now()}`);
  const gateway = providerHttpError(502, "<html><body>Bad gateway</body></html>", "https://open.bigmodel.cn/api/paas/v4/chat/completions", "text/html");
  assert.match(gateway.message, /^HTTP 502: Provider 网关返回了非 JSON 错误页: Bad gateway。Endpoint:/);
  assert.doesNotMatch(gateway.message, /无效 JSON/, "an upstream 502 must not be misreported as a JSON parser defect");

  const dns = normalizeProviderNetworkError(
    new Error('fetch failed: java.net.UnknownHostException: Unable to resolve host "draw.dragtokens.com"'),
    "https://draw.dragtokens.com/v1/images/generations",
  );
  assert.match(dns.message, /手机当前网络无法解析 Provider 域名 draw\.dragtokens\.com/);
  assert.match(dns.message, /VPN 或私有 DNS/);
  console.log("PASS mobile Provider errors preserve HTTP gateway and device DNS root causes");
} finally {
  fs.rmSync(temporaryModule, { force: true });
}
