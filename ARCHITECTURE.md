# HavenFrame / 栖构工程架构

## 平台结构

```text
Windows Desktop                         Android / iOS
Tauri + React                           shared React Native client
       |                                        |
loopback FastAPI sidecar                direct BYOK Provider calls
SQLite + task queue + assets            app sandbox persistence
DPAPI secrets                           SecureStore secrets
       |                                        |
OpenAI / Relay / Gemini / GLM adapters and normalized workflow contracts
```

三个平台均无本地部署、本地模型服务或本地 renderer 产品能力。Windows sidecar 仅是桌面应用内部的数据、队列、文件和 Provider 代理基础设施；Android/iOS 不导入 sidecar、localhost 探测或桌面能力状态。

## 目录职责

| 目录 | 职责 | 禁止事项 |
| --- | --- | --- |
| `app/src` | Desktop UI、状态、统一 API client、i18n | 拼 Provider payload、直接猜文件路径 |
| `app/src-tauri` | Windows shell、sidecar 生命周期、bundle | Provider 业务逻辑 |
| `mobile-expo` | Android/iOS UI、本机 runtime、SecureStore、i18n | 本地部署、localhost fallback、内置 secret |
| `backend/api` | route、schema、错误映射 | Provider-specific payload |
| `backend/services` | domain、持久化、runtime resolution | 假成功或错误吞噬 |
| `backend/adapters` | Provider 请求/响应归一化 | 页面状态逻辑 |
| `backend/core` | capability、安全、URL、文件策略 | 页面业务分支 |
| `packages/shared-api` | 跨客户端 contract | Provider implementation |

## 模型能力分离

```text
Image generation                        Multimodal extraction
generationProvider                      extractionProvider
generationModel                         extractionModel
generationProviderConfigId              extractionProviderConfigId
        |                                       |
OpenAI Native / Relay / Gemini           Zhipu mainland / Z.AI international / relay vision
```

任务快照保存 Provider、model、config ID、routing、endpoint、配置版本、prompt 和 params，不保存 API Key。图片生成只接受 `gpt-image-2` 和受支持的 Gemini 图片模型；GLM 提取不会覆盖生成模型。

## 任务、资产与导出

- 所有模型动作先创建持久化任务，再由 worker 调用 adapter。
- 只有响应校验、永久文件或结构化数据提交成功后才写入 `success`。
- Asset 通过受控 storage key 和 content endpoint 访问，不把临时文件或任意客户端路径作为永久结果。
- 方案板、GLM 提取、预算、人工确认和导出是可独立执行的业务路径；不存在真实技术依赖时不得互相阻塞。
- CSV 使用 UTF-8 BOM；SVG/报告引用真实 BoardDocument、Asset 与 ExtractedItem。

## 安全与本地运行

Windows sidecar 监听 `127.0.0.1:8010`，前端校验 service ID、API contract、Host、Origin 和本机 session token。安装版数据位于 `%LOCALAPPDATA%\com.havenframe.desktop\`。移动端直接调用用户配置的 HTTPS Provider，并将凭据保存在系统安全存储。

## 构建链

```text
app/src + app/src-tauri + backend
  -> Vite production bundle + PyInstaller sidecar + Tauri
  -> local NSIS installer

mobile-expo source
  -> local Expo prebuild + Gradle
  -> local Android artifact
```

CI 只验证源码，不发布 artifact。Windows 与 Android 产物必须在授权本机生成并记录 commit、时间、大小和 SHA-256；iOS 云构建需在 Android 验收后获得明确批准。
