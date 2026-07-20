import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const files = walk(root).filter((file) => /\.tsx?$/.test(file));
const allowedRawText = new Set([
  "API Key",
  "Base URL",
  "Body Template JSON",
  "English",
  "Headers JSON",
  "KB",
  "ms",
  "s",
  "v",
  "workspace/outputs",
  "中文",
]);
const failures = [];
const runtimeErrors = new Set();

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  visit(tree, file);
}

verifyDynamicBuiltins();
verifyModelRouteVisibility();
verifyBrandAndDialogs();
verifyBackendRuntimeMessages();
verifyFrontendRuntimeMessages();

assert.deepEqual(failures, [], failures.join("\n"));
console.log(`PASS desktop i18n JSX coverage (${files.length} files)`);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function visit(node, file) {
  if (ts.isJsxText(node)) {
    const value = node.getText().trim();
    if (/[A-Za-z\p{Script=Han}]/u.test(value) && !allowedRawText.has(value)) failures.push(`${path.relative(root, file)}: untranslated raw JSX text: ${value}`);
  }
  if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
    const name = node.name.getText();
    const value = node.initializer.text;
    if (["placeholder", "title", "eyebrow", "empty"].includes(name) && /\p{Script=Han}/u.test(value)) {
      failures.push(`${path.relative(root, file)}: untranslated JSX attribute: ${value}`);
    }
  }
  if (ts.isNewExpression(node) && node.expression.getText() === "Error" && node.arguments?.length) {
    const argument = node.arguments[0];
    if (ts.isStringLiteral(argument) && /\p{Script=Han}/u.test(argument.text) && !file.endsWith(`${path.sep}i18n${path.sep}locale.tsx`)) {
      runtimeErrors.add(argument.text);
    }
  }
  ts.forEachChild(node, (child) => visit(child, file));
}

function verifyDynamicBuiltins() {
  const contentFile = path.join(root, "i18n", "builtin-content.ts");
  const source = fs.readFileSync(contentFile, "utf8");
  const requiredBuiltins = [
    "空间图精修真实感",
    "毛坯 / 白模转精装",
    "单房间软装方案板",
    "平面图 2D/3D 可视化",
    "生成一张真实感室内渲染图",
    "工作室提案起步模板",
  ];
  for (const value of requiredBuiltins) {
    if (!source.includes(value)) failures.push(`i18n/builtin-content.ts: missing dynamic built-in translation: ${value}`);
  }

  for (const relativePath of [
    "components/PromptEditor.tsx",
    "components/CustomTaskBuilder.tsx",
    "pages/FloorplanPage.tsx",
    "pages/SpaceRenderPage.tsx",
    "pages/CustomTasksPage.tsx",
  ]) {
    const pageSource = fs.readFileSync(path.join(root, relativePath), "utf8");
    if (!pageSource.includes("localizeBuiltin")) failures.push(`${relativePath}: dynamic built-in content is not localized`);
  }
}

function verifyModelRouteVisibility() {
  const file = path.join(root, "components", "WorkflowModelOverride.tsx");
  const source = fs.readFileSync(file, "utf8");
  const capabilityFunction = source.slice(source.indexOf("function supportsWorkflowCapability"), source.indexOf("function modelForNextConfig"));
  if (!capabilityFunction.includes("isSupportedInteriorImageModelConfig(config)")) {
    failures.push("components/WorkflowModelOverride.tsx: supported image routes disappear before an API key is saved");
  }
  if (capabilityFunction.includes("isRunnableImageProviderConfig(config)")) {
    failures.push("components/WorkflowModelOverride.tsx: route dropdown still filters by runtime credentials");
  }
}

