# HavenFrame / 栖构 API Provider Matrix

“代码验证”表示 endpoint、auth header、request schema、parser 和持久化由受控 transport 测试覆盖，不等于付费 Live 调用。“用户 Live”只记录用户在真实产品中的观察结果。

| 功能 | Provider | Model | Endpoint 来源 | Auth 来源 | Adapter / parser | 验证状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 图片生成 | OpenAI Native | `gpt-image-2` | 官方 Base URL + image endpoint | DPAPI/SecureStore 或 env | `openai_image_generation.py` | 代码验证；本轮无 Native Live |
| 图片生成 | OpenAI Relay | `gpt-image-2` | 用户保存的 HTTPS Base URL + image endpoint | DPAPI/SecureStore | 同上，OpenAI-compatible parser | 代码验证；用户已确认连接测试通过 |
| 图片生成 | Google Gemini | 受支持 Gemini 图片模型 | 官方/中转 Base URL + `:generateContent` | DPAPI/SecureStore | `gemini_image_generation.py` | 代码验证；Live 受账号配额影响 |
| 信息提取 | 智谱 GLM（中国大陆） | `glm-4.5v` | `open.bigmodel.cn/api/paas/v4/chat/completions` | `ZHIPU_API_KEY` 或安全存储 | `glm_item_extraction.py` | 代码验证；历史 Live 成功 |
| 信息提取 | Z.AI GLM（国际/海外） | `glm-4.5v` | `api.z.ai/api/paas/v4/chat/completions` | `ZAI_API_KEY` 或安全存储 | `glm_item_extraction.py` | 代码验证；用户已确认连接测试通过 |
| 信息提取 | OpenAI-compatible vision relay | 用户配置的视觉模型 ID | 用户保存的 HTTPS Base URL + `/chat/completions` | DPAPI/SecureStore | `glm_item_extraction.py` | 代码验证；需真实兼容服务 |

## 生成白名单

- OpenAI Native / `gpt-image-2`
- OpenAI Relay / `gpt-image-2`
- Google Gemini / `gemini-2.5-flash-image`
- Google Gemini / `gemini-3-pro-image-preview`
- Google Gemini / `gemini-3.1-flash-image-preview`

Provider registry 中的历史或内部元数据不得进入普通生成下拉菜单。GLM 线路只用于视觉/结构化提取，不得应用到图片生成工作流。

## 区域说明

智谱中国大陆和 Z.AI 国际站是两个账号与 endpoint 体系。它们都可以使用 Chat Completions 兼容结构；区别不是“一个原生、一个兼容”，而是账号区域、Base URL 和 API Key 必须匹配。UI 必须明确显示“中国大陆”或“国际/海外”。
