# 模型端点审计

本文档记录栖构当前真实室内出图只允许的两条主线路，以及原生 API / 中转 Base URL 的最终请求路径。

## 结论

当前真实室内出图白名单：

1. OpenAI `gpt-image-2`
2. Google Gemini `gemini-2.5-flash-image`（Nano Banana）

ComfyUI、A1111、InvokeAI、本地 Diffusers 属于本地部署页的可选本地引擎；没有配置时应显示未配置或 disabled，不影响上述云端 / 中转图片线路。

方案板“提取元素”不是图片生成链路，不能使用 `gpt-image-2` 或 `gemini-2.5-flash-image`。它走 OpenAI 原生视觉文本模型或 OpenAI-compatible 中转视觉模型，用于从上传房间图中提取家具、材质和预算元素。

## OpenAI GPT Image 2

原生 API：

- Provider：OpenAI
- Model ID：`gpt-image-2`
- Base URL：`https://api.openai.com/v1`
- 非付费测试探测：`GET https://api.openai.com/v1/models/gpt-image-2`
- 真实出图：`POST https://api.openai.com/v1/images/generations`
- 鉴权：`Authorization: Bearer OPENAI_API_KEY`

OpenAI 兼容中转：

- Provider：OpenAI-Compatible Relay / Custom OpenAI
- Model ID：`gpt-image-2`
- Base URL：用户填写的 HTTPS 中转地址，例如 `https://relay.your-company.cn/v1`
- 非付费测试探测：`GET {Base URL}/models/gpt-image-2`
- 真实出图：`POST {Base URL}/images/generations`
- 鉴权：`Authorization: Bearer OPENAI_RELAY_API_KEY`

中转失败默认不会改发官方 OpenAI。只有显式开启 `allow_provider_fallback=true` 且任务前完成数据流确认时，才允许 fallback。

## Google Gemini Nano Banana

原生 API：

- Provider：Google Gemini
- Model ID：`gemini-2.5-flash-image`
- Base URL：`https://generativelanguage.googleapis.com/v1beta`
- 非付费测试探测：`GET https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image`
- 真实出图：`POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent`
- 鉴权：`x-goog-api-key: GEMINI_API_KEY`

Gemini 兼容中转：

- Provider：Google Gemini / Gemini-Compatible Relay
- Model ID：`gemini-2.5-flash-image`
- Base URL：用户填写的 HTTPS 中转地址，例如 `https://relay.your-company.cn/gemini/v1beta`
- 非付费测试探测：`GET {Base URL}/models/gemini-2.5-flash-image`
- 真实出图：`POST {Base URL}/models/gemini-2.5-flash-image:generateContent`
- 鉴权：`x-goog-api-key: GEMINI_RELAY_API_KEY`

Gemini 中转失败不会改发 Google 官方接口。

## 测试连接与真实出图的区别

模型设置页的“测试连接”默认不执行真实图片生成，避免误消耗付费额度：

- OpenAI 图片模型：优先请求 `/models/{model}`。
- Gemini 图片模型：优先请求 `/models/{model}`。
- 如果中转不支持模型查询，只会返回中转可达 / 不支持 / 供应商阻断等结构化状态，不会静默换线路。

真实出图必须通过任务队列，并且后端要求 `data_flow_confirmed=true`。

## 方案板元素提取

- 原生 OpenAI 视觉提取：默认 Base URL 为 `https://api.openai.com/v1`，优先请求 `POST /chat/completions`，必要时 fallback 到 `POST /responses`。
- OpenAI-compatible 中转视觉提取：使用用户配置的 HTTPS Base URL，同样按 `{Base URL}/chat/completions` 和 `{Base URL}/responses` 尝试。
- 前端“单房间方案板 / 多房间方案板”的提取模型选择已和真实出图模型分离，不再把 `gpt-image-2` 图片生成配置误用于元素提取。
- 如果旧本地缓存里还保存了错误组合，前端会纠正到可用视觉模型配置；后端也会拒绝把图片生成配置当作提取模型配置。

## 安装包 / Tauri 图片预览

所有本地资产预览必须通过本机会话 token 访问 `/api/assets/{id}/content`。Tauri WebView 的 `<img>` 请求不能携带自定义 header，因此前端资源 URL 会附带短链路本地 token；后端只允许 loopback Host + 有效 local token 的资产内容请求。普通陌生网页没有 token，仍不能调用本机 API 或读取图片。

## 当前测试覆盖

后端测试覆盖以下行为：

- OpenAI 原生真实出图路径为 `https://api.openai.com/v1/images/generations`。
- OpenAI 中转真实出图路径为 `{Base URL}/images/generations`，不包含 `api.openai.com`。
- Gemini 原生真实出图路径为 `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent`。
- Gemini 中转真实出图路径为 `{Base URL}/models/gemini-2.5-flash-image:generateContent`，不包含 `generativelanguage.googleapis.com`。
- OpenAI / Gemini 图片模型的测试连接默认只做模型探测，不执行真实出图。
- 原生 API 和中转 API 的 URL 独立，不互相串线。
- 资产图片在 Tauri 安装包里可通过带 token 的安全 URL 加载，不再因 `Cross-site requests are not allowed.` 显示成文件名字符。
- 方案板元素提取不会再选中 `gpt-image-2` / Gemini 图片模型配置。

## 仍需人工实测的部分

由于自动测试不能调用真实付费模型，以下项目需要使用有效 API Key 手动验证：

- OpenAI 原生 `gpt-image-2` 是否对当前账号开放。
- OpenAI 兼容中转是否实际支持 `/images/generations` 和 `gpt-image-2`。
- Gemini 原生 `gemini-2.5-flash-image` 是否对当前账号 / 区域开放。
- Gemini 中转是否实际支持 `generateContent` 图片输出和 `responseModalities=["IMAGE","TEXT"]`。

如果某个中转只兼容文本接口，不支持图片上传或图片生成，软件会返回供应商阻断或不支持，不会自动改发官方接口。
