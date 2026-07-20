# Contributing / 贡献指南

## English

This repository contains the HavenFrame Windows desktop application only. Do not add or request Android/iOS source in this repository.

Changes must preserve the bilingual React, Tauri, FastAPI, and SQLite architecture. Keep Provider-specific logic in adapters/services, keep generation in the task queue, and do not add local-deployment or local-model-management product features.

Before opening a pull request:

```powershell
python scripts/pre-release-check.py
```

Do not commit API keys, customer assets, databases, outputs, logs, signing material, generated sidecars, installers, or machine-specific paths. Automated checks must not call paid Providers or weaken assertions to hide failures.

Pull-request CI validates source only. Windows installers are built and validated on an authorized local machine. Release evidence must identify the exact source commit, command, artifact path, size, timestamp, and SHA-256.

## 中文

本仓库只包含 HavenFrame Windows 桌面版。请勿在本仓库加入或索取 Android/iOS 源码。

修改必须保持中英双语 React、Tauri、FastAPI 和 SQLite 架构。Provider 专属逻辑应位于 adapter/service 层，生成动作必须进入任务队列，不得加入本地部署或本地模型管理产品功能。

提交 Pull Request 前运行：

```powershell
python scripts/pre-release-check.py
```

不得提交 API Key、客户素材、数据库、输出、日志、签名材料、生成的 sidecar、安装包或本机路径。自动检查不得调用付费 Provider，也不得弱化断言掩盖失败。

Pull Request CI 只验证源码。Windows 安装包只能在授权本机完成构建和验收。发布证据必须记录确切源码 commit、命令、artifact 路径、大小、时间和 SHA-256。
