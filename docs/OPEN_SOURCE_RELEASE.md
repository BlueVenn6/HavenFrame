# HavenFrame / 栖构开源发布说明

## 发布范围

本仓库包含 Windows 桌面、FastAPI sidecar、共享 contract，以及 Android/iOS
共用移动源码。原创源码使用 `AGPL-3.0-or-later`。依赖和 Expo 模板保留各自许可证。

桌面与移动端均不提供本地部署、本地模型服务、ComfyUI 或本地 renderer
产品能力。Windows 内嵌 sidecar 仅负责当前应用的数据、任务、资产和用户自备
Provider 调用。

## 受保护基线

- 开源准备前标签：`havenframe-pre-oss-20260720`
- 基线提交：`adcac64cfecf7f78ca65b16d1c8bf681618f0c97`
- 桌面 rc.12 installer 源码提交：`a6415fa9778fb0a8289a4e89c3c2703e395cc9b8`
- `adcac64` 相对 `a6415fa` 仅修改 `mobile-expo/`；桌面源码树未变化。

## 公开分支策略

公开仓库以 `main` 为唯一默认分支。为避免公开本机历史邮箱、旧实验分支和已废弃
实现，只推送经过审查的公开 `main` 和明确的公开 release tag。不得使用
`git push --all`、`git push --mirror` 或推送内部保护标签。

公开前必须确认：

1. `main` 指向通过源码门禁的唯一公开快照。
2. GitHub Actions `Source validation` 在公开 `main` 上通过。
3. GitHub Private vulnerability reporting 已启用。
4. 仓库设置中启用 secret scanning、push protection 和 Dependabot alerts（账号方案支持时）。

## 用户数据边界

Git 只发布跟踪文件。不得上传 `.env`、API Key、数据库、客户素材、workspace、
输出、日志、缓存、构建目录、安装包、APK 或签名文件。Windows 用户数据位于：

```text
%LOCALAPPDATA%\com.havenframe.desktop\
```

Android/iOS 数据位于各自应用沙盒和系统 Keychain/Keystore。新用户不会继承开发机
中的项目、Key、中转地址或任务历史。

## 源码与二进制发布边界

公开源码通过不等于二进制发布通过。Windows installer 和 Android APK 只在授权
本机构建；iOS 在 Android 真机验收及用户明确批准前不云构建。未签名 Windows
installer 和 debug 签名 Android APK 只能作为受控测试候选，不能称为正式生产包。

每个二进制 release 必须记录源码 commit、构建开始/结束时间、绝对产物路径、大小、
SHA-256、签名状态，以及确切产物的安装/启动验收结果。
