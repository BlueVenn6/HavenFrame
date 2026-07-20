import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [path.join(root, "App.tsx"), ...walk(path.join(root, "src"))].filter((file) => /\.tsx?$/.test(file));
const allowedRawText = new Set(["· v"]);
const failures = [];
const runtimeErrors = new Set();

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  visit(tree, file);
}

for (const localeFile of ["locales/en.json", "locales/zh-Hans.json", "locales/zh-Hant.json"]) {
  assert.equal(fs.existsSync(path.join(root, localeFile)), true, `missing native locale resource: ${localeFile}`);
}
const appSource = fs.readFileSync(path.join(root, "App.tsx"), "utf8");
assert.match(appSource, /text\("栖构", "HavenFrame"\)/, "mobile brand must follow the selected locale");
const englishNative = fs.readFileSync(path.join(root, "locales/en.json"), "utf8");
const localRuntime = fs.readFileSync(path.join(root, "src/local-runtime.ts"), "utf8");
const mobileReport = fs.readFileSync(path.join(root, "src/mobile-report.ts"), "utf8");
const i18nSource = fs.readFileSync(path.join(root, "src/i18n.tsx"), "utf8");
assert.doesNotMatch(englishNative, /Qigou/, "English native metadata still uses the obsolete brand");
assert.match(englishNative, /HavenFrame/, "English native metadata is missing the HavenFrame brand");
assert.match(mobileReport, /brand:\s*"栖构 · 客户正式交付"/, "Chinese mobile report branding is missing");
assert.match(mobileReport, /brand:\s*"HavenFrame · Client Delivery"/, "English mobile report branding is missing");
assert.match(localRuntime, /outputLanguage: "zh-CN" \| "en"/, "mobile exports do not receive the selected language");
assert.doesNotMatch(localRuntime, /多房间方案板 \/ Multi-room Board|已确认元素 \/ Confirmed Items/, "mobile report still mixes Chinese and English in one output");
assert.match(i18nSource, /中转可访问，但未提供模型查询接口/, "relay reachability result is not localized");
assert.match(i18nSource, /HTTP \(\\d\+\): Provider 请求失败/, "empty Provider response is not localized");
assert.match(appSource, /taskProviderLabel\(model\.provider, text\)/, "mobile model summary does not localize canonical Provider names");
assert.match(appSource, /result\.error \? localizedError\(result\.error, locale\)/, "mobile connectivity status can leak a Chinese runtime message into English UI");
for (const runtimeError of runtimeErrors) {
  if (!i18nSource.includes(JSON.stringify(runtimeError))) failures.push(`src/i18n.tsx: missing English runtime error: ${runtimeError}`);
}
assert.deepEqual(failures, [], failures.join("\n"));
console.log(`PASS mobile i18n JSX and native metadata coverage (${files.length} files)`);

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
  if (ts.isNewExpression(node) && node.expression.getText() === "Error" && node.arguments?.length) {
    const argument = node.arguments[0];
    if (ts.isStringLiteral(argument) && /\p{Script=Han}/u.test(argument.text) && !file.endsWith(`${path.sep}i18n.tsx`)) runtimeErrors.add(argument.text);
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.left.getText().endsWith("error_message") && ts.isStringLiteral(node.right) && /\p{Script=Han}/u.test(node.right.text)) {
    runtimeErrors.add(node.right.text);
  }
  ts.forEachChild(node, (child) => visit(child, file));
}
