# 栖构发布前代码库审计（历史基线）

> 本文记录 2026-07-10 审计时的仓库状态，不代表 2026-07-17 双语无本地部署分支的当前能力。当前平台边界、Provider 路线和发布状态以 `ARCHITECTURE.md`、`PLATFORM_FEATURE_MATRIX.md`、`API_PROVIDER_MATRIX.md` 与 `RELEASE_READINESS.md` 为准。

审计日期：2026-07-10

审计基线：`master` / `1abaa91b489cfaf9da7df5b44a48c302e62a84b4`

恢复点：Git tag `pre-release-audit-head-20260710`；stash `pre-release-audit-baseline-2026-07-10`。审计开始时工作树已有 116 个 tracked 文件修改和大量未跟踪实现，本次工作先建立恢复点，再在现状上修复，未删除 `workspace/` 用户数据。

## 1. 架构与入口

```text
Windows Desktop
  app/src/main.tsx -> React 18 / TypeScript / Vite / Zustand
  app/src-tauri/src/main.rs -> Tauri 2 -> loopback FastAPI sidecar

Android / iOS
  mobile-expo/index.ts -> App.tsx -> React Native / Expo SDK 56
  -> explicitly configured HTTPS cloud FastAPI
  -> no local deployment imports, initialization, polling, cache or fallback

FastAPI
  backend/main.py -> route -> Pydantic schema -> service -> adapter/persistence
  -> SQLite + workspace permanent assets/exports + persisted Task

Contract
  packages/shared-api/endpoints.json + MOBILE_ENDPOINTS.md
```

| 应用 | 入口 | 构建/运行入口 | 结论 |
| --- | --- | --- | --- |
| Desktop Web | `app/src/main.tsx` | `npm run build` | Tauri 内嵌前端，也是本地 Web 开发入口 |
| Windows shell | `app/src-tauri/src/main.rs` | `cargo check`, `tauri build` | 启动/监管 loopback sidecar |
| Android | `mobile-expo/index.ts` | 本地 Metro export / Gradle | 与 iOS 共用移动业务入口 |
| iOS | `mobile-expo/index.ts` | 本地 iOS bundle；云构建需用户另行批准 | 与 Android 共用 API、状态、图片和模型代码 |
| Backend | `backend/main.py` | uvicorn | desktop/cloud profile 共用业务层 |
| Windows sidecar | `backend/sidecar_entry.py` | PyInstaller | 强制 loopback host |

旧 `mobile-ios/` 是缺少源文件、带英文主仓命名并初始化本地部署的重复 Xcode 工程，已确认不可构建后删除。`mobile-expo/` 是 Android/iOS 唯一移动实现。

## 2. Monorepo 与共享边界

- `app/`：Windows 桌面 React/Tauri；可访问桌面本地部署 API。
- `backend/`：FastAPI、SQLAlchemy、provider adapter、任务和文件持久化。
- `mobile-expo/`：Android/iOS 共用 UI、API client、SecureStore 与平台能力。
- `packages/shared-api/`：跨客户端 endpoint 清单；不承载 provider 逻辑。
- `scripts/`：本地构建、sidecar、secret scan、安装包与 release gate。
- `workspace/`：项目、输出、日志、缓存和临时文件；被 Git 忽略且未清理。
- `assets/`：品牌源资产。
- `build/`、`app/dist/`、native build 目录：生成物，被 Git 忽略。

没有 npm workspace 根配置；共享关系是 REST contract，不是运行时跨平台源码导入。移动端没有导入 `app/` 或 backend local runtime 模块。

## 3. 状态、数据库与文件系统

前端状态使用 Zustand。项目、素材、任务、提示词、自定义模板、模型配置和方案板的持久化真相位于后端，不再以 mock store 作为断网 fallback。

SQLite 表：

- `projects`
- `assets`
- `tasks`
- `prompt_templates`
- `model_configs`
- `module_model_preferences`
- `custom_task_templates`
- `exports`
- `extracted_items`
- `board_documents`
- `project_versions`

源码模式默认使用 `backend/data/` 与 `workspace/`；安装版由 `QIGOU_APP_DATA_DIR` 重定向到用户 AppData。上传文件只写入受控 project asset 目录；生成图和导出只写入 permanent outputs。Asset metadata 保存 workspace-relative `storage_key`，绝对路径失效后可从当前 workspace 恢复。

