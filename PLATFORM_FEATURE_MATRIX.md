# HavenFrame / 栖构平台功能矩阵

| 功能 | Windows Desktop | Android | iOS |
| --- | --- | --- | --- |
| 中英双语 UI | 支持 | 支持 | 支持 |
| 项目 | 本机 SQLite 与归档 | 应用沙盒持久化 | 应用沙盒持久化 |
| 平面图 | 支持 | 支持 | 支持 |
| 单房间方案板 | 支持 | 支持 | 支持 |
| 多房间方案板 | 支持 | 支持 | 支持 |
| 空间渲染 | 支持 | 支持 | 支持 |
| 自定义任务 | 支持 | 支持 | 支持 |
| 提示词 | 支持 | 支持 | 支持 |
| 模型设置 | BYOK + DPAPI | BYOK + SecureStore | BYOK + SecureStore |
| OpenAI Native / Relay | 支持 | 支持 | 支持 |
| Google Gemini 图片 | 支持 | 支持 | 支持 |
| 智谱 GLM 中国大陆 | 支持 | 支持 | 支持 |
| Z.AI GLM 国际/海外 | 支持 | 支持 | 支持 |
| 图片/报告/表格 | 本机归档与打开 | 应用沙盒保存/查看 | 应用沙盒保存/查看 |
| 本地部署页面 | 禁止 | 禁止 | 禁止 |
| 本地模型/renderer | 禁止 | 禁止 | 禁止 |
| localhost Provider fallback | 禁止 | 禁止 | 禁止 |
| 桌面 sidecar | 应用内部基础设施 | 不存在 | 不存在 |
| 打开本机文件夹 | 支持 | 不支持 | 不支持 |

## 能力边界

| 平台 | localDeployment | localRenderer | localFileOpen | Provider 调用 |
| --- | ---: | ---: | ---: | --- |
| Windows Desktop | false | false | true | 由内嵌 loopback sidecar 代理用户配置的 Provider |
| Android | false | false | false | 客户端直接调用用户配置的 Provider |
| iOS | false | false | false | 客户端直接调用用户配置的 Provider |

Windows sidecar 负责项目、任务、资产和安全存储，不是本地部署产品能力。移动端不要求 HavenFrame 云端 API、不探测 localhost，也不初始化桌面服务状态。

Windows 与 Android 只在本机构建。iOS 在 Android 真机验收并获得用户明确批准前不执行云构建。
