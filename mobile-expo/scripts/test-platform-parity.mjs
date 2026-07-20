import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceFiles = [
  "App.tsx",
  "index.ts",
  "src/board-review.ts",
  "src/constants.ts",
  "src/direct-providers.ts",
  "src/local-model-routes.ts",
  "src/local-runtime.ts",
  "src/mobile-report.ts",
  "src/provider-errors.ts",
  "src/runtime-selection.ts",
  "src/types.ts",
  "src/ui.tsx",
];
const source = sourceFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");

for (const forbidden of [
  "/api/local",
  "/api/render-engines",
  "localhost",
  "127.0.0.1",
  "10.0.2.2",
  "comfyui",
  "mock_renderer",
]) {
  assert.equal(source.toLowerCase().includes(forbidden), false, `mobile runtime contains forbidden desktop capability: ${forbidden}`);
}

const app = fs.readFileSync(path.join(root, "App.tsx"), "utf8");
const runtimeSelection = fs.readFileSync(path.join(root, "src/runtime-selection.ts"), "utf8");
const localRuntime = fs.readFileSync(path.join(root, "src/local-runtime.ts"), "utf8");
const entry = fs.readFileSync(path.join(root, "index.ts"), "utf8");
const config = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
const constants = fs.readFileSync(path.join(root, "src/constants.ts"), "utf8");

