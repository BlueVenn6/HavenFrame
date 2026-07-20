# Contributing

## Scope

Changes must preserve the bilingual HavenFrame / 栖构 product boundary and the existing React, Tauri, FastAPI, SQLite and React Native stack. Do not add local deployment, local model management or unrelated media workflows.

By contributing, you agree that your contribution is licensed under the repository's `AGPL-3.0-or-later` license. Do not submit code you do not have the right to license.

## Before changing code

1. Read `AGENTS.md`, `docs/PROJECT_SPEC.md` and `docs/CODEX_RULES.md`.
2. Check `git status` and preserve unrelated work.
3. Identify the actual desktop, mobile and backend call paths affected by the change.
4. Never commit API keys, customer assets, databases, generated outputs or signing material.

## Required verification

Run the checks relevant to the changed area. A normal cross-platform change should include:

```powershell
python -m pytest backend/tests -q
cd app
npm run typecheck
npm run test:i18n
npm run test:model-routing
npm run build
cd ..\mobile-expo
npm run typecheck
npm run test:i18n
npm run test:platform-parity
```

Automated tests must not make paid Provider calls. Do not weaken assertions to hide a real failure.

## Release artifacts

Windows and Android release artifacts are built only on an authorized local machine. Pull-request CI validates source but does not publish installers or mobile packages. A release report must identify the exact source commit, command, artifact path and SHA-256. Packaging success alone is not final acceptance.

## Language changes

Every fixed UI string must have both Chinese and English text. Do not translate user-created project names, prompts, extracted content or historical records. Model IDs, endpoint paths and API payload values are protocol data and must not be localized.

---

## 中文贡献说明

提交必须保持 HavenFrame / 栖构现有的中英双语产品边界，以及 React、Tauri、FastAPI、SQLite 和 React Native 技术栈。不要加入本地部署、本地模型管理或无关媒体工作流。

贡献即表示你同意以仓库的 `AGPL-3.0-or-later` 许可证提供该贡献；不要提交无权许可的代码。修改前请阅读 `AGENTS.md`、`docs/PROJECT_SPEC.md` 和 `docs/CODEX_RULES.md`，检查 Git 状态，并确认真实桌面/移动/后端调用链。

不得提交 API Key、客户素材、数据库、输出、日志、签名文件或本机路径。自动测试不得调用付费 Provider，也不得弱化断言来掩盖真实错误。Windows 与 Android 产物只能在授权本机生成；拉取请求 CI 不发布二进制。发布说明必须记录确切源码提交、构建命令、产物路径和 SHA-256。

新增或修改固定 UI 文本时必须同时维护中文和英文；不得翻译用户创建的项目名、提示词、提取内容或历史记录。模型 ID、endpoint 和 API payload 属于协议数据，禁止本地化。