任务数据库是持久化真相，进程内 queue 只用于实时快照。所有 AI 生图和 GLM 提取先建立 Task；只有 provider response 校验、永久文件写入、Asset/ExtractedItem 数据提交完成后才标记 `success`。重启后超时遗留任务被明确标记失败，不伪造恢复成功。

## 4. Provider 与模型来源

运行选择的可信来源顺序：

1. 显式 `provider_config_id`（必须存在且能力匹配，否则拒绝）
2. 独立的 module preference
3. SQLite provider config
4. 服务端环境变量中的 secret/Base URL
5. `backend/core/model_registry.py` 的内置元数据

图片生成 workflow 白名单：

- OpenAI Native / `gpt-image-2`
- OpenAI Relay / `gpt-image-2`
- Google Gemini image：`gemini-2.5-flash-image`、`gemini-3-pro-image-preview`、`gemini-3.1-flash-image-preview`

信息提取独立使用 Zhipu GLM / `glm-4.5v`，或显式配置的 GLM OpenAI-compatible relay。`generationProvider/generationModel` 与 `extractionProvider/extractionModel` 使用不同 preference、UI slot、runtime resolver 和任务快照；不允许图片模型被静默改成提取模型，也不允许无效配置静默回退到别的生图 provider。

真实 adapter：

- `backend/adapters/openai_image_generation.py`
- `backend/adapters/gemini_image_generation.py`
- `backend/adapters/glm_item_extraction.py`
- `backend/adapters/model_connectivity.py`

Jimeng/Volcengine 和 ComfyUI 仍按项目规范保留在 registry/设置层；普通图片工作流不展示不可运行线路。ComfyUI 仅是 Windows 可选本地服务。开发测试渲染器仅在 `QIGOU_ENABLE_TEST_RENDERER=1` 时暴露，正式包验证显式断言它不存在。

## 5. AI、方案板、图片和导出链路

```text
Image generation
UI selection -> POST /api/tasks/provider-image -> strict runtime resolution
-> OpenAI/Gemini adapter -> MIME/signature/size validation
-> permanent output -> Asset + Task runtime snapshot -> authenticated content URL

Information extraction
single/multi extraction slot -> POST /api/workflows/softboard/extract-items
-> strict GLM runtime -> /chat/completions -> structured JSON validation
-> ExtractedItem + extraction Task snapshot -> board/quote/table

Board delivery
ExtractedItem -> deterministic BoardDocument composer -> SVG preview Asset
-> report export embeds persisted board SVG -> UTF-8 SVG
-> table export reads persisted ExtractedItem -> UTF-8 BOM CSV
```

多房间必须先完成各素材提取；预算来自保存的 `price_min/price_max`，不再使用固定金额/固定房间数。composer 的 provider/model 明确记录为本地结构化 composer，不冒充页面所选云端图片模型。

旧 PDF export route/schema/service/test/contract 已删除。PDF 仍可作为受签名检查的上传资料类型，并可用于 registry 所声明的文档输入能力；它不再是单/多房间交付格式。

图片 UI 使用 Asset abstraction，不猜 `file://` 或 Windows 路径。Desktop 读取 loopback content endpoint；Mobile 使用 HTTPS content endpoint 和相同 bearer header。Cloud response 将 Asset/Export 的绝对 `file_path` 替换为 content path；项目 archive path 也不返回移动端。

## 6. 环境变量

仓库只记录变量名，不提交或输出 secret 值。

