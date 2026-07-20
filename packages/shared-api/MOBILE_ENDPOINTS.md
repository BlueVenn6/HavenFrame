# 栖构手机端接口目录

Android/iOS 手机端使用已部署的云端 FastAPI 后端。后端 Base URL 由 `EXPO_PUBLIC_QIGOU_API_BASE_URL` 或平台专用构建变量提供，手机端不展示本地地址、局域网地址或连接设置入口。

手机端不调用 `/api/local/*`、`/api/render-engines/*`、open-file/open-folder 或桌面 task WebSocket。新版桌面端和手机端均不提供本地部署、本地模型服务或本地渲染引擎配置；桌面安装包内的后端 sidecar 仅负责项目、任务、资产和 BYOK Provider 调用，不是面向用户的本地部署能力。

图片和导出内容请求携带与 REST 相同的 bearer 凭据。方案板报告必须提交当前项目真实 `board_document_ids`，后端拒绝仅由固定章节文字生成的报告。

## 健康检查

- `GET /health`
  - 用途：检测后端是否可达。

## 项目

- `GET /api/projects`
  - 用途：项目列表。
- `POST /api/projects`
  - 用途：创建手机端项目。
- `GET /api/projects/{project_id}`
  - 用途：项目详情。
- `GET /api/projects/{project_id}/review`
  - 用途：项目归档、素材、任务复盘、导出记录。

## 素材

- `POST /api/assets/upload`
  - 用途：上传平面图、房间图、空间图或参考图。
  - Multipart 字段：`project_id`、`asset_type`、`source`、可选 `room_type`、`file`。
- `GET /api/assets?project_id={project_id}`
  - 用途：项目素材列表。
- `GET /api/assets/{asset_id}`
  - 用途：素材元数据。
- `GET /api/assets/{asset_id}/content`
  - 用途：图片或 SVG 方案板内容，用于预览和查看大图。

## 任务

- `GET /api/tasks?project_id={project_id}`
  - 用途：任务队列和历史。
- `GET /api/tasks/{task_id}`
  - 用途：任务详情。
- `GET /api/tasks/{task_id}/result`
  - 用途：任务结果。
- `POST /api/tasks/provider-image`
  - 用途：提交平面图、单房间、多房间、空间渲染、自定义任务的真实图片生成任务。
- `POST /api/tasks/{task_id}/cancel`
  - 用途：取消排队或运行中任务。
- `POST /api/tasks/{task_id}/retry`
  - 用途：重试失败任务。

## 工作流辅助

- `POST /api/workflows/softboard/extract-items`
  - 用途：通过独立 GLM 配置提取单/多房间结构化信息。
- `POST /api/workflows/softboard/single-room`
  - 用途：生成单房间材料板、色彩板、报价卡和方案板记录。
- `POST /api/workflows/softboard/multi-room`
  - 用途：生成整屋方案板、分房间方案板和预算汇总记录。
- `GET /api/workflows/softboard/documents?project_id={project_id}`
  - 用途：读取当前项目真实方案板记录和预览资产。

## 提示词与自定义模板

- `GET /api/prompts`
  - 用途：提示词模板列表。
- `POST /api/prompts`
  - 用途：保存手机端提示词草稿。
- `GET /api/custom-tasks/templates`
  - 用途：自定义任务模板列表。
- `POST /api/custom-tasks/templates`
  - 用途：保存可复用自定义任务模板。

## 模型

- `GET /api/models/providers`
  - 用途：读取已配置 Provider / 模型状态。
- `POST /api/models/mobile-routes`
  - 用途：保存手机端可用的云端模型线路，包括 OpenAI 原生、OpenAI 兼容中转、Google Gemini 图片模型和 GLM 多模态提取模型。
- `GET /api/models/module-preferences`
  - 用途：读取各工作流默认模型优先级。
- `POST /api/models/test-all`
  - 用途：安全连通性检测。手机端固定 `include_costly=false`，不会自动真实出图。

## 导出

- `POST /api/exports/report-image`
  - 用途：从真实 BoardDocument 创建项目 SVG 图片报告。
- `POST /api/exports/table`
  - 用途：从真实 ExtractedItem 创建 UTF-8 BOM CSV。
- `GET /api/exports/{export_id}/content`
  - 用途：带 bearer 认证读取导出文件，不接收服务端绝对路径。

## 已知边界

- 手机端轮询任务队列，尚未接入推送或后台长连接。
- 手机端只管理用户填写的 Provider 模型线路，不包含本地部署、局域网服务、本地目录或本地渲染引擎配置。
- 真实付费模型调用必须由用户在工作流里明确加入任务队列。
