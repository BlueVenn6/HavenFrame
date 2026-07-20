# 当前代码质量与发行评估

评估分支：`bilingual-cn-en-20260716`。评分只反映当前源码证据，不把构建成功等同于最终交付物通过。

## 当前评分

**8.1 / 10（核心架构和双语源码门禁已建立，最终产物验收仍未完成）**

| 维度 | 分数 | 当前证据 | 剩余事项 |
|---|---:|---|---|
| 架构与职责 | 8.5 | 桌面内嵌数据后端与本地部署产品能力已分离；移动端独立 BYOK runtime | 完成产物级验证 |
| 模型隔离 | 8.5 | 图片仅 OpenAI/Gemini；GLM 大陆/国际/中转独立视觉提取 | 完成真实业务输出验收 |
| 任务与持久化 | 7.5 | 桌面 SQLite/任务快照；移动应用文档目录持久化 | 移动端进程中断恢复 |
| 图片与导出 | 7.0 | 资产归档、SVG/CSV、UTF-8 BOM 已有回归 | 真机查看、分享与重启回看 |
| 自动化测试 | 8.5 | 后端全量 178 passed；桌面 i18n/typecheck/production build；移动 i18n/typecheck/parity | 公共 CI 首次运行、Android 与 Windows artifact 验收 |
| 发布链 | 6.5 | 冻结中文版、逻辑提交、bundle hash、安全扫描 | 唯一 rc 身份、最终 artifact hash |
| 国际化 | 8.0 | 桌面/移动共享 locale 层、系统语言默认、手动切换、原生应用名与 iOS 权限文案、AST JSX 门禁 | 最终安装版双语人工巡检 |
| 安全与隐私 | 7.5 | 无 source map、secret scan、桌面/移动安全存储、发布安全说明 | 移动依赖告警处置、最终包审计与代码签名 |

## 开源准备度

**8.0 / 10（本地候选）**。根目录已加入 `AGPL-3.0-or-later`、第三方许可说明、双语 README/使用说明、贡献规范、安全政策、依赖更新配置和源码 CI。远程 GitHub Actions、私密漏洞报告、secret scanning、push protection 与 Dependabot alerts 尚需在公开仓库创建后实际启用并验证。

## 当前明确边界

- 不需要栖构云端 API、登录、设备授权或服务端签发 token。
- 用户自行填写 Provider API Key/Base URL；凭据不应进入发布包。
- Windows 保留内嵌 sidecar 作为应用数据与任务基础设施，但不存在本地部署页面、本地模型服务或本地 renderer。
- Android/iOS 不包含 sidecar、本地部署、localhost 探测或栖构云端门禁。
- 正式签名提高来源可信度，但不是 BYOK 功能可运行的前置条件。

## 当前验证等级

桌面 rc.12 已由用户完成人工功能验收，但公众二进制仍未签名。Android `1.1.3-build5` 为 **State C**：本地 APK 已生成且来源可追溯，但未完成真机验收。iOS 仅完成共用源码与本地生产 bundle 验证，尚未获得云构建授权。源码开源快照需在本轮门禁完成后冻结。
