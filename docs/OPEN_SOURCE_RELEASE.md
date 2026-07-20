# 桌面版开源发布 / Desktop Open-source Release

## 范围 / Scope

本公开仓库只包含 HavenFrame Windows 桌面版、内嵌 FastAPI sidecar 源码以及桌面构建和验收工具。Android/iOS 客户端不包含在本仓库中，也不属于本次 AGPL 源码发布范围。

This public repository contains only the HavenFrame Windows desktop application, the bundled FastAPI sidecar source, and desktop build/acceptance tooling. Android/iOS clients are not included in this repository or this AGPL source release.

## 许可证 / License

原创桌面源码使用 `AGPL-3.0-or-later`。第三方依赖保留各自许可证，权威依赖清单位于：

- `app/package-lock.json`
- `app/src-tauri/Cargo.lock`
- `backend/requirements.txt`

Original desktop source is licensed under `AGPL-3.0-or-later`. Third-party dependencies retain their respective licenses.

## 不提交内容 / Excluded content

- API Key、`.env` 和私有 endpoint
- 客户素材、数据库、workspace、输出和日志
- 生成的 sidecar、安装包和缓存
- Windows 签名材料
- Android/iOS 源码、构建配置、签名材料和二进制

- API keys, `.env` files, and private endpoints
- Customer assets, databases, workspaces, outputs, and logs
- Generated sidecars, installers, and caches
- Windows signing material
- Android/iOS source, build configuration, signing material, and binaries

## 发布验证 / Release verification

GitHub Actions 只验证桌面源码，不生成安装包。正式 Windows 候选必须在授权本机从确切 commit 构建，记录 artifact 路径、大小、时间和 SHA-256，并实际安装后复现目标业务流程。

GitHub Actions validates desktop source only and does not build installers. A Windows release candidate must be built locally from an exact commit, recorded with its artifact path, size, timestamp, and SHA-256, and validated through the relevant installed-application workflow.
