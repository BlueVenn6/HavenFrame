export const floorplanOutputModes = [
  { label: "2D 彩色平面图", value: "2d_color" },
  { label: "3D 鸟瞰图", value: "3d_birdview" },
] as const;

export const floorplanStyles = ["现代暖调", "柔和侘寂", "酒店轻奢", "中性极简", "自定义"];

export const spaceRenderRoomTypes = [
  "客厅",
  "餐厅",
  "卧室",
  "厨房",
  "卫生间",
  "书房",
  "玄关",
  "零售空间",
  "餐厅空间",
  "酒店大堂",
  "展厅",
  "自定义",
];

export const spaceRenderStyles = [
  "现代",
  "极简",
  "柔和极简",
  "侘寂日式",
  "北欧",
  "侘寂",
  "当代",
  "当代轻奢",
  "现代古典",
  "中古现代",
  "工业风",
  "暖调现代",
  "自然现代",
  "地中海",
  "法式现代",
  "装饰艺术",
  "新中式",
  "禅意",
  "酒店风",
  "零售轻奢",
  "自定义",
];

export const capabilityOptions = [
  { label: "图片生成", value: "text_to_image" },
  { label: "图片编辑", value: "image_to_image" },
  { label: "多图组合", value: "multi_image_composition" },
  { label: "局部重绘", value: "inpaint" },
  { label: "放大增强", value: "upscale" },
] as const;

