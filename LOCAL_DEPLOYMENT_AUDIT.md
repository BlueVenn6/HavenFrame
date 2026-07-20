# 本地部署审计报告

## 文件清单

- `app/src/pages/LocalDeployPage.tsx`：Windows 本地部署页前端。读取后端状态、渲染器列表，触发检测、配置、启用、设默认和打开目录；测试渲染区仅在后端显式返回开发 renderer 时出现。
- `app/src/types/index.ts`：本地部署和渲染器 TypeScript 类型。
- `backend/api/local.py`：仅 desktop profile 注册，提供状态检查、路径打开、渲染器管理、日志和归档；开发测试任务受环境开关约束。
- `backend/api/render_engines.py`：兼容旧前端的渲染器 API。
- `backend/services/runtime_service.py`：本地服务状态、路径检测、渲染器注册表、渲染器连接测试、配置保存和安全路径打开。
- `backend/services/task_service.py`：数据库任务、队列快照、真实图片任务、Mock Renderer 后台 worker、归档和日志写入。
- `backend/tasks/queue.py`：内存任务队列快照，供状态页和 WebSocket 展示。
- `backend/tasks/worker.py`：旧 worker 骨架，目前不承担真实本地渲染消费。
- `backend/adapters/local/renderer_adapter.py`：本地渲染器统一接口协议。
- `backend/adapters/local/mock_renderer_adapter.py`：Mock Renderer adapter，复用真实数据库任务链路。
- `backend/schemas/runtime.py`：本地部署状态机、渲染器配置和 Mock 渲染请求 schema。
- `backend/core/config.py`：项目根目录、数据库、workspace、outputs、cache、temp 等路径配置。
- `scripts/smoke-local-deploy.py`：无 GPU 本地部署冒烟测试脚本。

## 真实可用

- `/health` 真实检测 FastAPI 是否可访问。
- `/api/local/status` 和 `/api/local/check` 返回后端、前端、工作区、归档、队列、数据库、资产目录和诊断项状态。
- 工作区和归档目录会真实创建并检查可读、可写。
- 渲染器状态使用 `unknown / unconfigured / disabled / checking / ready / running / degraded / failed`。
- 开发测试渲染器不依赖 GPU，只验证队列/文件失败路径；它不代表真实模型，默认关闭且正式包验证会断言未暴露。
- 未 ready/running 的真实渲染器不能设为默认，后端会拒绝。
- 打开目录只允许 workspace、projects、outputs、logs、data、cache、temp 等安全目录。

## 仍需真实环境

- Diffusers Worker：需要本机安装 `torch`、`diffusers` 和可用模型目录。
- ComfyUI：需要本机 ComfyUI API 在默认或配置端口运行。
- Automatic1111 / Forge：需要 WebUI API 服务运行。
- InvokeAI：需要 InvokeAI API 服务运行。
- 后处理工具：需要配置本机可执行工具或真实工作目录。

## 已修复问题

- 本地部署状态从旧的真假混合状态改为统一状态机。
- 移除本机全端口扫描，避免状态页慢探测和误探测其它本机服务。
- 保留受 `QIGOU_ENABLE_TEST_RENDERER=1` 控制的无 GPU 开发测试渲染器；它不是默认渲染器，也不进入正式包。
- Mock Renderer 任务进入真实数据库任务和底部任务队列。
- Mock Renderer 成功会产生真实 PNG 文件和日志，失败会产生错误日志。
- `/api/local/renderers/*`、`/api/local/jobs/*`、`/api/local/logs`、`/api/local/archive` 已补齐。
- 前端本地部署页新增 Mock 链路验证按钮，按钮不再是空行为。
- 未配置或失败的引擎不能在前端设默认，后端也会拒绝。

## 高风险点

- 真实 Diffusers、ComfyUI、Automatic1111 / Forge、InvokeAI 仍需要目标电脑安装对应服务才能验证真实出图。
- 现有 `backend/tasks/worker.py` 仍是骨架，当前真实消费逻辑在 `task_service.py` 后台线程。
- 任务队列快照是内存结构；刷新后可通过数据库 `/api/tasks` 追踪任务，但进程重启后内存队列快照不会恢复。
- 外部渲染器 Base URL 目前按本地部署安全策略限制为 localhost/127.0.0.1。