assert.match(entry, /registerRootComponent\(App\)/, "Android/iOS must share the same root App");
assert.match(app, /new LocalMobileClient\(\)/, "shared App must use the standalone BYOK runtime");
assert.match(app, /confirmExternalTransfer\("generation"/, "mobile generation must ask for action-level data-flow confirmation");
assert.match(app, /confirmExternalTransfer\("extraction"/, "mobile extraction must ask for action-level data-flow confirmation");
assert.match(app, /completed !== false && successMessage/, "cancelled provider actions must not display a false success message");
assert.doesNotMatch(app, /setActiveAssetIds\(relatedAssets\.slice/, "project history must not become the current workflow input");
assert.match(localRuntime, /if \(!args\.dataFlowConfirmed\)/, "standalone runtime must enforce data-flow confirmation");
assert.match(localRuntime, /mobile_default === true/, "the last saved mobile route must become the active workflow route");
assert.match(runtimeSelection, /isConfigured:\s*Boolean\(selected\)/, "missing image routes must not masquerade as runnable defaults");
assert.match(runtimeSelection, /if \(!selected\) return undefined/, "missing GLM routes must fail closed");
assert.match(runtimeSelection, /filter\(hasStoredCredential\)/, "mobile workflow routes must require a key in secure storage");
assert.match(runtimeSelection, /return provider\.has_api_key === true/, "route presets without stored keys must not appear runnable");
assert.match(app, /中转 Base URL 不能为空/, "mobile relay configuration must fail closed before saving");
assert.match(constants, /key:\s*"openai-relay"[\s\S]*?routing_mode:\s*"relay_base_url"/, "mobile must expose the OpenAI gpt-image-2 relay route");
assert.match(constants, /key:\s*"openai-direct"[\s\S]*?routing_mode:\s*"direct_api"/, "mobile must expose the OpenAI gpt-image-2 native route");
assert.match(constants, /key:\s*"glm-direct"[\s\S]*?open\.bigmodel\.cn/, "mobile must expose the mainland Zhipu GLM route");
assert.match(constants, /key:\s*"glm-international-direct"[\s\S]*?api\.z\.ai/, "mobile must expose the international Z.AI GLM route");
for (const modelId of ["gemini-2.5-flash-image", "gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview"]) {
  assert.equal(constants.includes(`model_name: "${modelId}"`), true, `Gemini image route is missing: ${modelId}`);
}
assert.match(app, /label=\{`\$\{text\(preset\.providerLabel, preset\.providerLabelEn\)\} · \$\{preset\.model_name\}`\}/, "the mobile route selector must show the exact Provider and model id without an oversized marketing label");
assert.doesNotMatch(app, /headerSub\} numberOfLines=\{1\}/, "the selected project name must not be clipped to one line");
assert.match(source, /\$\{baseUrl\}\$\{sourceUris\.length \? "\/images\/edits" : "\/images\/generations"\}/, "OpenAI image generation must select edits or generations from the real input set");
assert.match(source, /\$\{baseUrl\}\/models\/\$\{args\.config\.model_name\}:generateContent/, "Gemini image generation must use the selected model id");
assert.match(source, /\$\{baseUrl\}\/chat\/completions/, "GLM extraction must use the selected regional Chat Completions route");
assert.match(source, /ImageManipulator\.manipulate\(uri\)/, "GLM vision input must use a bounded temporary Provider image without changing the project original");
assert.match(source, /maxDimension > 1600/, "GLM vision input must cap oversized mobile photos before Base64 JSON upload");
assert.match(source, /CREDENTIALS_CONNECTED/, "text-only GLM connectivity must remain explicitly unverified for multimodal extraction");
assert.match(source, /UnknownHostException/, "Android DNS failures must be classified separately from Provider HTTP failures");
assert.doesNotMatch(source, /heroImage\.provider|heroImage\.model/, "client-facing mobile reports must not expose Provider or model implementation details");
assert.equal(
  fs.existsSync(path.join(root, "src/platform.ts")),
  false,
  "mobile must not ship a desktop capability registry",
);
assert.match(source, /SecureStore\.setItemAsync\(secretStorageKey\(key\), apiKey\)/, "each model key must be stored separately in the system secure store");
assert.match(source, /generateDirectImage/, "mobile generation must call the selected provider directly");
assert.match(source, /extractDirectItems/, "mobile extraction must call GLM vision directly");
assert.match(source, /FileSystem\.documentDirectory/, "projects and generated assets must persist in the app document directory");
assert.doesNotMatch(source, /当前 EAS 构建环境/, "local Android runtime must not instruct users to configure EAS");
assert.match(app, /workflow\.key === "spaceRender"[\s\S]*space_render\.extraction/, "space render must support optional GLM reference extraction");
assert.match(app, /useReferenceImages/, "space render must allow reference images to be disabled");
assert.match(app, /MobileBoardReviewItem/, "single/multi boards must share the real item review UI");
assert.match(app, /generateBoardReport/, "single/multi report generation must be an independent action");
assert.match(app, /exportBoardReport/, "single/multi formal report export must be an independent action");
assert.match(app, /submitImage/, "image generation must be an independent action");
assert.match(app, /const latestResult = relatedTasks\.map\(firstResultAsset\)\.find\(Boolean\)/, "mobile workflow must resolve its latest real generated result");
assert.doesNotMatch(app, /const relatedTasks = [^;]+\.slice\(0, 3\)/, "mobile latest output disappears after three non-image tasks");
assert.doesNotMatch(app, /Boolean\(boardReviewError\)|if \(boardReviewError\)/, "GLM review must not block image generation");
assert.doesNotMatch(app, /保留前必须填写最低和最高预算/, "optional budget must not block keeping an item");
assert.match(app, /报告内容、图片生成、GLM 提取、人工确认和预算可以分别执行/, "mobile UI must state the independent workflow contract");
assert.match(localRuntime, /source_asset_ids:\s*args\.sourceAssetIds/, "space render must distinguish source space from references");
assert.match(localRuntime, /reference_asset_ids:\s*args\.referenceAssetIds/, "space render must persist reference asset ids");
assert.match(localRuntime, /review_schema_version:\s*2/, "board review must persist review schema v2");
assert.match(source, /deleteAsync\(asset\.content_path/, "uploaded assets must support real local deletion");
assert.match(source, /updateExtractedItem/, "extracted item review must persist locally");
assert.match(localRuntime, /exportStructuredTable/, "mobile must expose the structured procurement export");
assert.match(localRuntime, /generatedAssetId\?: number/, "source-image reports must not require an AI-generated image");
assert.doesNotMatch(localRuntime, /HavenFrame Board Composer|local-structured-report/, "mobile reports must not create fake successful model tasks");
assert.match(app, /2d_color[\s\S]*3d_birdview/, "floor plans must expose distinct 2D and 3D output modes");
assert.match(localRuntime, /output_mode:\s*args\.outputMode/, "floor-plan output mode must be persisted in the task snapshot");
assert.match(source, /formal_board_delivery/, "mobile report export must use the formal report schema");
assert.ok(config.expo.android?.package, "Android application id is missing");
assert.ok(config.expo.ios?.bundleIdentifier, "iOS bundle identifier is missing");

for (const method of [
  "listProjects",
  "uploadAsset",
  "submitProviderImageTask",
  "extractBoardItems",
  "updateExtractedItem",
  "deleteAsset",
  "generateSingleRoomBoard",
  "generateMultiRoomBoard",
  "listTasks",
  "review",
  "exportReportImage",
  "exportStructuredTable",
]) {
  assert.match(localRuntime, new RegExp(`\\b${method}\\s*\\(`), `standalone runtime method is missing: ${method}`);
}

assert.doesNotMatch(app, /移动 API 与访问凭据|云端访问凭据|云端未配置/, "standalone model UI must not require a Qigou cloud API");
assert.match(app, /<Picker/, "model routes must use a selector instead of rendering all route editors");
assert.doesNotMatch(source, /EXPO_PUBLIC_QIGOU_(?:ANDROID_|IOS_)?API_BASE_URL/, "standalone mobile source must not contain a hidden Qigou backend gate");

console.log("PASS Android/iOS standalone BYOK runtime and desktop-capability isolation contract");
