# HavenFrame / 栖构

[中文概览](#中文概览) | [English overview](#english-overview) | [中英双语使用说明 / Bilingual user guide](docs/USER_GUIDE_BILINGUAL.md)

## 界面预览 / Interface previews

| 中文界面 | English interface |
|---|---|
| ![HavenFrame 中文项目工作台](docs/screenshots/desktop-projects-zh.png) | ![HavenFrame English project workspace](docs/screenshots/desktop-projects-en.png) |

两张截图来自同一份生产前端构建和隔离的空白验收数据目录，不包含 API Key、客户资料或历史任务。

Both screenshots come from the same production frontend build and an isolated empty acceptance-data directory. They contain no API keys, customer data, or historical tasks.

## 中文概览

HavenFrame（中文名：栖构）是面向室内设计交付的 Windows 桌面与 Android/iOS 客户端。界面支持简体中文和英文；产品功能、Provider 路由和数据结构不随界面语言改变。

## 功能范围

- 项目与本地归档
- 平面图 2D / 3D 可视化
- 单房间与多房间方案板
- 空间渲染
- 自定义任务与提示词
- 图片生成与多模态元素提取
- 方案板报告与结构化表格导出

桌面和移动端均不提供本地部署、本地模型服务或本地渲染器设置。Windows 安装包包含一个仅监听本机回环地址的 FastAPI sidecar，用于项目、任务、资产和用户自备 Key 的 Provider 调用；它不是可由用户管理的“本地部署”功能。Android/iOS 直接使用本机应用存储和用户配置的 Provider。

## 支持的模型线路

图片生成：

- OpenAI Native API，模型 `gpt-image-2`
- OpenAI-compatible Relay Base URL，模型 `gpt-image-2`
- Google Gemini 图片模型

多模态提取：

- 智谱 GLM（中国大陆）：`https://open.bigmodel.cn/api/paas/v4`
- Z.AI GLM（国际/海外）：`https://api.z.ai/api/paas/v4`
- 经用户配置的 OpenAI-compatible 视觉中转

中国大陆智谱账号和国际 Z.AI 账号使用不同的 Base URL 与 API Key。两条官方线路都通过 Chat Completions 兼容请求结构调用；选择线路时必须使用与账号区域匹配的 Key。

## 工程结构

- `app/`：React + TypeScript + Vite 前端与 Tauri Windows 桌面壳
- `backend/`：FastAPI、SQLite、任务队列及 Provider adapter
- `mobile-expo/`：Android/iOS 共用 React Native 客户端
- `packages/shared-api/`：跨客户端 API contract
- `workspace/`：源码开发环境的本地项目、输出、缓存和临时文件

## 本地开发

后端依赖：

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements.txt
```

桌面开发：

```powershell
cd app
npm ci
npm run desktop:dev
```

开发前端默认使用 `http://127.0.0.1:5173`；桌面 sidecar 默认监听 `127.0.0.1:8010`。生产桌面运行时会验证 sidecar 的 service ID 和 API contract，避免误连其他本地服务。

## 配置与数据

所有 Provider Key 均由用户填写，不随源码或安装包分发：

- Windows：优先使用 DPAPI 保护的本机安全存储
- Android/iOS：使用系统 Keychain/Keystore（Expo SecureStore）

Windows 安装版数据目录：

```text
%LOCALAPPDATA%\com.havenframe.desktop\
```

旧版 `%LOCALAPPDATA%\com.qigou.desktop\` 中已配置且仍受支持的线路会进行一次受控迁移；用户项目和输出不会因卸载自动删除。源码开发数据位于 `backend/data/` 与 `workspace/`，这些目录不得提交。

## 验证

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

这些命令不会调用真实付费 Provider。连接测试与真实图片生成是不同层级：真实生成必须由用户在产品中明确发起，并承担对应 Provider 费用。

## 本地构建策略

Windows 安装包与 Android APK 只允许在受控本机环境构建，不由 GitHub Actions、EAS 或其他云端服务生成：

```powershell
cd app
npm run desktop:build:bundle
```

```powershell
cd mobile-expo
npm run build:android
```

iOS 与 Android 共用移动业务实现；在 Android 真机验收完成且获得明确批准前，不执行 iOS 云构建。

## 安全与发布

- 不提交 `.env`、API Key、数据库、客户素材、输出、签名文件或 keystore。
- 中转地址必须使用可信 HTTPS 服务；中转会收到用户明确选择发送的图片和提示词。
- 生成任务必须进入任务队列，失败不得显示为成功。
- 发布时必须记录 Git commit、构建命令、唯一 artifact 路径、大小、时间和 SHA-256。
- 未实际安装并复现目标场景的 artifact，只能报告为构建/打包成功，不能称为最终验收通过。

详细安全边界见 [SECURITY.md](SECURITY.md)。贡献约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## English overview

HavenFrame is a bilingual Windows, Android, and iOS workspace for interior-design delivery. Chinese and English use the same workflows, Provider routes, task schemas, and local project data.

### Features

- Local projects, archives, and history
- 2D/3D floor-plan visualization
- Single-room and multi-room design boards
- Space rendering with optional reference images
- Reusable custom tasks and prompt management
- Image generation and multimodal item extraction
- A4 client reports and structured procurement-table export

Neither desktop nor mobile exposes local deployment, local-model management, or a local renderer. The Windows application bundles a loopback-only FastAPI sidecar for projects, tasks, assets, and user-configured Provider calls. Android and iOS store data locally and call the Provider routes configured by the user.

### Supported model routes

Image generation:

- OpenAI Native API with `gpt-image-2`
- OpenAI-compatible Relay Base URL with `gpt-image-2`
- Supported Google Gemini image models

Multimodal extraction:

- Zhipu GLM for Mainland China: `https://open.bigmodel.cn/api/paas/v4`
- Z.AI GLM for international accounts: `https://api.z.ai/api/paas/v4`
- An explicitly configured OpenAI-compatible vision relay

Mainland Zhipu and international Z.AI accounts use different Base URLs and API keys. Interface language never changes a route, model ID, endpoint, payload, or user-created project content.

### Development and verification

Use Python 3.12 and Node.js 22. Install backend dependencies from `backend/requirements.txt`, then run `npm ci` in both `app/` and `mobile-expo/`. The repository's source gate is:

```powershell
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

These checks do not call paid Providers. A connection test does not prove that a real image-generation workflow succeeds; a user must explicitly run and pay for any live Provider acceptance test.

Windows installers and Android APKs are built only on an authorized local machine. GitHub Actions validates source but does not publish binary artifacts. iOS cloud build remains blocked until Android real-device acceptance passes and the user explicitly authorizes it.

For setup and workflow instructions, read the [bilingual user guide](docs/USER_GUIDE_BILINGUAL.md). For security boundaries, read [SECURITY.md](SECURITY.md); for contributions, read [CONTRIBUTING.md](CONTRIBUTING.md).

## 开源许可证 / Open-source license

HavenFrame / 栖构的原创源码以 [GNU Affero General Public License v3.0 or later](LICENSE) 发布。修改、分发或通过网络向用户提供修改版时，必须遵守 AGPL 的源码提供义务。第三方组件不因本项目许可证而被重新许可，详情见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

Original HavenFrame source code is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE). Third-party components retain their respective licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
