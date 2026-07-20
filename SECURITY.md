# Security Policy / 安全策略

## Supported scope / 支持范围

This public repository covers the HavenFrame Windows desktop application only. Android and iOS clients are outside this repository's open-source scope.

本公开仓库只覆盖 HavenFrame Windows 桌面版。Android 与 iOS 客户端不属于本仓库开源范围。

## Data and credential boundaries / 数据与凭据边界

- HavenFrame is a bring-your-own-key application. No Provider key is distributed with the source or installer.
- Windows credentials are stored using protected local storage; plaintext keys must not enter Git, logs, task snapshots, exports, or error messages.
- Application data is stored under `%LOCALAPPDATA%\com.havenframe.desktop\` in packaged builds.
- The bundled FastAPI sidecar listens only on `127.0.0.1:8010` and validates the expected service identity and API contract.
- Official Providers and user-configured HTTPS relays receive the images, prompts, and parameters explicitly selected by the user.
- 栖构采用用户自备 Key，不随源码或安装包分发 Provider Key。
- Windows 凭据使用系统保护的本机存储；明文 Key 不得进入 Git、日志、任务快照、导出或错误信息。
- 安装版数据位于 `%LOCALAPPDATA%\com.havenframe.desktop\`。
- 内嵌 FastAPI sidecar 只监听 `127.0.0.1:8010`，并校验 service identity 与 API contract。
- 官方 Provider 与用户配置的 HTTPS 中转会收到用户明确选择发送的图片、提示词和参数。

## Reporting a vulnerability / 报告安全问题

Do not include API keys, customer materials, private endpoints, or exploitable details in a public issue. Use GitHub private vulnerability reporting when available.

请勿在公开 Issue 中提交 API Key、客户素材、私有 endpoint 或可直接利用的细节。条件允许时使用 GitHub 私密漏洞报告。

Include the affected commit/version, Windows architecture, reproducible steps, expected and actual behavior, and whether the issue affects credential storage, file access, network requests, or task isolation.

请提供受影响 commit/版本、Windows 架构、可复现步骤、预期与实际行为，并说明是否影响凭据存储、文件访问、网络请求或任务隔离。

## Verification / 验证

```powershell
python scripts/secret_scan.py
python scripts/pre-release-check.py
```

CI validates source only and does not publish Windows installers. A packaged release is accepted only after the exact artifact is identified by SHA-256 and tested through the relevant installed-application workflow.

CI 只验证源码，不发布 Windows 安装包。正式候选必须记录确切 artifact 的 SHA-256，并通过对应安装版业务流程后才能验收。
