# HavenFrame / 栖构简明使用说明

本说明可随测试安装包一起提供给使用者。中文与英文界面使用同一套功能、模型线路和本地项目数据。

---

# 中文说明

## 1. 软件用途

HavenFrame（中文名：栖构）是一款室内设计 AI 交付工作台，可管理项目、上传空间图片、生成平面图和渲染图、制作单房间或多房间方案板、提取家具与材质，并导出客户报告和采购表格。

主要功能：

- 项目与本地归档
- 平面图 2D / 3D 可视化
- 单房间方案板
- 多房间方案板
- 空间渲染
- 自定义任务
- 提示词管理
- 图片生成与 GLM 多模态提取
- A4 方案报告与结构化采购表格

## 2. 开始使用

1. 打开软件，在右上角选择“中文”或 “English”。
2. 进入“模型设置”，配置至少一条图片生成线路。
3. 如需识别图片中的家具、材质和颜色，再配置一条 GLM 提取线路。
4. 进入“项目”，新建项目并填写项目名称、客户、风格和房间等信息。
5. 选择需要的工作流。各工作流可以独立使用，不要求按固定顺序全部完成。

## 3. 模型设置

### 图片生成线路

- OpenAI 原生：使用 `gpt-image-2` 和 OpenAI API Key。
- OpenAI 中转：使用支持 `gpt-image-2` 的 HTTPS Base URL、对应 API Key 和 `/images/generations` 或服务商要求的兼容路径。
- Google Gemini：使用 Google API Key 和可用的 Gemini 图片模型。

连接测试和真实生成不是同一件事。保存配置后，应在实际工作流中生成一张图片，确认线路、模型、返回图片和任务状态均正确。

### GLM 多模态提取线路

- 中国大陆智谱 GLM：Base URL 为 `https://open.bigmodel.cn/api/paas/v4`，使用中国大陆智谱账号的 Key。
- 国际 Z.AI GLM：Base URL 为 `https://api.z.ai/api/paas/v4`，使用国际 Z.AI 账号的 Key。
- 兼容中转：仅在中转服务明确支持视觉 Chat Completions 时使用。

大陆与国际账号的 Base URL 和 Key 不能混用。VPN、代理或 DNS 也可能影响连接；遇到 `getaddrinfo`、连接断开或超时时，应先检查网络线路。

## 4. 项目

所有上传图片、任务、输出、报告和历史都归档到当前项目。开始工作前先创建或选择项目。

- 新建项目：填写名称、客户、风格、房间和可选预算。
- 项目输出：查看当前项目生成的图片、报告和表格。
- 删除项目：只删除确认不再需要的项目；重要资料应先备份。

## 5. 平面图

1. 上传平面图、草图或黑白布局图。
2. 选择生成类型：2D 彩色平面图或 3D 鸟瞰图。
3. 选择房间、风格、比例和材质关键词，或修改提示词。
4. 确认当前图片模型线路。
5. 点击生成，任务会进入任务队列。
6. 完成后在页面或项目输出中查看图片。

## 6. 单房间方案板

1. 上传一张房间图片。
2. 可以直接设置风格和提示词并生成方案板图片。
3. GLM 提取是可选步骤：需要清点家具、材质或颜色时再点击“提取元素”。
4. 对提取结果逐项选择“保留”或“删除”。预算、数量、采购状态、购买方式和链接均为可选信息。
5. 可以分别执行：生成报告内容、生成方案板图片、导出 A4 报告、导出结构化表格。

不填写预算、不做 GLM 提取或不进行人工确认，不应阻止与这些信息无关的图片生成或报告导出。

## 7. 多房间方案板

1. 上传多张不同房间图片。
2. 可直接生成整体方案板或分房间方案板。
3. 如需清单和预算，再使用 GLM 分别提取各房间元素并人工确认。
4. 检查元素所属房间，删除识别错误或不需要的内容。
5. 分别导出 A4 方案报告和结构化采购表格。

更换图片后应删除不再使用的旧图片，避免把不同批次的素材混在同一任务中。

## 8. 空间渲染

