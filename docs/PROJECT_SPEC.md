# HavenFrame / 栖构双语工作台项目说明

## 1. 产品概览

HavenFrame（中文名：栖构）是支持简体中文和英文的室内 AI 交付助理。

它是桌面 / 本地 Web 工作台，不是通用图片生成器。核心目标是把室内设计交付过程中的图片上传、模型配置、项目归档、方案生成、预算整理和结果回看串成稳定流程。

## 2. 产品范围

本仓库维护同一套中英双语功能。切换语言不得改变模型、Provider、项目数据或任务行为。

产品包含：

1. 项目
2. 平面图
3. 单房间方案板
4. 多房间方案板
5. 空间渲染
6. 自定义任务
7. 提示词
8. 模型设置

产品不包含动态短片生成流程。不要添加相关菜单、路由、后端接口、模型能力、adapter、测试或文档规划。

## 3. 核心工作流

1. 平面图 / 草图 / 黑白图 -> 2D 彩色平面图或 3D 俯视图
2. 单房间图片 -> 方案板、材料板、报价卡
3. 多房间图片 -> 整体方案板、分房间方案板、预算汇总
4. 空间图片 / 白模 / SU 截图 -> AI 精修效果图
5. 自定义可复用任务模板
6. 本地项目归档、历史回看、复盘

## 4. 默认 Provider 与模型

默认图片生成链路：

- Provider：OpenAI
- 默认模型：`gpt-image-2`

内置 Provider：

- OpenAI
- Google Gemini
- OpenAI-Compatible Relay / Custom

Gemini 图片预设：

- Gemini 2.5 Flash Image (Nano Banana)
- Gemini 3 Pro Image Preview (Nano Banana Pro)
- Gemini 3.1 Flash Image Preview (Nano Banana 2)

Nano Banana 系列必须归在 Google Gemini Provider 下，不要作为独立 Provider。

桌面版保留内嵌 FastAPI、SQLite、workspace 与任务队列作为应用基础设施，但不提供本地部署页面、本地模型服务或本地 renderer。Android/iOS 使用本机应用存储并直接调用用户配置的 Provider。

## 6. 技术架构

- 前端：React + TypeScript + Vite + Tailwind
- 状态：Zustand + TanStack Query
- 后端：FastAPI + SQLite
- 本地目录：`workspace/`
- 任务：所有生成动作通过任务队列提交
- Provider：模型调用通过 adapter / service 层

## 7. 质量边界

- 中文模式必须完整使用中文，英文模式必须完整使用英文；用户输入和历史项目名称不得被自动翻译。
- 不提交 `.env`、API Key、本地输出、workspace 文件、本地模型文件或签名文件。
- 不在测试中调用真实付费模型。
- 不把 Provider 逻辑写进页面组件。
- 不让 ComfyUI 成为必需项。
- 不破坏 OpenAI `gpt-image-2` 默认图片生成链路。
