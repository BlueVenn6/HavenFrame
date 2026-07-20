# HavenFrame / 栖构手机端

这是栖构中文工作台的手机端，使用 Expo SDK 56、React Native、TypeScript。Android 发布构建只在本机执行；本仓不会自动提交 EAS 或其他云端构建任务。

## 范围

手机端包含项目、平面图、单房间方案板、多房间方案板、空间渲染、自定义任务、提示词、模型设置、项目回看和任务队列。

手机端不包含本地部署、服务管理、局域网后端或桌面 sidecar。用户在模型页为 OpenAI 原生、OpenAI 兼容中转、Google Gemini 图片模型和智谱 GLM 多模态提取分别填写线路；API Key 仅保存到系统 Keychain/Keystore。

## 开发运行

```powershell
cd mobile-expo
npm install
npm run start
```

应用不依赖 `EXPO_PUBLIC_*_API_BASE_URL`，不包含 example.com、localhost 或局域网 fallback，也不要求设备授权服务器。Provider 地址与 API Key 均由用户在「模型」页配置；地址保存在应用文档目录，密钥通过 Expo SecureStore 保存。

## 构建策略

Windows Desktop 与 Android 必须本地构建。下面的命令会在本机生成 Android 原生工程并执行 Gradle，不会上传源码：

```powershell
cd mobile-expo
$env:NODE_ENV="production"
npm run build:android
```

本地配置插件会强制 Gradle 使用 UTF-8、关闭并行配置，并从主 Manifest 移除录音、悬浮窗和写外部存储权限。生成的 APK 位于 `android\app\build\outputs\apk\debug\app-debug.apk`。

`build:android` 是本地原生编译验证，会按需在已忽略的 `android/` 目录创建标准调试签名。它不是可分发的生产包。需要给测试人员安装的内部 release 使用同一套 BYOK 运行时：

```powershell
npm run build:android:internal
```

内部 release 不预装任何用户 Provider 地址或 API Key。安装后由用户配置真实线路；未配置时必须明确显示对应线路未配置，不能显示云端服务或本地部署错误。

`eas.json` 只保留未来 iOS 发布配置，不会自动触发任何云端任务。必须先完成 Android 本地验收并确认 Android/iOS 共用实现，再由用户明确批准 iOS 云构建。

不要把 API Key、`.env`、签名文件、输出文件或本地模型文件提交到仓库。

## 发布前检查

```powershell
npx tsc --noEmit
npm run test:connectivity
npm run test:platform-parity
npm run test:runtime-selection
npm run test:i18n
npm run test:report
npm run build:android
```

Android/iOS 共用代码一致性使用 `npm run test:platform-parity` 验证。iOS 云构建不属于自动发布检查。

真实付费模型不要作为自动测试调用。手机端的「检测已保存线路」直接请求当前 Provider 的轻量检测端点；如果中转不提供模型查询接口，只能显示“地址可达但模型未验证”，不得显示为通过。真实出图必须由用户在工作流里明确发起。