function verifyBrandAndDialogs() {
  const appRoot = path.resolve(root, "..");
  const sidebar = fs.readFileSync(path.join(root, "components", "AppSidebar.tsx"), "utf8");
  const topBar = fs.readFileSync(path.join(root, "components", "TopBar.tsx"), "utf8");
  const locale = fs.readFileSync(path.join(root, "i18n", "locale.tsx"), "utf8");
  const boardStore = fs.readFileSync(path.join(root, "stores", "useBoardStore.ts"), "utf8");
  const capability = JSON.parse(fs.readFileSync(path.join(appRoot, "src-tauri", "capabilities", "main.json"), "utf8"));
  const tauriConfig = JSON.parse(fs.readFileSync(path.join(appRoot, "src-tauri", "tauri.conf.json"), "utf8"));
  const html = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
  for (const [relativePath, source] of [["AppSidebar.tsx", sidebar], ["TopBar.tsx", topBar]]) {
    if (source.includes("Qigou Studio") || source.includes("Qigou Workspace")) {
      failures.push(`components/${relativePath}: obsolete English brand remains`);
    }
  }
  if (!sidebar.includes('text("栖构工作台", "HavenFrame")')) failures.push("components/AppSidebar.tsx: locale-aware HavenFrame brand is missing");
  if (!topBar.includes('text("栖构工作区", "HavenFrame Workspace")')) failures.push("components/TopBar.tsx: locale-aware HavenFrame workspace title is missing");
  if (!locale.includes('getCurrentWindow().setTitle(title)')) failures.push("i18n/locale.tsx: native window title does not follow locale");
  if (!locale.includes('"__TAURI_INTERNALS__" in window')) failures.push("i18n/locale.tsx: browser preview is not protected from the Tauri-only window API");
  if (!capability.permissions.includes("core:window:allow-set-title")) failures.push("src-tauri/capabilities/main.json: native window title permission is missing");
  if (tauriConfig.productName !== "HavenFrame" || tauriConfig.app?.windows?.[0]?.title !== "HavenFrame") failures.push("src-tauri/tauri.conf.json: packaged English identity is not HavenFrame");
  if (!html.includes("<title>HavenFrame</title>")) failures.push("index.html: initial production title is not HavenFrame");
  if (boardStore.includes("window.confirm")) failures.push("stores/useBoardStore.ts: store still owns a hard-coded confirmation dialog");
  const taskStore = fs.readFileSync(path.join(root, "stores", "useTaskStore.ts"), "utf8");
  if (!taskStore.includes("currentAppLocale()")) failures.push("stores/useTaskStore.ts: provider confirmation does not follow the current locale");
  for (const page of ["SingleRoomBoardPage.tsx", "MultiRoomBoardPage.tsx", "SpaceRenderPage.tsx"]) {
    const source = fs.readFileSync(path.join(root, "pages", page), "utf8");
    if (source.includes("window.confirm") && !source.includes('locale === "zh-CN"')) failures.push(`pages/${page}: confirmation dialog does not follow the current locale`);
  }
}

function verifyFrontendRuntimeMessages() {
  const localeSource = fs.readFileSync(path.join(root, "i18n", "locale.tsx"), "utf8");
  for (const runtimeMessage of runtimeErrors) {
    if (!localeSource.includes(JSON.stringify(runtimeMessage))) {
      failures.push(`i18n/locale.tsx: missing English frontend error: ${runtimeMessage}`);
    }
  }
}

function verifyBackendRuntimeMessages() {
  const repoRoot = path.resolve(root, "../..");
  const backendRoot = path.join(repoRoot, "backend");
  const localeSource = fs.readFileSync(path.join(root, "i18n", "locale.tsx"), "utf8");
  const raisePattern = /raise\s+(?:ValueError|RuntimeError)\(\s*(["'])([^\r\n]*?\p{Script=Han}[^\r\n]*?)\1\s*\)/gu;
  for (const file of walk(backendRoot).filter((candidate) => candidate.endsWith(".py") && !candidate.includes(`${path.sep}tests${path.sep}`))) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(raisePattern)) {
      const runtimeMessage = match[2];
      if (!localeSource.includes(JSON.stringify(runtimeMessage))) {
        failures.push(`i18n/locale.tsx: missing English backend error: ${runtimeMessage}`);
      }
    }
  }
}
