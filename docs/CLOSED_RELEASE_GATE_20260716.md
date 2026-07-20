# 闭源发行门禁

目标：生成 Windows 与 Android/iOS 的中英双语闭源发行版；桌面和移动端都不包含本地部署或本地模型服务能力。

## 产品运行边界

- Windows 保留随应用启动的内嵌 FastAPI sidecar、SQLite、项目归档、任务队列和本地文件访问。这是桌面应用基础设施，不是“本地部署”产品功能。
- Windows 不提供本地部署页面、ComfyUI、本地 renderer、本地模型状态或相关 API。
- Android/iOS 使用应用文档目录保存项目、任务与资产，不启动 sidecar、不访问 localhost，也不要求栖构云端 API。
- 所有平台均由用户填写 Provider API Key 和 Base URL。图片生成直接调用 OpenAI `gpt-image-2` 原生/中转或 Google Gemini 图片模型；视觉提取独立调用 GLM。
- 不要求栖构账号、设备授权、固定 bearer token或云端控制面。

## 必须满足的发布条件

- 桌面后端 profile 为 `desktop_client`：能力响应不包含 `local_deployment` 或 `local_renderer` 字段，`cloud_api=false`，同时 `local_file_open=true`。
- 移动端不存在桌面能力注册表；运行源码和 bundle 中不存在栖构云端 API、localhost fallback 或本地部署初始化。
- API Key 不进入 Git、前端 bundle、APK、日志、错误文本或安装器；桌面使用系统安全存储，移动端使用 SecureStore。
- 中文和英文覆盖同一套 UI、状态、错误和导出标题；覆盖不完整时不得声称双语完成。
- Windows 与 Android 只允许本地构建；iOS 仅在 Android 本地真机验收通过并经用户确认后才允许云构建。
- 发布目录只保留本轮唯一产物，并记录源码 commit、构建时间、文件大小和 SHA-256。
- 必须安装/启动确切产物，重做生成、提取、图片显示和历史回看；开发环境或源码测试不能替代最终产物验证。

## 安全边界

闭源客户端不能保证“绝对无法反编译”。本项目采用无 source map、生产压缩、secret 泄露扫描、系统安全存储、受限 Provider URL、最小发布内容和产物哈希来降低泄露与篡改风险。代码签名用于发布者身份与完整性，不是用户填写 API Key 的前置条件；没有正式证书时可以生成测试包，但必须明确其未签名状态。

## 当前状态

中文桌面版已由冻结 branch/tag 独立保留。当前双语分支已删除桌面本地部署产品能力，并将移动端改为独立 BYOK 本机运行层；桌面/移动双语 JSX 与原生元数据检查、桌面 production build、Android/iOS 本地 bundle 已通过，APK/installer 构建和最终产物验收尚未完成。
