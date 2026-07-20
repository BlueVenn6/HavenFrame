# 栖构代码与 Git 清理报告（历史基线）

> 本文保留 2026-07-10 的清理记录。此后双语无本地部署分支继续删除了桌面本地部署页面、local renderer 产品能力和普通工作流中的不可运行路线；当前边界以 `PLATFORM_FEATURE_MATRIX.md` 和 `RELEASE_READINESS.md` 为准。

更新日期：2026-07-10

## 已删除

- 删除未接入真实任务系统的 cloud mock/stub adapters，以及 `mock-data.ts` 演示数据入口。
- 删除旧 `openai_item_extraction.py`，统一使用 GLM 结构化信息提取 adapter。
- 删除只有占位函数的 `backend/workflows/*`、旧 worker 和未使用 workflow schema。
- 删除重复且已漂移的 Swift `mobile-ios/`；Android/iOS 统一由 `mobile-expo/` 共用 App、API client、Asset 和模型逻辑。
- 删除移动端运行时的桌面 archive path、本地部署、本地服务检测、localhost fallback 和相关状态。
- 删除确认无依赖的方案板 PDF 导出链路。PDF 仍可作为经过 MIME/大小校验的用户输入资料，不再作为交付格式。
- 删除自动云构建 workflow；Windows 和 Android 发布构建只允许本地执行。

## 已整理

- `.gitignore` 覆盖 workspace、数据库、日志、缓存、构建产物、模型文件、API Key、Android/Apple 签名文件和本地 IDE 状态。
- API Key 从配置响应、任务快照、日志和错误中隔离，服务端使用 secure store；移动云 token 使用 SecureStore。
- 图片路径收敛为 Asset/Export content endpoint，客户端不再猜测 Windows 路径或持久化 `file://`。
- 自定义任务、提示词和项目 store 从演示数据切换为真实后端 API。
- 输出图库不再展示历史 `demo_generation`；历史数据库记录未破坏性删除。
- Android Gradle 编码固定为 UTF-8，并移除录音、悬浮窗和写外部存储权限。
- Windows 本地构建显式使用 Rust target，避免 ARM64 主程序被误标为 x64 安装包。
- 保留开发专用 `mock_renderer_adapter.py`，但它必须显式设置 `QIGOU_ENABLE_TEST_RENDERER=1`，发布安装包校验其不可用，且不会冒充 AI Provider。

## 保留并说明

- ComfyUI Local 作为 Windows 可选 Provider 保留，不是本地部署必要条件，也不会进入移动端。
- Jimeng/Volcengine registry 元数据按仓库产品约束保留，但不出现在当前普通图片工作流可执行白名单。
- `eas.json` 仅保留未来 iOS 明确授权后的构建配置；本次未运行 EAS 或其他云构建命令。
- `workspace/` 为用户数据，未删除、未清空、未纳入 Git。

## 待人工删除评审

无法从静态引用安全确认的历史能力列在 `DELETION_REVIEW.md`。本轮没有删除 workspace、数据库用户记录、模型缓存或任何不可恢复的用户数据。

## Git 基线

- 审计前 HEAD 已建立 tag：`pre-release-audit-head-20260710`。
- 审计前工作树已保存为 `stash@{0}: pre-release-audit-baseline-2026-07-10` 并重新应用。
- 基线文档提交：`846fab0 docs: establish pre-release audit baseline`。
- 平台隔离：`7f8cf1f feat: isolate mobile cloud runtime from desktop capabilities`。
- Provider 分离：`2960e86 refactor: separate image generation from GLM extraction`。
- 业务持久化：`dc5fc62 feat: harden task assets boards and exports`。
- Windows 本地发布：`2f1e893 build: package and validate the local Windows runtime`。
- 最终审计文档、依赖和 release gate 由独立提交收尾；提交后再次运行 `git status --short` 与 secret scan。
