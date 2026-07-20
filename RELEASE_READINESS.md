# HavenFrame / 栖构 Release Readiness

更新日期：2026-07-20
源码分支：`bilingual-cn-en-20260716`

## 当前结论

**源码公开准备 IN PROGRESS；桌面功能候选已完成人工验收，跨平台二进制发布仍为 NO-GO。**

双语、无本地部署源码的后端测试、桌面生产前端构建、移动类型、平台一致性、运行时模型选择与正式报告检查已有通过记录。用户确认 rc.12 桌面版基本功能满足当前需求。Android `1.1.3-build5` 已从干净提交本地构建，但尚无 ADB 真机验收；iOS 仅完成同源生产 bundle，未进行云构建或真机验收。

## 当前门禁

| 门禁 | 状态 | 证据/限制 |
| --- | --- | --- |
| Git 来源 | IN PROGRESS | 开源准备前基线已由 `havenframe-pre-oss-20260720` 保护；公开快照提交待本轮门禁后建立 |
| 后端 | PASS | 180 passed（2026-07-20 完整源码回归） |
| Desktop TypeScript/i18n/model routing | PASS | 62 个 TS/TSX 文件语言门禁、模型运行时选择和独立工作流检查通过 |
| Desktop production frontend | PASS | Vite production build、release security validation、Cargo `--locked` 检查通过 |
| Tauri host build | PASS | `cargo check` 通过，主窗口 locale 标题权限有效；不是本轮 installer |
| Desktop icon identity | PASS | 6 个实际图标输入与冻结中文版 Git 对象逐字节一致 |
| Mobile TypeScript/i18n/parity | PASS | Android/iOS 共用业务实现，无本地部署链路；运行时选择和正式报告回归通过 |
| Provider connection | PARTIAL LIVE | 用户确认 OpenAI Relay 与 Z.AI 国际 GLM 连接测试通过；不等于所有生成业务通过 |
| Secret scan | PASS | 当前工作区与完整 Git 历史 diff 无高风险项；本机 untracked debug keystore 不进入 Git |
| Desktop dependency audit | PASS | production dependency audit 0 vulnerabilities |
| Mobile dependency audit | RISK | Expo 工具链 10 个 moderate 传递依赖告警；自动 fix 会破坏性降级 Expo，未执行 |
| Open-source legal status | PASS/PENDING REVIEW | 根目录已加入 `AGPL-3.0-or-later` 标准文本；第三方许可边界已记录，发布者仍应做法律复核 |
| Windows rc.12 installer | USER ACCEPTED / UNSIGNED | 用户确认基本功能满足需求；manifest 可追溯，但 installer 未代码签名 |
| Android 1.1.3-build5 | STATE C | 本地 release APK 已生成且来源可追溯；无连接设备，未完成真机 Provider 回归 |
| iOS | NOT AUTHORIZED | Android 验收和用户批准前不云构建 |
| Signing | BLOCKED | Windows/Android/iOS 正式发布签名尚未配置 |

## 进入可交付状态还需要

1. 完成开源元数据提交和公开 `main` 快照，确认 Git 工作树干净。
2. 在公开 `main` 上运行完整本地源码门禁，并让 GitHub Actions 首次通过。
3. 启用 GitHub 私密漏洞报告、secret scanning/push protection 和 Dependabot alerts。
4. 若发布 Windows 二进制，补充目标架构说明；正式公众分发前配置代码签名。
5. 将 Android `1.1.3-build5` 安装到真实设备，验证 GLM 图片提取及 OpenAI 中转生图后再建立移动 release。
6. Android 通过并获得用户批准后，才进入 iOS 构建与真机验收。

## 当前质量评分

- 核心源码质量：**8.1 / 10**
- 开源准备度：**8.0 / 10**（本地准备；公共 CI 与仓库安全设置必须在创建远端后验证）
- 桌面功能候选：**用户人工验收通过，未签名**
- Android：**State C**
- iOS：**源码/生产 bundle 验证，未构建真机包**

评分细节见 `docs/QUALITY_SCORE_20260716.md`。历史 rc 和旧数据目录的验收证据保留在 `docs/`，但不得冒充当前源码产物。
