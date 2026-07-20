import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const single = read("../src/pages/SingleRoomBoardPage.tsx");
const multi = read("../src/pages/MultiRoomBoardPage.tsx");
const review = read("../src/components/ExtractedItemReview.tsx");
const exportsDialog = read("../src/components/ExportDialog.tsx");
const store = read("../src/stores/useBoardStore.ts");
const apiClient = read("../src/api/client.ts");

for (const [name, source, forbidden] of [
  ["single-room", single, ["Boolean(reviewError)", "setGenerationError(reviewError)", "完成 GLM 提取后才能生成方案板"]],
  ["multi-room", multi, ["Boolean(reviewError)", "setGenerationError(reviewError)", "每个房间都必须先完成 GLM 信息提取"]],
  ["item-review", review, ["保留此元素前，请填写最低和最高预算"]],
]) {
  for (const text of forbidden) {
    if (source.includes(text)) throw new Error(`${name} still contains blocking rule: ${text}`);
  }
}

if (!single.includes("预算未填写，不要在图片里生成价格")) throw new Error("single-room optional budget prompt is missing");
for (const required of ["不得完全省略文字", "材质板", "色彩板", "家具与灯光", "最多展示 4 个代表性样本", "不得拥挤、重叠或裁切"]) {
  if (!single.includes(required)) throw new Error(`single-room board presentation constraint is missing: ${required}`);
}
for (const required of ["不得完全省略文字", "整案主视觉", "房间方向", "报价摘要", "不要把每个元素都做成独立缩略图", "不得拥挤、重叠或裁切"]) {
  if (!multi.includes(required)) throw new Error(`multi-room board presentation constraint is missing: ${required}`);
}
if (!multi.includes("GLM 提取是可选步骤")) throw new Error("multi-room optional extraction state is missing");
if (!review.includes("最低预算（可选）") || !review.includes("采购信息（可选）")) throw new Error("review optional labels are missing");
if (store.includes("当前人工确认结果尚未生成方案板归档，请先生成方案板再导出表格")) throw new Error("table export still depends on board generation");
const singleImageFlow = single.slice(single.indexOf("const queueBoardImage"), single.indexOf("return ("));
const multiImageFlow = multi.slice(multi.indexOf("const queueMultiRoomImage"), multi.indexOf("const extractMultiRoomItems"));
if (singleImageFlow.includes("generateSingleRoomBoards")) throw new Error("single-room image generation still depends on report generation");
if (multiImageFlow.includes("generateMultiRoomBoards")) throw new Error("multi-room image generation still depends on report generation");
if (!single.includes("生成报告内容") || !single.includes("生成方案板图片")) throw new Error("single-room independent actions are missing");
if (!multi.includes("生成报告内容") || !multi.includes("生成多房间图片")) throw new Error("multi-room independent actions are missing");
if (exportsDialog.includes("isExportingReport || !generatedAssetId")) throw new Error("formal report still requires a generated image");
if (store.includes("请先使用当前图片和人工确认元素完成真实方案板图片生成")) throw new Error("report export still depends on image generation");
if (apiClient.includes("API request failed:")) throw new Error("raw English API failure text can still reach the UI");
if (!apiClient.includes("for (let attempt = 0; attempt < 20")) throw new Error("packaged backend startup retry is missing");

console.log("PASS independent board workflows: generation, extraction, review, budget and table export are not falsely chained");
