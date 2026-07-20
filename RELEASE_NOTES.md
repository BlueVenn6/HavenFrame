# HavenFrame / 栖构 Desktop 0.2.0-rc.12

This repository publishes the bilingual Windows desktop source only. It does not contain Android or iOS client source.

本仓库只发布中英双语 Windows 桌面版源码，不包含 Android 或 iOS 客户端源码。

## Provider boundaries / Provider 边界

- Image generation: OpenAI `gpt-image-2` native or compatible relay, and supported Google Gemini image models.
- Multimodal extraction: Mainland China Zhipu GLM, international Z.AI GLM, or an explicitly configured compatible vision relay.
- Generation and extraction settings are stored independently.
- Provider failures remain failures; no mock output is presented as success.

## Release status / 发布状态

Source validation does not prove a Windows installer. A binary release reaches State D only after the exact installer is identified by SHA-256, installed, and validated through the relevant packaged-application workflows.

源码验证不等于 Windows 安装版验收。只有记录确切安装包 SHA-256、实际安装并完成对应 packaged application 业务流程后，二进制发布才达到 State D。
