# AGENTS.md

## 项目身份

本公开仓库只包含 HavenFrame / 栖构中英双语 Windows 桌面工作台，不包含 Android/iOS 客户端源码。

产品名称：栖构

定位：

- 室内设计 AI 交付助理
- 本地项目归档与结果回看工作台
- 图片生成、方案板、预算与模型配置工具

本产品不包含动态短片生成链路，也不包含本地部署、本地模型服务或本地 renderer 管理功能。

## 读取顺序

修改代码前先读：

1. `docs/PROJECT_SPEC.md`
2. `docs/CODEX_RULES.md`
3. 当前任务相关文件

## 产品主流程

必须保留并优先保证这些工作流可用：

1. 平面图 -> 2D / 3D 可视化
2. 单房间渲染 -> 方案板 + 材料 + 报价
3. 多房间渲染 -> 整体方案板 + 分房间方案板 + 预算汇总
4. 空间图片 / SU 截图 -> AI 精修效果图
5. 自定义可复用任务模板
6. 本地项目归档 / 回看 / 复盘

## Provider / Model 规则

Google Gemini 是内置官方 Provider。

Gemini 图片模型预设归属于 Google Gemini：

- Gemini 2.5 Flash Image (Nano Banana)
- Gemini 3 Pro Image Preview (Nano Banana Pro)
- Gemini 3.1 Flash Image Preview (Nano Banana 2)

不要把 Nano Banana 做成独立 Provider。

图片生成 Provider：

- OpenAI Native API
- OpenAI-compatible Relay Base URL
- Google Gemini

多模态提取 Provider：

- 智谱 GLM（中国大陆）
- Z.AI GLM（国际/海外）
- 用户明确配置的 OpenAI-compatible 视觉中转

必须支持：

- `direct_api`
- `relay_base_url`
- 每个模块的默认模型优先级
- 本地项目归档 / 回看 / 复盘

OpenAI `gpt-image-2` 保持默认图片生成链路。生成与提取配置必须独立保存，禁止互相覆盖。

## 技术栈

- 前端：React + TypeScript + Vite + Tailwind，位于 `app/`
- 桌面壳：Tauri，位于 `app/src-tauri/`
- 后端：FastAPI + SQLite，位于 `backend/`
- 本地数据、输出、缓存、临时文件：`workspace/`

## 约束

- 不要替换技术栈。
- 不要引入大型依赖，除非有明确必要。
- 不要删除用户 `workspace/` 下的文件。
- 不要提交 API Key、`.env`、输出文件、本地模型文件或签名文件。
- 不要调用真实付费模型做自动测试。
- 生成动作必须进入任务队列。
- Provider 逻辑必须放在 adapter / service 层，不要塞进页面组件。
- 不要加入当前产品范围之外的 Provider 或工作流。

## 质量要求

- 保持中文与英文 UI 使用同一套业务逻辑、模型路由和数据结构。
- 保持侧边栏顺序：项目、平面图、单房间方案板、多房间方案板、空间渲染、自定义任务、提示词、模型设置。
- 桌面端保留内嵌 sidecar 作为应用基础设施，但不得暴露本地部署产品能力。
- 保持 `gpt-image-2` 默认图片生成链路。
- 修改后运行相关测试和 `app` 构建；没有实际运行不要声称通过。
