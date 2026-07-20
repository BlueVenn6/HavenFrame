# Security Policy / 安全说明

## 数据边界

HavenFrame / 栖构是用户自备 API Key 的室内设计工作台。Windows 桌面版将项目、任务、资产和输出保存在 `%LOCALAPPDATA%\com.havenframe.desktop\`；Android/iOS 使用各自应用沙盒。用户选择官方 Provider 或 HTTPS 中转后，所选图片、提示词和任务参数会发送到该服务。

## 本机后端

- Windows sidecar 仅监听 `127.0.0.1:8010`。
- 前端会校验后端 service ID、API contract、本机 session token、Host 和 Origin。
- sidecar 不应监听 `0.0.0.0`，也不应直接暴露到公网或不可信局域网。
- 产品不包含本地部署、本地模型服务或本地渲染器管理界面。

## API Key

- Windows 优先使用 DPAPI；Android/iOS 使用系统 Keychain/Keystore。
- Key 不得进入任务快照、日志、错误信息、前端 bundle 或 Git。
- 安装包不预置用户 Key、中转地址或可用账号。
- 模型设置页允许保存、替换和清除 Key。

## Provider 路由

- 图片生成仅允许 OpenAI `gpt-image-2`（原生或兼容中转）和受支持的 Google Gemini 图片模型。
- GLM 多模态提取区分中国大陆智谱与国际 Z.AI，两者的 Base URL 和 Key 不通用。
- 自定义中转必须使用 HTTPS；禁止在 URL query 中携带 `key`、`api_key`、`token`、`access_token` 或 `authorization`。
- 中转失败不会静默改发官方服务，除非产品明确提供并由用户选择该行为。
- 外部数据发送前要求明确的数据流确认。

## 客户素材

- 上传客户照片、户型图或文档前，应确认拥有处理和发送权限。
- 分享日志或提交 issue 前，应移除 API Key、客户素材、完整本地路径和数据库。
- 不要上传可执行文件、脚本、压缩包、签名文件或密钥文件作为设计素材。

## 发布与签名

- Windows installer、Android APK/AAB 和 iOS 包必须使用独立发布身份与可追溯版本号。
- 正式对外分发前应配置受控签名证书；未签名 Windows 包会触发未知发布者提示，debug 签名 Android 包不属于正式生产发布包。
- CI 只做源码验证，不生成或发布 Windows installer、Android APK/AAB 或 iOS artifact。
- 每个最终 artifact 必须记录源码 commit、构建时间、绝对路径、大小和 SHA-256，并尽可能在干净环境安装验证。

## 漏洞报告

不要在公开 issue 中提交真实 API Key、客户图片、数据库、完整日志或可复用访问凭据。公开仓库启用后，请通过 GitHub Security 页面的 **Report a vulnerability** 私密提交安全问题，并提供最小复现步骤、影响范围、版本号和已脱敏证据。仓库维护者必须在首次公开前启用 GitHub Private vulnerability reporting。

## 发布前检查

```powershell
python scripts/secret_scan.py --json
python scripts/pre-release-check.py --skip-heavy
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

以上不等于最终 artifact 验收。正式发布仍需对本地构建的确切安装包执行安装、启动和原始业务场景验证。

---

## English summary

HavenFrame is a bring-your-own-key application. Never include API keys, relay credentials, customer assets, databases, full logs, signing material, or local user paths in a public issue or commit.

- Windows stores application data under `%LOCALAPPDATA%\com.havenframe.desktop\`; Android and iOS use their application sandboxes.
- The Windows sidecar listens only on `127.0.0.1:8010` and validates its service identity, API contract, local session token, Host, and Origin.
- Windows uses protected local credential storage; Android and iOS use the system Keychain/Keystore.
- Image generation is limited to OpenAI `gpt-image-2` native/compatible relay routes and supported Google Gemini image models.
- Multimodal extraction distinguishes Zhipu GLM for Mainland China, Z.AI international accounts, and an explicitly configured compatible vision relay.
- A relay receives the images, prompts, and parameters the user explicitly submits. Use only a trusted HTTPS relay.
- CI validates source only. It does not build or publish Windows, Android, or iOS artifacts.

Report security issues privately through GitHub **Report a vulnerability** after private vulnerability reporting is enabled. Provide a minimal reproduction, affected version, impact, and redacted evidence. Passing source checks, building a package, and validating an installed artifact are separate states; every released binary must be tied to an exact source commit and SHA-256 and tested through the original user workflow before it is called accepted.
