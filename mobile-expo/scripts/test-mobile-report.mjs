import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "src/mobile-report.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function("exports", "module", compiled)(module.exports, module);

const { boardDocumentData, renderFormalBoardReport } = module.exports;
const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
const project = {
  id: 1,
  name: "Harbor Residence",
  client_name: "Client A",
  status: "active",
  created_at: "2026-07-18T00:00:00Z",
  updated_at: "2026-07-18T00:00:00Z",
};
const items = [{
  id: 1,
  name: "Lounge chair",
  room_type: "Living room",
  material: "Walnut",
  color: "Warm white",
  selection_state: "keep",
  procurement_status: "purchased",
  price_min: 1000,
  price_max: 1600,
}];

const english = renderFormalBoardReport({
  project,
  mode: "single",
  title: "Single-room Design Board",
  style: "Soft minimal",
  prompt: "Preserve the source room.",
  sourceImages: [{ label: "source.png", dataUri: image, roomType: "Living room" }],
  heroImage: { label: "source.png", dataUri: image, generated: false },
  items,
  outputLanguage: "en",
});
assert.match(english, /HavenFrame · Client Delivery/);
assert.match(english, /Single-room Design Board/);
assert.match(english, /data:image\/png;base64/);
assert.match(english, /Lounge chair/);
assert.match(english, /Purchased/);
assert.match(english, /Project source \/ report reference/);
assert.match(english, /viewBox="0 0 1240 1754"/);
assert.match(english, /width="100%" height="auto"/);
assert.match(english, /@page \{ size: A4 portrait; margin: 0; \}/);
assert.match(english, /HAVENFRAME · A4 DELIVERY/);
assert.doesNotMatch(english, /栖构|单房间方案板|已采购/);

const sourceOnly = renderFormalBoardReport({
  project,
  mode: "single",
  title: "Single-room Design Board",
  style: "Soft minimal",
  prompt: "Preserve the source room.",
  sourceImages: [{ label: "source.png", dataUri: image, roomType: "Living room" }],
  heroImage: { label: "source.png", dataUri: image, generated: false },
  items: [],
  outputLanguage: "en",
});
assert.match(sourceOnly, /No extracted items were selected/);
assert.match(sourceOnly, /Project source \/ report reference/);
assert.match(sourceOnly, /current project source/);
assert.doesNotMatch(sourceOnly, /Design board visual/);

const unsetDirection = renderFormalBoardReport({
  project,
  mode: "single",
  title: "Single-room Design Board",
  style: "",
  prompt: "Preserve the source room.",
  sourceImages: [{ label: "source.png", dataUri: image, roomType: "Living room" }],
  heroImage: { label: "source.png", dataUri: image, generated: false },
  items: [],
  outputLanguage: "en",
});
assert.match(unsetDirection, /Design direction not specified/);
assert.doesNotMatch(unsetDirection, /Confirmed design direction|Design direction not specifi…/);

const chinese = renderFormalBoardReport({
  project: { ...project, name: "港湾住宅", client_name: "客户甲" },
  mode: "multi",
  title: "多房间方案板",
  style: "现代暖调",
  prompt: "保留当前图片。",
  sourceImages: [{ label: "客厅.png", dataUri: image, roomType: "客厅" }],
  heroImage: { label: "结果.png", dataUri: image, generated: true, provider: "OpenAI Relay", model: "gpt-image-2" },
  items: [{ ...items[0], name: "休闲椅", room_type: "客厅", material: "胡桃木", color: "暖白", procurement_status: "pending" }],
  outputLanguage: "zh-CN",
});
assert.match(chinese, /栖构 · 客户正式交付/);
assert.match(chinese, /多房间方案板/);
assert.doesNotMatch(chinese, /OpenAI Relay|gpt-image-2|Provider/);
assert.match(chinese, /休闲椅/);
assert.match(chinese, /方案板主视觉/);

const unsetChineseDirection = renderFormalBoardReport({
  project: { ...project, name: "港湾住宅", client_name: "客户甲" },
  mode: "single",
  title: "单房间方案板",
  style: "",
  prompt: "保留当前图片。",
  sourceImages: [{ label: "客厅.png", dataUri: image, roomType: "客厅" }],
  heroImage: { label: "客厅.png", dataUri: image, generated: false },
  items: [],
  outputLanguage: "zh-CN",
});
assert.match(unsetChineseDirection, /设计方向未填写/);
assert.doesNotMatch(unsetChineseDirection, /已确认设计方向/);

const longTextChinese = renderFormalBoardReport({
  project: { ...project, name: "这是一个非常长的中文客户住宅项目名称用于验证标题不会越过页面边界", client_name: "具有很长名称的客户与设计工作室" },
  mode: "single",
  title: "单房间方案板",
  style: "现代暖调与自然材质融合并包含多种空间设计方向",
  prompt: "保留当前图片。",
  sourceImages: [{ label: "一个非常长的客厅与开放式餐厅及多功能展示空间图片名称.png", dataUri: image, roomType: "客厅与开放式餐厅及多功能展示空间" }],
  heroImage: { label: "客厅.png", dataUri: image, generated: false },
  items: Array.from({ length: 12 }, (_, index) => ({
    ...items[0],
    id: index + 1,
    name: `${String(index + 1).padStart(2, "0")} 带有超长产品名称的模块化组合沙发与贵妃榻`,
    room_type: `客厅与开放式餐厅 ${index + 1}`,
    material: "布艺 / 浅色石材或仿石材质 / 金属框架与织物坐垫 / 超长补充材质说明",
    color: "浅米色 / 深棕色 / 浅色带图案 / 浅灰色 / 白色 / 黄铜色",
    procurement_status: "pending",
  })),
  outputLanguage: "zh-CN",
});
assert.match(longTextChinese, /clipPath id="header-content-clip"/);
assert.match(longTextChinese, /clipPath id="summary-content-clip"/);
assert.match(longTextChinese, /clipPath id="item-heading-clip"/);
assert.match(longTextChinese, /clipPath id="item-overflow-note-clip"/);
assert.match(longTextChinese, /clipPath id="footer-note-clip"/);
assert.match(longTextChinese, /布艺 \/ 浅色石材或仿石材质/);
assert.match(longTextChinese, /金属框架与织物坐垫/);
assert.match(longTextChinese, /本页完整展示前 \d+ 项/);
assert.doesNotMatch(longTextChinese, /…|\.\.\./);
assert.doesNotMatch(longTextChinese, /OpenAI|gpt-image|Gemini|GLM-4/);

const document = boardDocumentData({
  mode: "single",
  title: "Single-room Design Board",
  style: "Soft minimal",
  prompt: "Preserve the source room.",
  sourceAssetIds: [11],
  generatedAssetId: 12,
  selectedItemIds: [1],
  reviewSnapshot: "review-v2",
  outputLanguage: "en",
});
assert.equal(document.layout.template, "formal_board_delivery");
assert.deepEqual(document.data.source_asset_ids, [11]);
assert.equal(document.data.generated_asset_id, 12);

if (process.env.MOBILE_REPORT_AUDIT_OUTPUT) {
  const outputPath = path.resolve(process.env.MOBILE_REPORT_AUDIT_OUTPUT);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, longTextChinese, "utf8");
}

console.log("PASS mobile formal report composition and bilingual output");
