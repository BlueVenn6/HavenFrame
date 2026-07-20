import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "src/runtime-selection.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const temporaryModule = path.join(root, ".runtime-selection.test.mjs");
fs.writeFileSync(temporaryModule, compiled, "utf8");

try {
  const { resolveExtractionModel, resolveRunnableModel } = await import(`${pathToFileURL(temporaryModule).href}?t=${Date.now()}`);
  const imageProviders = [
    provider(1, "OpenAI Native", "openai", "gpt-image-2", false),
    provider(2, "OpenAI Relay", "openai", "gpt-image-2", true, "relay_base_url", "https://relay.example/v1"),
  ];
  const imagePreference = [{ module_name: "floorplan", default_provider_config_id: 1, priority_order_json: ["gpt-image-2"] }];
  assert.deepEqual(resolveRunnableModel(imageProviders, imagePreference, "floorplan"), {
    provider: "OpenAI Relay",
    modelName: "gpt-image-2",
    providerConfigId: 2,
    isConfigured: true,
  }, "an unkeyed preferred image route must not override a keyed relay route");

  const extractionProviders = [
    provider(5, "Zhipu GLM (Mainland China)", "zhipu_glm", "glm-4.5v", true),
    provider(17, "Z.AI GLM (International)", "zai_glm", "glm-4.5v", false),
  ];
  const extractionPreference = [{ module_name: "room_board_extraction", default_provider_config_id: 17, priority_order_json: ["glm-4.5v"] }];
  assert.deepEqual(resolveExtractionModel(extractionProviders, extractionPreference, "single_room_board"), {
    provider: "Zhipu GLM (Mainland China)",
    modelName: "glm-4.5v",
    providerConfigId: 5,
  }, "an unkeyed international GLM preference must fall back to a keyed mainland GLM route");
  assert.equal(resolveExtractionModel([extractionProviders[1]], extractionPreference, "single_room_board"), undefined, "an unkeyed GLM preset must not appear runnable");
  console.log("PASS mobile runtime selects only credential-backed image and extraction routes");
} finally {
  fs.rmSync(temporaryModule, { force: true });
}

function provider(id, providerName, providerId, modelId, hasApiKey, routingMode = "direct_api", baseUrl = "https://provider.example/v1") {
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
    is_enabled: true,
    priority: id,
    extra_config_json: { provider_id: providerId, model_id: modelId },
  };
}
