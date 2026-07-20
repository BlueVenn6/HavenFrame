import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "src/lib/model-selection.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const temporaryModule = path.join(root, ".model-selection.test.mjs");
fs.writeFileSync(temporaryModule, compiled, "utf8");

try {
  const { resolveRunnableImageSelection, resolveRunnableVisionSelection } = await import(`${pathToFileURL(temporaryModule).href}?t=${Date.now()}`);
  const imageSelection = { provider: "OpenAI Native", model: "gpt-image-2", providerConfigId: 7 };
  assert.deepEqual(resolveRunnableImageSelection([
    config(7, "OpenAI Native", "openai", "gpt-image-2", false),
    config(18, "OpenAI Relay Base URL", "openai", "gpt-image-2", true, "relay_base_url", "https://relay.example/v1"),
  ], imageSelection), {
    provider: "OpenAI Relay Base URL",
    model: "gpt-image-2",
    providerConfigId: 18,
  }, "an unkeyed native image preference must not override a credential-backed relay");

  const extractionSelection = { provider: "Z.AI GLM International", model: "glm-4.5v", providerConfigId: 17 };
  assert.deepEqual(resolveRunnableVisionSelection([
    config(5, "Zhipu GLM Mainland", "zhipu_glm", "glm-4.5v", true),
    config(17, "Z.AI GLM International", "zai_glm", "glm-4.5v", false),
  ], extractionSelection), {
    provider: "Zhipu GLM Mainland",
    model: "glm-4.5v",
    providerConfigId: 5,
  }, "an unkeyed international GLM preference must not override a credential-backed mainland GLM route");
  console.log("PASS desktop runtime selects only credential-backed image and extraction routes");
} finally {
  fs.rmSync(temporaryModule, { force: true });
}

function config(id, providerName, providerId, modelId, hasApiKey, routingMode = "direct_api", baseUrl = "https://provider.example/v1") {
  return {
    id,
    provider_name: providerName,
    provider_id: providerId,
    provider_type: routingMode === "relay_base_url" ? "openai_compatible" : "built_in_official",
    routing_mode: routingMode,
    compatibility_mode: routingMode === "relay_base_url" ? "openai_compatible" : "native",
    base_url: baseUrl,
    has_api_key: hasApiKey,
    model_name: modelId,
    model_id: modelId,
    capability: providerId.includes("glm") ? "vision" : "image",
    capabilities_json: providerId.includes("glm") ? ["text", "vision"] : ["image"],
    is_enabled: true,
    priority: id,
    extra_config_json: { provider_id: providerId, model_id: modelId },
  };
}
