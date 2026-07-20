import type { AppLocale } from "./locale";
import type { PromptTemplate } from "../types";

const englishBuiltinText: Record<string, string> = {
  "保持动线清晰，输出适合客户评审的展示图。": "Keep circulation clear and produce a presentation suitable for client review.",
  "墙体变形, 标注缺失": "warped walls, missing annotations",
  "生成一张真实感室内渲染图，保留原始建筑结构，并优化家具、材质配色和灯光。": "Create a photorealistic interior rendering that preserves the original architecture while refining the furniture, material palette, and lighting.",
  "保留房间结构，同时升级家具、材质和灯光，形成精修提案图。": "Preserve the room structure while upgrading the furniture, materials, and lighting for a polished proposal image.",
  "保留结构，同时提升材质表现和工作室级灯光。": "Preserve the structure while improving material realism and studio-quality lighting.",
  "灯光浑浊, 结构变形, 家具扭曲, 构图杂乱": "muddy lighting, structural distortion, warped furniture, cluttered composition",
  "生成侘寂日式客厅方案": "Create a Wabi-Sabi Japanese living-room concept",
  "生成一张侘寂日式客厅方案图，包含暖木色、柔和中性色软包和安静日光。": "Create a Wabi-Sabi Japanese living-room concept with warm wood, soft neutral upholstery, and calm daylight.",
  "低质量, 结构变形": "low quality, structural distortion",
  "工作室提案起步模板": "Studio proposal starter template",
  "空间精修 -> 方案板预览 -> 图片报告导出交付。": "Space refinement -> board preview -> image-report export.",
  "必需的源图位置。": "Required source-image slot.",
  "风格或材质参考。": "Style or material reference.",
  "可选视觉方向。": "Optional visual direction.",
  "预留给局部编辑工作流。": "Reserved for regional editing workflows.",
  "主要输入图。": "Primary input image.",
  "可选设计参考。": "Optional design reference.",
  "可选平面信息。": "Optional floor-plan information.",
  "预留给编辑任务。": "Reserved for editing tasks.",

  "空间精修提示词": "Space rendering prompt",
  "方案板增强提示词": "Board enhancement prompt",
  "平面图上色基础提示词": "Floor-plan visualization base prompt",
  "空间图精修真实感": "Photorealistic space refinement",
  "毛坯 / 白模转精装": "Shell / white model to finished interior",
  "单房间软装方案板": "Single-room furnishing board",
  "平面图 2D/3D 可视化": "Floor-plan 2D/3D visualization",

  "你是一名室内可视化助手。": "You are an interior visualization assistant.",
  "为 {room_type} 生成一张 {style} 风格的精修渲染图，材质关键词为 {material_keywords}。": "Create a refined {style} rendering for a {room_type} using these material keywords: {material_keywords}.",
  "结构扭曲, 光线差, 杂乱": "structural distortion, poor lighting, clutter",
  "生成可用于工作室提案的方案材料。": "Create presentation material suitable for a professional design studio.",
  "为 {room_type} 生成一张 {style} 风格方案板，预算级别为 {budget_level}。": "Create a {style} concept board for a {room_type} at the {budget_level} budget level.",
  "版面拥挤, 标签不可读": "crowded layout, unreadable labels",
  "你是一名室内平面可视化助手。": "You are an interior floor-plan visualization assistant.",
  "将上传的平面图转换为 {render_mode} 输出，空间类型为 {room_type}，风格为 {style}。": "Convert the uploaded floor plan into a {render_mode} output for a {room_type} in the {style} style.",
  "墙体变形, 动线缺失, 标注不清": "warped walls, missing circulation, unclear annotations",
  "你是一名严谨的室内设计可视化助手，优先保留原始空间结构。": "You are a rigorous interior-design visualization assistant. Preserve the original spatial structure above all else.",
  "基于上传的空间照片或 SU 截图生成真实感室内效果图。必须保留原始空间结构、墙体位置、门窗洞口、顶面高度、地面边界、主要家具尺度和相机视角；优化材质、灯光、软装和氛围。风格为 {style}，空间类型为 {room_type}，材质关键词为 {material_keywords}。输出应像专业室内摄影，光线自然，细节清晰，可直接用于客户沟通。": "Create a photorealistic interior image from the uploaded room photo or SketchUp screenshot. Preserve the original layout, wall positions, openings, ceiling height, floor boundaries, principal furniture scale, and camera viewpoint. Refine materials, lighting, furnishings, and atmosphere. Use the {style} style for a {room_type}, with these material keywords: {material_keywords}. The result should resemble professional interior photography, with natural light and clear detail suitable for direct client communication.",
  "改变户型结构、移动门窗、墙体变形、家具比例错误、过度豪华、画面拥挤、低清晰度、文字水印、畸变、脏乱、假植物过多": "changed layout, moved openings, warped walls, incorrect furniture scale, excessive luxury, crowded composition, low clarity, text watermark, distortion, clutter, excessive artificial plants",
  "你是一名室内效果图深化助手，目标是把白模或毛坯图转成可信的精装交付图。": "You are an interior-rendering development assistant. Turn shell or white-model images into credible finished-interior deliverables.",
  "将上传的毛坯、白模或 SketchUp 截图转为完成度高的精装室内渲染图。保持原始空间体块、开窗、梁柱、墙地顶关系和透视角度不变；补充真实材质、灯带、家具、窗帘、地毯、装饰画和绿植。风格为 {style}，材质为 {material_keywords}，整体干净、克制、有交付质感。": "Turn the uploaded shell, white-model, or SketchUp image into a highly finished interior rendering. Keep the original massing, openings, beams, columns, wall-floor-ceiling relationships, and perspective unchanged. Add credible materials, integrated lighting, furniture, curtains, rugs, artwork, and planting. Use the {style} style and these materials: {material_keywords}. Keep the result clean, restrained, and presentation-ready.",
  "拆改结构、窗户消失、透视错误、比例失真、材质廉价、过曝、过暗、模型感、卡通感、文字和 logo": "structural alterations, missing windows, incorrect perspective, distorted scale, cheap-looking materials, overexposure, underexposure, model-like appearance, cartoon style, text, logos",
  "你是一名室内软装方案板设计助手，输出要适合客户快速确认方向。": "You are an interior furnishing-board assistant. Produce work that helps clients confirm the design direction quickly.",
  "根据上传房间图生成一张室内软装方案板。保留房间主色调和空间关系，提炼 {style} 风格方向，展示主视觉效果、材质样板、家具建议、灯具建议、色彩搭配和预算提示。空间类型为 {room_type}，材质关键词为 {material_keywords}。版面应清晰、留白充足、适合给客户快速确认方向。": "Create an interior furnishing board from the uploaded room image. Preserve its primary palette and spatial relationships, refine a {style} direction, and present the main visual, material samples, furniture suggestions, lighting suggestions, color coordination, and budget guidance. The room type is {room_type}; material keywords are {material_keywords}. Use a clear layout with ample whitespace so the client can confirm the direction quickly.",
  "版面拥挤、文字不可读、价格胡编、图片重复、材质不一致、风格漂移、低清晰度": "crowded layout, unreadable text, invented prices, duplicate images, inconsistent materials, style drift, low clarity",
  "你是一名室内平面可视化助手，必须保持平面结构关系准确。": "You are an interior floor-plan visualization assistant. Keep all spatial relationships accurate.",
  "将上传的平面图、草图或黑白图转成清晰的室内设计展示图。必须保留墙体、门窗、房间关系、动线和开间进深比例；增强空间分区、家具布置、地面材质和色彩层级。输出为 {style} 风格，空间类型为 {room_type}，适合方案汇报。": "Turn the uploaded floor plan, sketch, or monochrome drawing into a clear interior-design presentation. Preserve walls, doors, windows, room relationships, circulation, and width-depth proportions. Refine zoning, furniture layout, floor materials, and color hierarchy. Use the {style} style for a {room_type}; make it suitable for a design presentation.",
  "改变墙体、缺失门窗、房间关系错误、标注混乱、比例失真、文字乱码、低清晰度": "changed walls, missing openings, incorrect room relationships, confused annotations, distorted proportions, garbled text, low clarity",
  "初始版本": "Initial version",
  "系统内置提示词": "Built-in system prompt",
};

export function localizeBuiltinText(value: string, locale: AppLocale): string {
  if (locale === "zh-CN") return value;
  return englishBuiltinText[value] ?? value;
}

export function localizeBuiltinPrompt(prompt: PromptTemplate, locale: AppLocale): PromptTemplate {
  if (locale === "zh-CN" || !prompt.is_builtin) return prompt;
  return {
    ...prompt,
    name: localizeBuiltinText(prompt.name, locale),
    system_prompt: prompt.system_prompt ? localizeBuiltinText(prompt.system_prompt, locale) : prompt.system_prompt,
    user_prompt: localizeBuiltinText(prompt.user_prompt, locale),
    negative_prompt: prompt.negative_prompt ? localizeBuiltinText(prompt.negative_prompt, locale) : prompt.negative_prompt,
    version_history: prompt.version_history?.map((entry) => ({
      ...entry,
      label: localizeBuiltinText(entry.label, locale),
      summary: localizeBuiltinText(entry.summary, locale),
    })),
  };
}