1. 上传一张需要渲染的源空间图、白模或 SU 截图。
2. 选择风格、房间类型、比例和提示词。
3. 参考图为可选：可以添加 1 至 3 张参考图，用于风格、配色、材质或家具参考。
4. 参考图提取也是可选：可提取并保留/删除参考元素，也可以不提取直接生成。
5. 点击生成后在任务队列中等待真实结果。

源空间图决定空间结构和视角；参考图只提供设计线索，不应替代源空间结构。

## 9. 自定义任务和提示词

- 自定义任务：保存经常使用的提示词和参数组合，之后可重复运行。
- 提示词：查看内置提示词，或新建、编辑和复制自己的提示词。
- 用户自己填写的提示词不会因为切换界面语言而自动翻译。

## 10. 报告、表格和打印

- A4 报告：适合客户查看和 A4 竖版打印，包含当前项目图片、交付摘要、元素、预算和采购状态。
- 结构化表格：适合继续编辑采购清单、数量、预算、购买方式和链接。
- 报告最多重点展示部分元素；完整数据以结构化表格为准。
- 导出后请先打开并检查图片、文字、预算和语言，再发送给客户。

## 11. 数据和安全

- API Key 由使用者自行填写，不随安装包提供。
- Windows 使用系统保护的本机凭据存储；Android/iOS 使用系统 Keychain/Keystore。
- 项目、任务和输出保存在本机应用数据目录。
- 中转服务会收到使用者明确提交的图片和提示词，请只使用可信的 HTTPS 中转。
- 卸载前如需保留项目，请先备份项目输出和重要资料。

## 12. 产品边界

本版本不提供：

- 本地部署页面
- 本地模型服务或 ComfyUI 管理
- 动态短片生成
- 内置免费 Provider 额度
- 栖构账号、设备授权或统一云端项目同步

模型费用、配额、地区限制和服务可用性由相应 Provider 决定。

## 13. 常见问题

- 生成按钮无反应：确认已选择项目、上传必要源图，并保存可运行的图片模型线路。
- 提取失败：确认使用 GLM 视觉模型、Base URL 与账号地区匹配，并检查 VPN、代理和 DNS。
- 429 错误：Provider 配额不足或频率受限，请检查账户余额和限额。
- 401/403 错误：Key 无效、权限不足或 Base URL 与 Key 不匹配。
- 超时：保留任务记录，检查网络和 Provider 状态；图片生成可能需要数分钟。
- 历史图片无法打开：检查项目资产是否仍存在，不要移动或删除应用数据目录中的文件。

---

# English Guide

## 1. What the application does

HavenFrame is an interior-design AI delivery workspace. It manages projects, accepts room images, generates floor-plan visualizations and renderings, creates single-room or multi-room boards, extracts furniture and materials, and exports client reports and procurement tables.

Main features:

- Projects and local archives
- 2D/3D floor-plan visualization
- Single-room design boards
- Multi-room design boards
- Space rendering
- Custom tasks
- Prompt management
- Image generation and multimodal GLM extraction
- A4 client reports and structured procurement tables

## 2. Getting started

1. Open the application and select Chinese or English in the upper-right language menu.
2. Open Model Settings and configure at least one image-generation route.
3. Configure a GLM extraction route only if you need furniture, material, or color extraction.
4. Create a project and enter the project, client, style, and room information.
5. Open the workflow you need. Workflows are independent and do not have to be completed in a fixed sequence.

## 3. Model settings

### Image generation

- OpenAI Native: use `gpt-image-2` with an OpenAI API key.
- OpenAI Relay: use an HTTPS Base URL that supports `gpt-image-2`, the matching API key, and the compatible image endpoint required by the relay.
- Google Gemini: use a Google API key and an available Gemini image model.

A connection test is not the same as a successful image-generation task. After saving a route, run one real workflow and confirm the selected route, model, task status, and returned image.

### Multimodal GLM extraction

