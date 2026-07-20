import type { ExtractedItem, Project } from "./types";

export interface ReportImageInput {
  label: string;
  dataUri: string;
  roomType?: string;
  generated?: boolean;
  provider?: string;
  model?: string;
}

export interface MobileBoardReportInput {
  project: Project;
  mode: "single" | "multi";
  title: string;
  style: string;
  prompt: string;
  sourceImages: ReportImageInput[];
  heroImage: ReportImageInput;
  items: ExtractedItem[];
  outputLanguage: "zh-CN" | "en";
}

export function boardDocumentData(input: Omit<MobileBoardReportInput, "project" | "sourceImages" | "heroImage" | "items"> & {
  sourceAssetIds: number[];
  generatedAssetId?: number;
  selectedItemIds: number[];
  reviewSnapshot: string;
  roomTags?: Record<string, string>;
}) {
  return {
    layout: {
      schema_version: 2,
      template: "formal_board_delivery",
      mode: input.mode,
      output_language: input.outputLanguage,
    },
    data: {
      schema_version: 2,
      title: input.title,
      style: input.style,
      prompt: input.prompt,
      source_asset_ids: input.sourceAssetIds,
      generated_asset_id: input.generatedAssetId ?? null,
      selected_item_ids: input.selectedItemIds,
      review_snapshot: input.reviewSnapshot,
      room_tags: input.roomTags ?? {},
      composed_at: new Date().toISOString(),
    },
  };
}