| 类别 | 变量 |
| --- | --- |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_RELAY_BASE_URL`, `OPENAI_RELAY_API_KEY`, `OPENAI_RELAY_MODEL` |
| Gemini | `GEMINI_API_KEY`, `GEMINI_RELAY_BASE_URL`, `GEMINI_RELAY_API_KEY` |
| GLM | `ZHIPU_API_KEY` |
| Volcengine | `ARK_API_KEY`, `VOLCENGINE_ACCESS_KEY_ID`, `VOLCENGINE_SECRET_ACCESS_KEY`, `VOLCENGINE_REGION`, legacy `JIMENG_ACCESS_KEY/JIMENG_SECRET_KEY` |
| Custom | `CUSTOM_REST_BASE_URL`, `CUSTOM_REST_API_KEY` |
| Desktop local | `COMFYUI_BASE_URL`, `QIGOU_APP_DATA_DIR`, `QIGOU_DATA_DIR`, `QIGOU_WORKSPACE_DIR`, `QIGOU_API_HOST`, `QIGOU_API_PORT`, `QIGOU_LOCAL_API_TOKEN`, `QIGOU_LOCAL_API_TOKEN_PATH` |
| Cloud API | `QIGOU_API_PROFILE=cloud`, `QIGOU_ALLOWED_HOSTS`, `QIGOU_ALLOWED_ORIGINS`, `QIGOU_CLOUD_BEARER_TOKENS` |
| Limits/tests | `QIGOU_MAX_GENERATED_IMAGE_BYTES`, upload/task limit vars, `QIGOU_ENABLE_TEST_RENDERER`, `LIVE_COSTLY_MODEL_TESTS`, `LIVE_MOBILE_MODEL_TESTS`, `LIVE_GLM_EXTRACTION_TESTS`, timeouts |
| Expo compile-time | `EXPO_PUBLIC_QIGOU_ENVIRONMENT`, common/Android/iOS `EXPO_PUBLIC_QIGOU_*_API_BASE_URL` |

移动 Base URL 没有默认值：缺失显示“移动端云端 API 未配置”；保留示例域名被拒绝；preview/production 只接受 HTTPS。Android/iOS access token 由 SecureStore 保存，不能放入 `EXPO_PUBLIC_*` bundle。

## 7. API endpoint

公共 desktop/cloud：

- health/platform/security：`GET /health`, `/api/platform/capabilities`, `/api/security/session`, `/api/security/diagnosis`
- projects：`GET|POST /api/projects`, `GET|PATCH|DELETE /api/projects/{id}`, review/versions/replay
- assets：upload/list/detail/content/delete/duplicate
- tasks：list/detail/result、`POST /api/tasks/provider-image`、cancel、retry
- prompts：list/create/update/delete/clone
- models：registry/providers/mobile-image-routes/module-preferences/capabilities/test/test-all/key clear
- softboard：extract/list/update items、single-room、multi-room、quote、documents
- floorplan/space-render：只返回真实可执行 route/config，不保留假 queued workflow
- custom tasks：template CRUD；无假 `/run`
- exports：image/report-image/table/list/content

Desktop profile 才注册：project/asset/export open-file/open-folder、`/api/local/*`、`/api/render-engines/*` 和 task WebSocket。Cloud profile 不注册本地部署、renderer 或打开本机路径的 route，并禁用 WebSocket local queue。

## 8. 本地部署

本地逻辑集中在 `backend/services/runtime_service.py`、local/render-engine route、Tauri sidecar 与 `LocalDeployPage`。移动端源码扫描只有 `localDeployment: false` 能力声明，无 local API client、localhost fallback、local warning、polling、cache、环境变量或初始化逻辑。

桌面 loopback API 使用 Host/Origin/local token 校验。Cloud profile 使用允许 Host/Origin 和 bearer token；若服务端没有配置认证会返回 503，而不是假连接成功。

## 9. 测试与构建体系

- Python：pytest 单元/集成测试覆盖 route、provider request/parser、GLM schema、security matrix、asset recovery、export、task retry/dedup、platform profile。
- Desktop：TypeScript、两个静态契约测试、Vite production build、Cargo check、Tauri/sidecar 本地构建脚本。
- Mobile：TypeScript、平台隔离/共用实现契约、本地 JS bundle；Android 额外使用本地 Gradle APK 构建。自动门禁不运行 iOS 云构建。
- Release：`pre-release-check.py`, `secret_scan.py`, installed-package validation。
- 云端 CI build：按发布要求不启用；Windows Desktop 与 Android 必须本地构建，iOS 云构建需用户在 Android 验收后另行批准。

付费 provider 自动测试被禁止。live scripts 必须同时具备显式 opt-in、真实 Key 和用户拥有的测试素材；缺一项即报告 blocked，不返回 mock success。

## 10. 问题分级与结果

### P0

| 问题 | 根因 | 修复结果 |
| --- | --- | --- |
| 移动首屏使用 `api.qigou.example.com` | 默认假域名 | 删除默认；构建变量缺失/示例值 fail closed |
| iOS 初始化 localhost/local deployment | 破损重复 Swift 工程 | 删除 legacy 工程；iOS 统一使用 mobile-expo |
| Mobile 与 desktop security 不兼容 | backend 只有 loopback security | 新增 cloud profile、bearer/Host/Origin 配置 |
| GLM 被 generation 模型污染 | 共用模糊模型 fallback | 分离 extraction preference/runtime/snapshot；只接受 GLM |
| 多房间固定预算/房间数 | service skeleton 硬编码 | 改为真实提取项聚合，缺数据即失败 |
| 假 cloud adapter、mock stores、fake workflow route | 历史 skeleton | 删除；提示词/自定义模板改真实 API 持久化 |
| 显式模型失效时静默换模型 | 通用 selection fallback | generation/extraction 显式选择必须精确匹配 |
| 移动导出固定章节假报告 | report API 允许无 board | report 强制真实 BoardDocument ids |

### P1

| 问题 | 修复结果 |
| --- | --- |
| 图片重启/迁移后绝对路径失效 | 增加 storage key 和受控自愈解析 |
| 云端认证图片无法显示 | content URL + bearer header；不返回本地路径 |
| provider URL 图片 SSRF/MIME 风险 | HTTPS、DNS/IP、redirect、MIME、signature、size 校验 |
| PDF 交付死链 | 删除，新增真实方案板 SVG 和结构化 CSV |
| task retry 只改 queued 不执行 | 仅支持可重放 provider task，并重启真实 worker |
| replay 固定 done | 按 task/output asset 事实推导，跨项目 task 返回 404 |
| 错误统一泛化 | task/error 分 config/auth/network/timeout/rate/provider/parser/file/database |
| Android Gradle 中文项目名乱码 | JVM 默认 GBK | config plugin 固化 UTF-8；重新 prebuild 后 `gradlew help` 通过 |
| ARM64 Windows 安装包误标 x64 | Tauri CLI 继承 x64 Node 架构 | 从 `rustc` 读取并显式传入 target；输出 ARM64 NSIS |
| 安装验证可误连已有 8000 服务 | 只检查通用 `/health` | 端口已占用直接拒绝，并断言恰有一个安装 sidecar |

### P2/P3

- 删除 unused worker、old workflows、cloud mock adapter、old Comfy adapter、mock data 和演示标签。
- 仍保留大体积 `ModelSettingsPage`、`LocalDeployPage`，后续可按 domain component 拆分；当前不为重构而改视觉。
- SVG 使用 Microsoft YaHei/Noto Sans CJK fallback，但未嵌入字体；不同客户机字体度量仍是残余风险。
- SQLite 暂无正式迁移框架；本次不做破坏性字段删除。

## 11. URL、debug、secret、编码审计

- 移动运行代码无 `example.com`、localhost、127.0.0.1、ComfyUI、mock 或本地部署引用。
- Desktop 中 loopback 地址和本地 renderer 端口属于平台限定配置；官方 provider endpoint 集中在 registry/service。
- 示例 relay 文档域名改为组织自有占位命名，测试中的 RFC/`.test` 域名只用于 URL policy。
- 未发现生产前端 `console.log/debugger`；保留 CLI `print` 作为命令输出。
- secret scan 不读取值到报告；`.env*`、数据库、workspace、签名、keystore、模型和输出均被 ignore。
- JSON/SVG 使用 UTF-8 与 `ensure_ascii=False`；CSV 使用 `utf-8-sig`；HTTP 使用正确 MIME。中文数据库/API/export 往返有自动测试。
- Android Gradle JVM 使用 UTF-8；Manifest 移除未使用的录音、悬浮窗和写外部存储权限。

## 12. 删除与保留

已删除项和引用证据见 `DELETION_REVIEW.md`。保留 `workspace/`、数据库旧字段、Windows local runtime、可选 ComfyUI、Provider registry 中规范要求的 Jimeng/Volcengine 元数据。任何尚不能证明无引用的代码列入删除复核，不盲删。