- Zhipu GLM for Mainland China: use `https://open.bigmodel.cn/api/paas/v4` and a mainland Zhipu account key.
- International Z.AI GLM: use `https://api.z.ai/api/paas/v4` and an international Z.AI account key.
- Compatible relay: use only when the relay explicitly supports visual Chat Completions.

Mainland and international URLs and keys are not interchangeable. VPN, proxy, and DNS settings may also affect connectivity.

## 4. Projects

Uploads, tasks, outputs, reports, and history are archived under the selected project. Create or select a project before starting a workflow.

- New project: enter a name, client, style, rooms, and an optional budget.
- Project outputs: review generated images, reports, and tables.
- Delete project: remove only projects you no longer need, and back up important files first.

## 5. Floor Plans

1. Upload a floor plan, sketch, or monochrome layout.
2. Select a 2D color plan or a 3D bird's-eye view.
3. Select the room, style, aspect ratio, and material keywords, or edit the prompt.
4. Confirm the active image-generation route.
5. Generate the image; the request enters the task queue.
6. Review the result on the page or in Project Outputs.

## 6. Single-Room Board

1. Upload one room image.
2. You may generate a board directly after setting the style and prompt.
3. GLM extraction is optional. Use Extract Items only when you need a furniture, material, or color inventory.
4. Keep or remove each extracted item. Budget, quantity, procurement status, purchase method, and URL are optional.
5. Report content, board image generation, A4 report export, and structured table export can be run separately.

Missing budgets, extraction, or manual review must not block operations that do not depend on them.

## 7. Multi-Room Board

1. Upload images for multiple rooms.
2. Generate a whole-project board or room-specific boards directly.
3. Use GLM extraction and manual review only when you need room inventories and budgets.
4. Verify each item's room assignment and remove incorrect or unnecessary items.
5. Export the A4 board report and structured procurement table separately.

Remove obsolete images after replacing an upload so different source batches are not mixed in the same task.

## 8. Space Rendering

1. Upload one source room image, white model, or SketchUp screenshot.
2. Select the style, room type, aspect ratio, and prompt.
3. Reference images are optional. Add one to three images for style, color, material, or furniture direction.
4. Reference extraction is also optional. You may review extracted reference elements or generate without extraction.
5. Generate the rendering and monitor the real task in the queue.

The source image controls the space structure and camera view. Reference images provide design direction only.

## 9. Custom Tasks and Prompts

- Custom Tasks store reusable prompt and parameter combinations.
- Prompts let you review built-in prompts and create, edit, or duplicate your own prompts.
- User-created prompt text is never automatically translated when the interface language changes.

## 10. Reports, tables, and printing

- A4 report: a portrait client-delivery sheet containing the current project image, delivery summary, retained items, budget, and procurement status.
- Structured table: an editable procurement list with quantities, budgets, purchase methods, and URLs.
- The report highlights a limited number of items; use the structured table for the complete dataset.
- Open and review each export before sending it to a client.

## 11. Data and security

- API keys are supplied by the user and are not included in the installer.
- Windows uses protected local credential storage; Android/iOS use the system Keychain/Keystore.
- Projects, tasks, and outputs are stored in the application's local data directory.
- A relay receives the images and prompts you explicitly submit. Use only a trusted HTTPS relay.
- Back up project outputs and important files before uninstalling the application.

## 12. Product boundaries

This version does not include:

- A local-deployment page
- Local-model or ComfyUI management
- Dynamic video generation
- Built-in free Provider credits
- A HavenFrame account, device authorization, or unified cloud project synchronization

Provider fees, quotas, regional restrictions, and availability are controlled by each Provider.

## 13. Troubleshooting

- Generate does nothing: select a project, upload the required source image, and save a runnable image route.
- Extraction fails: use a visual GLM model, match the Base URL to the account region, and check VPN, proxy, and DNS settings.
- HTTP 429: the Provider quota or rate limit has been exceeded.
- HTTP 401/403: the key is invalid, lacks permission, or does not match the Base URL.
- Timeout: keep the task record and check the network and Provider status; image generation may take several minutes.
- Historical image cannot open: confirm the project asset still exists and do not move or delete files from the application data directory.