export function renderFormalBoardReport(input: MobileBoardReportInput): string {
  const labels = input.outputLanguage === "en" ? EN : ZH;
  const keptItems = input.items.filter((item) => item.selection_state === "keep");
  const roomNames = unique(keptItems.map((item) => item.room_type).filter(Boolean) as string[]);
  const materials = unique(keptItems.map((item) => item.material).filter(Boolean) as string[]);
  const colors = unique(keptItems.map((item) => item.color).filter(Boolean) as string[]);
  const hasBudget = keptItems.some((item) => item.price_min != null || item.price_max != null);
  const minBudget = keptItems.reduce((sum, item) => sum + (item.price_min ?? 0), 0);
  const maxBudget = keptItems.reduce((sum, item) => sum + (item.price_max ?? 0), 0);
  const purchased = keptItems.filter((item) => item.procurement_status === "purchased").length;
  const visibleSources = input.sourceImages.slice(0, 3);
  const candidateItems = keptItems.slice(0, 8);

  const width = 1240;
  const height = 1754;
  const margin = 56;
  const contentWidth = width - margin * 2;
  const heroY = 210;
  const heroHeight = 470;
  const heroWidth = 740;
  const summaryX = margin + heroWidth + 24;
  const summaryWidth = contentWidth - heroWidth - 24;
  const sourceY = 760;
  const itemY = 1010;

  const sourceColumns = Math.min(3, Math.max(1, visibleSources.length));
  const sourceWidth = (contentWidth - (sourceColumns - 1) * 24) / sourceColumns;
  const sourceMarkup = visibleSources.map((image, index) => {
    const x = margin + index * (sourceWidth + 24);
    const captionLines = wrapVisualText(
      `${labels.sourceBasis} ${String(index + 1).padStart(2, "0")} · ${image.roomType || labels.sourceImage}`,
      46,
    );
    if (captionLines.length > 2) throw new Error(labels.sourceCaptionTooLong);
    return `<rect x="${x}" y="${sourceY}" width="${sourceWidth}" height="160" rx="8" class="card"/>
      <image x="${x}" y="${sourceY}" width="${sourceWidth}" height="124" href="${image.dataUri}" preserveAspectRatio="xMidYMid slice"/>
      ${svgMultilineText(x + 14, sourceY + 143, captionLines, "caption", 14)}`;
  }).join("\n");

  const cardWidth = 556;
  const cardGap = 16;
  const itemLayouts = candidateItems.map((item, index) => {
    const budget = item.price_min == null && item.price_max == null
      ? labels.optional
      : `¥ ${item.price_min == null ? "-" : number(item.price_min)} - ${item.price_max == null ? "-" : number(item.price_max)}`;
    const titleLines = wrapVisualText(`${String(index + 1).padStart(2, "0")}  ${item.name}`, 42);
    const metaLines = wrapVisualText(
      [item.room_type, item.material, item.color].filter(Boolean).join(" · ") || labels.notExtracted,
      54,
    );
    const purchaseLines = wrapVisualText(item.purchase_method || labels.purchasePending, 46);
    const titleStart = 28;
    const metaStart = titleStart + titleLines.length * 18 + 8;
    const purchaseStart = metaStart + metaLines.length * 15 + 8;
    const cardHeight = Math.max(104, purchaseStart + purchaseLines.length * 15 + 24);
    return {
      status: item.procurement_status === "purchased" ? labels.purchased : labels.notPurchased,
      budget,
      titleLines,
      metaLines,
      purchaseLines,
      titleStart,
      metaStart,
      purchaseStart,
      cardHeight,
    };
  });

  const itemMarkup: string[] = [];
  let renderedItemCount = 0;
  let rowY = itemY;
  const maxItemBottom = height - 96;
  for (let rowStart = 0; rowStart < itemLayouts.length; rowStart += 2) {
    const rowItems = itemLayouts.slice(rowStart, rowStart + 2);
    const rowHeight = Math.max(...rowItems.map((entry) => entry.cardHeight));
    if (rowY + rowHeight > maxItemBottom) break;
    rowItems.forEach((entry, column) => {
      const x = margin + column * (cardWidth + cardGap);
      itemMarkup.push(`<rect x="${x}" y="${rowY}" width="${cardWidth}" height="${rowHeight}" rx="8" class="card"/>
        <rect x="${x}" y="${rowY}" width="6" height="${rowHeight}" rx="3" fill="#14A596"/>
        <text x="${x + cardWidth - 20}" y="${rowY + 28}" text-anchor="end" class="status">${entry.status}</text>
        ${svgMultilineText(x + 20, rowY + entry.titleStart, entry.titleLines, "item", 18)}
        ${svgMultilineText(x + 20, rowY + entry.metaStart, entry.metaLines, "meta", 15)}
        ${svgMultilineText(x + 20, rowY + entry.purchaseStart, entry.purchaseLines, "meta", 15)}
        <text x="${x + cardWidth - 20}" y="${rowY + rowHeight - 16}" text-anchor="end" class="budget">${escapeXml(entry.budget)}</text>`);
      renderedItemCount += 1;
    });
    rowY += rowHeight + 12;
  }
  if (candidateItems.length && renderedItemCount === 0) throw new Error(labels.itemTooLong);
  if (!itemMarkup.length) {
    itemMarkup.push(`<rect x="${margin}" y="${itemY}" width="${contentWidth}" height="84" rx="8" class="card"/><text x="${margin + 24}" y="${itemY + 50}" class="meta">${labels.noItems}</text>`);
  }

  const budgetText = hasBudget ? `¥ ${number(minBudget)} - ${number(maxBudget)}` : labels.optional;
  const roomsText = roomNames.join(" / ") || labels.notExtracted;
  const procurementText = `${keptItems.length} ${labels.items} · ${purchased}/${keptItems.length} ${labels.purchased}`;
  const [summaryMarkup, summaryFontSize] = summaryTextMarkup(
    summaryX + 28,
    heroY + 70,
    heroY + heroHeight - 18,
    summaryWidth - 56,
    [
      [labels.budget, budgetText],
      [labels.rooms, roomsText],
      [labels.procurement, procurementText],
      [labels.materials, materials.join(" / ") || labels.notExtracted],
      [labels.colors, colors.join(" / ") || labels.notExtracted],
    ],
    labels.summaryTooLong,
  );

  const reportType = input.mode === "multi" ? labels.multi : labels.single;
  const overflowNote = keptItems.length > renderedItemCount
    ? labels.fullTableNote.replace("{count}", String(renderedItemCount))
    : "";
  const headerTitleLines = wrapVisualText(input.project.name || input.title, 54);
  const headerSubtitleLines = wrapVisualText(
    `${reportType} · ${input.project.client_name || labels.client} · ${input.style || labels.directionMissing}`,
    108,
  );
  if (headerTitleLines.length > 2 || headerSubtitleLines.length > 2) throw new Error(labels.headerTooLong);
  const headerTitleY = 82;
  const headerSubtitleY = headerTitleY + (headerTitleLines.length - 1) * 34 + 32;
  const footerLines = wrapVisualText(input.heroImage.generated ? labels.generatedFooter : labels.sourceFooter, 92);
  if (footerLines.length > 2) throw new Error(labels.footerTooLong);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="auto" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMin meet" style="display:block;max-width:210mm;height:auto;margin:0 auto;background:#F4F7FA">
  <defs>
    <clipPath id="header-content-clip"><rect x="${margin - 8}" y="8" width="${contentWidth + 8}" height="162" /></clipPath>
    <clipPath id="summary-content-clip"><rect x="${summaryX + 20}" y="${heroY + 50}" width="${summaryWidth - 40}" height="${heroHeight - 60}" /></clipPath>
    <clipPath id="item-heading-clip"><rect x="${margin - 8}" y="${itemY - 42}" width="${contentWidth - 352}" height="40" /></clipPath>
    <clipPath id="item-overflow-note-clip"><rect x="${width - margin - 344}" y="${itemY - 42}" width="344" height="40" /></clipPath>
    <clipPath id="footer-note-clip"><rect x="${margin - 8}" y="${height - 60}" width="${contentWidth - 242}" height="38" /></clipPath>
  </defs>
  <style>
    @page { size: A4 portrait; margin: 0; }
    @media print { :root { width: 210mm; height: 297mm; max-width: none; } }
    text { font-family:'Microsoft YaHei','Noto Sans CJK SC',Arial,sans-serif;letter-spacing:0; }
    .brand { fill:#57D3C5;font-size:19px;font-weight:700; }
    .title { fill:#FFFFFF;font-size:32px;font-weight:800; }
    .subtitle { fill:#C9D5E4;font-size:18px;font-weight:500; }
    .eyebrow { fill:#0F8B80;font-size:15px;font-weight:800; }
    .section { fill:#0B1838;font-size:23px;font-weight:800; }
    .summary-label { fill:#66758A;font-size:13px;font-weight:600; }
    .summary-value { fill:#0B1838;font-size:${summaryFontSize}px;font-weight:800; }
    .caption,.meta { fill:#566579;font-size:12px;font-weight:600; }
    .item { fill:#0B1838;font-size:16px;font-weight:800; }
    .status { fill:#0F8B80;font-size:12px;font-weight:800; }
    .budget { fill:#8A6508;font-size:12px;font-weight:800; }
    .card { fill:#FFFFFF;stroke:#D7E0E9;stroke-width:2; }
  </style>
  <rect width="${width}" height="${height}" fill="#F4F7FA"/>
  <rect width="${width}" height="170" fill="#0B1838"/>
  <g clip-path="url(#header-content-clip)">
    <text x="${margin}" y="47" class="brand">${labels.brand}</text>
    ${svgMultilineText(margin, headerTitleY, headerTitleLines, "title", 34)}
    ${svgMultilineText(margin, headerSubtitleY, headerSubtitleLines, "subtitle", 18)}
  </g>
  <text x="${margin}" y="${heroY - 22}" class="eyebrow">${input.heroImage.generated ? labels.generatedVisual : labels.sourceVisual}</text>
  <rect x="${margin}" y="${heroY}" width="${heroWidth}" height="${heroHeight}" rx="8" fill="#E2E8F0"/>
  <image x="${margin}" y="${heroY}" width="${heroWidth}" height="${heroHeight}" href="${input.heroImage.dataUri}" preserveAspectRatio="xMidYMid meet"/>
  <rect x="${summaryX}" y="${heroY}" width="${summaryWidth}" height="${heroHeight}" rx="8" class="card"/>
  <text x="${summaryX + 28}" y="${heroY + 40}" class="section">${labels.summary}</text>
  <g clip-path="url(#summary-content-clip)">${summaryMarkup}</g>
  <text x="${margin}" y="${sourceY - 42}" class="eyebrow">${labels.sourceBasis}</text>
  <text x="${margin}" y="${sourceY - 14}" class="section">${labels.sources}</text>
  ${sourceMarkup}
  <text x="${margin}" y="${itemY - 42}" class="eyebrow">${labels.review}</text>
  <text x="${margin}" y="${itemY - 14}" class="section" clip-path="url(#item-heading-clip)">${labels.details}</text>
  <text x="${width - margin}" y="${itemY - 14}" text-anchor="end" class="caption" clip-path="url(#item-overflow-note-clip)">${escapeXml(overflowNote)}</text>
  ${itemMarkup.join("\n")}
  <line x1="${margin}" y1="${height - 70}" x2="${width - margin}" y2="${height - 70}" stroke="#D7E0E9" stroke-width="2"/>
  <g clip-path="url(#footer-note-clip)">${svgMultilineText(margin, height - 46, footerLines, "caption", 14)}</g>
  <text x="${width - margin}" y="${height - 38}" text-anchor="end" class="caption">HAVENFRAME · A4 DELIVERY</text>
</svg>`;
}

const ZH = {
  brand: "栖构 · 客户正式交付", single: "单房间方案板", multi: "多房间方案板", client: "客户项目", directionMissing: "设计方向未填写",
  budget: "预算范围", rooms: "房间", procurement: "保留元素 / 采购进度", materials: "材质方向", colors: "色彩方向",
  items: "项", purchased: "已采购", notPurchased: "未采购", optional: "未填写（可选）", notExtracted: "未提取（可选）", sourceImage: "当前项目源图",
  noItems: "未选择提取元素；报告仍保留当前图片和设计方向。", generatedVisual: "方案板主视觉", sourceVisual: "项目源图 / 报告依据",
  summary: "交付摘要", sourceBasis: "当前图片依据", sources: "空间与风格来源", review: "信息提取 + 人工确认", details: "保留元素与预算明细",
  generatedFooter: "主视觉、名称、材质、颜色和预算均来自当前项目已保存的交付内容。", sourceFooter: "主视觉为当前项目源图；提取、人工确认和预算按当前项目已有内容纳入。",
  purchasePending: "购买方式待补充", fullTableNote: "本页完整展示前 {count} 项；其余内容见结构化表格",
  sourceCaptionTooLong: "报告图片说明过长，无法在 A4 页面内完整排版。", summaryTooLong: "报告摘要内容过长，无法在 A4 页面内完整排版；请精简异常字段后重试。",
  headerTooLong: "报告标题或项目说明过长，无法在 A4 页眉内完整排版。", footerTooLong: "报告页脚说明过长，无法完整排版。", itemTooLong: "报告明细内容过长，无法在 A4 页面内完整排版；请精简异常字段后重试。",
};

const EN = {
  brand: "HavenFrame · Client Delivery", single: "Single-room Design Board", multi: "Multi-room Design Board", client: "Client project", directionMissing: "Design direction not specified",
  budget: "Budget Range", rooms: "Rooms", procurement: "Retained / Procurement", materials: "Material Direction", colors: "Color Direction",
  items: "items", purchased: "Purchased", notPurchased: "Not purchased", optional: "Not provided (optional)", notExtracted: "Not extracted (optional)", sourceImage: "Current project source",
  noItems: "No extracted items were selected. The report still preserves the current image and design direction.", generatedVisual: "Design board visual", sourceVisual: "Project source / report reference",
  summary: "Delivery Summary", sourceBasis: "Current Image Basis", sources: "Space and Style Sources", review: "Extracted Details + Review", details: "Retained Items and Budget",
  generatedFooter: "The hero visual, names, materials, colors, and budgets come from the current project's saved delivery content.", sourceFooter: "The hero visual is the current project source; extraction, review, and budget details are included when available.",
  purchasePending: "Purchase method pending", fullTableNote: "Showing {count} complete items; see the structured table for the remainder",
  sourceCaptionTooLong: "The report image caption is too long to fit the A4 layout.", summaryTooLong: "The report summary is too long to fit the A4 layout. Shorten the unusually long fields and try again.",
  headerTooLong: "The report title or project description is too long to fit the A4 header.", footerTooLong: "The report footer is too long to fit the page.", itemTooLong: "A report detail is too long to fit the A4 page. Shorten the unusually long field and try again.",
};

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function visualTextUnits(value: string): number {
  return Array.from(value).reduce((total, char) => total + (/[^\u0000-\u00ff]/u.test(char) ? 2 : 1), 0);
}

function wrapVisualText(value: string, maxUnits: number): string[] {
  let remaining = String(value || "").replace(/\s+/g, " ").trim();
  const lines: string[] = [];
  while (remaining) {
    if (visualTextUnits(remaining) <= maxUnits) {
      lines.push(remaining);
      break;
    }
    let used = 0;
    let cutoff = 0;
    let preferredCutoff = 0;
    for (const [index, char] of Array.from(remaining).entries()) {
      const units = visualTextUnits(char);
      if (used + units > maxUnits) break;
      used += units;
      cutoff = index + 1;
      if (/\s|[\/·,，、;；]/u.test(char)) preferredCutoff = index + 1;
    }
    const splitAt = preferredCutoff >= Math.max(1, Math.floor(cutoff / 2)) ? preferredCutoff : cutoff;
    if (!splitAt) throw new Error("Unable to wrap report text.");
    lines.push(Array.from(remaining).slice(0, splitAt).join("").replace(/[\s\/·,，、;；]+$/u, ""));
    remaining = Array.from(remaining).slice(splitAt).join("").replace(/^[\s\/·,，、;；]+/u, "");
  }
  return lines.length ? lines : [""];
}

function summaryTextMarkup(
  x: number,
  startY: number,
  maxY: number,
  availableWidth: number,
  values: Array<[string, string]>,
  tooLongMessage: string,
): [string, number] {
  for (let fontSize = 15; fontSize >= 9; fontSize -= 1) {
    const lineHeight = fontSize + 3;
    const maxUnits = Math.max(30, Math.floor(availableWidth / (fontSize * 0.56)));
    const wrapped = values.map(([label, value]) => [label, wrapVisualText(value, maxUnits)] as const);
    let cursor = startY;
    const markup: string[] = [];
    for (const [label, lines] of wrapped) {
      markup.push(`<text x="${x}" y="${cursor}" class="summary-label">${escapeXml(label)}</text>`);
      const valueY = cursor + 24;
      markup.push(svgMultilineText(x, valueY, lines, "summary-value", lineHeight));
      cursor = valueY + lines.length * lineHeight + 12;
    }
    if (cursor <= maxY) return [markup.join(""), fontSize];
  }
  throw new Error(tooLongMessage);
}

function svgMultilineText(x: number, y: number, lines: string[], className: string, lineHeight: number): string {
  const spans = lines.map((line, index) => `<tspan x="${x}" y="${y + index * lineHeight}">${escapeXml(line)}</tspan>`).join("");
  return `<text class="${className}">${spans}</text>`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function number(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}
