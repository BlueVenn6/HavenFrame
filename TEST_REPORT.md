# HavenFrame / 栖构测试报告

更新日期：2026-07-20

## 当前源码验证

| 范围 | 结果 |
| --- | --- |
| 后端全量 | 180 passed（2026-07-20 完整源码回归） |
| 后端模型/GLM/迁移重点回归 | 80 passed |
| Desktop TypeScript | PASS |
| Desktop i18n JSX / brand / dialog / native title gate | PASS，62 files |
| Desktop model routing | PASS |
| Desktop production frontend | PASS；release security validation PASS |
| Desktop dependency audit | PASS；0 vulnerabilities |
| Tauri Windows host compile | PASS；主窗口双语标题权限已通过 `cargo check` |
| Mobile TypeScript | PASS |
| Mobile i18n/native metadata | PASS |
| Mobile platform parity | PASS |
| Mobile runtime model selection | PASS；只选择已保存凭据且兼容的出图/提取线路 |
| Mobile formal report | PASS；中英文与无 GLM/无生成图的独立报告场景覆盖 |
| Mobile connectivity/provider errors | PASS；不把可达性当真实模型成功，保留 HTTP gateway 与设备 DNS 根因 |
| Mobile dependency audit | 高危阈值 PASS；10 个 Expo 工具链 moderate 传递告警，强制修复会破坏性降级 Expo |
| Python dependency check | PASS |
| Desktop production dependency audit | 0 vulnerabilities |
| Tauri Rust source | `cargo check --locked` PASS |
| Secret/release static gate | PASS；当前工作区与完整 Git 历史 diff 无 high-risk secret |

## Live 证据

- 用户于 2026-07-17 在真实界面确认 OpenAI Relay Test Connection 通过。
- 用户于 2026-07-17 在真实界面确认 Z.AI 国际 GLM Test Connection 通过。
- 历史人工验收中 OpenAI Relay 图片任务和智谱中国大陆 GLM 提取曾成功落盘；历史结果只证明当时配置，不替代当前最终 artifact 验收。
- 本轮未由自动化脚本调用任何付费 Provider。

## 尚未验证

- 本轮开源元数据提交后的完整源码门禁与公开 GitHub Actions 首次运行。
- Windows rc.12 未配置正式代码签名；用户人工验收不替代全新外部 Windows 环境兼容性测试。
- OpenAI Native 和 Google Gemini 当前账号的真实输出。
- Android `1.1.3-build5` 的真机启动、GLM 图片提取、OpenAI 中转生成、历史和下载。
- iOS 原生运行或云构建；当前未获授权。
- Windows/Android/iOS 正式签名发布链。

## 当前等级

桌面 rc.12：用户确认基本功能满足需求，但公众二进制仍未签名。Android：**State C**。iOS：仅完成共享源码与本地生产 bundle 验证。开源源码快照必须在本轮元数据门禁完成后另行冻结。
