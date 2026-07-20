# 栖构移动端架构

本仓库保留桌面 / 本地 Web 工作台，并新增独立的 Expo React Native 手机端：

- `mobile-expo/` - Expo SDK 56 + TypeScript 手机端；Android 仅本地 Gradle 构建
- `packages/shared-api/` - 手机端调用 FastAPI 后端的接口目录

手机端不复制后端工作流逻辑。它连接已有 FastAPI 后端，上传图片为项目素材，提交任务队列，轮询任务状态，并通过素材内容接口显示生成结果。

## 运行模型

1. 构建环境通过 `EXPO_PUBLIC_QIGOU_API_BASE_URL`（或平台专用变量）注入后端 Base URL；缺失时 fail closed，不发起网络请求。
2. 用户会话访问凭据保存在系统 Keychain/Keystore，不进入 `EXPO_PUBLIC_*` 或 bundle。
3. App 使用 `GET /health` 检测后端可达性。
4. 项目来自 `GET /api/projects`，新项目通过 `POST /api/projects` 创建。
5. 图片通过 `POST /api/assets/upload` 上传。
6. 平面图、单房间、多房间、空间渲染、自定义任务都通过 `POST /api/tasks/provider-image` 进入任务队列。
7. 单房间 / 多房间方案板同步调用软方案板 workflow，生成材料、报价和预算汇总记录。
8. 任务状态通过 `GET /api/tasks?project_id=...` 轮询。
9. 图片与 SVG 方案板预览通过带同一 bearer header 的 `GET /api/assets/{asset_id}/content` 显示和打开。
10. 项目回看来自 `GET /api/projects/{project_id}/review`。

## 手机端范围

手机端对齐桌面核心功能：

- 项目创建、选择、归档回看
- 平面图 -> 2D / 3D 可视化任务
- 单房间方案板 -> 材料、报价和生成图
- 多房间方案板 -> 整体方案板、分房间方案板、预算汇总
- 空间图片 / SU 截图 -> AI 精修效果图
- 自定义任务和可复用模板
- 提示词草稿
- 模型状态、模块默认模型、后端 Base URL、安全连通性检测
- 任务队列、取消、失败重试

手机端明确不包含：

- 本地运行中心 / 本地部署页面
- 打开本机目录、日志、本地渲染引擎配置
- 真实付费模型的自动测试
- 中文副本之外的动态短片生成流程

## 构建边界

`mobile-expo/eas.json` 仅保留未来获得明确授权后的 iOS 配置。Base URL 是构建配置，不由页面随意改写；preview/production 只接受设备可访问的 HTTPS 地址。

当前发布策略要求 Windows Desktop 与 Android 全部本地构建。Android 本地 APK 验收并确认 Android/iOS 共用的 API、模型、Asset 与平台能力实现后，iOS 云构建仍需用户明确批准；仓库不会自动触发 EAS 或其他云端构建。
