# Windows 桌面完整人工验收清单

> 历史说明：本文件记录旧版开发环境人工验收流程，其中“本地部署”章节不适用于当前 HavenFrame / 栖构双语无本地部署产品。当前打包与交付的唯一验收门禁请使用 [`PRE_PACKAGE_DELIVERY_CHECKLIST.md`](PRE_PACKAGE_DELIVERY_CHECKLIST.md)。

测试模式：通过仓库根目录 `start_desktop_test.bat` 启动的 Tauri desktop development mode。所有数据写入 `manual-acceptance/runtime/`。开始前运行 `desktop_test_status.bat`，确认 backend、frontend、desktop 均为 running。

每项记录 `PASS`、`FAIL`、`BLOCKED_BY_CREDENTIALS` 或 `NOT_RUN`。发现问题时在 `docs/MANUAL_ACCEPTANCE_ISSUES.md` 登记 ID、步骤和截图。真实 Provider 缺少 Key 时不得用固定结果、历史图片或 mock 结果代替。

## A. 应用启动

- [ ] 双击 `start_desktop_test.bat` 后自动出现标题为“栖构”的 Tauri 窗口。
- [ ] `desktop_test_status.bat` 显示 backend、frontend、desktop 均运行。
- [ ] `http://127.0.0.1:8001/health` 返回 `status=ok`。
- [ ] `http://127.0.0.1:5174` 返回页面，不出现 `ERR_CONNECTION_REFUSED`。
- [ ] 首屏无白屏、未捕获错误或错误弹窗。
- [ ] 页面切换和刷新后仍可工作。
- [ ] 双击 `stop_desktop_test.bat` 只停止登记的本项目进程。
- [ ] 再次启动成功，隔离数据仍存在。

## B. 项目

- [ ] 自动准备的“人工验收示例项目”存在，中文字段完整。
- [ ] 新建一个独立测试项目。
- [ ] 修改名称、客户、风格、房间、预算和说明。
- [ ] 打开项目并核对字段。
- [ ] 停止并重启后项目仍存在。
- [ ] 删除测试项目时行为和提示明确，不误删示例项目或其他项目。

## C. 平面图

- [ ] 输入项、上传入口和模型选择可用。
- [ ] 上传 `manual-acceptance/fixtures/sample-room-plan.png`，确认创建真实资产记录。
- [ ] 分别选择 OpenAI Native、OpenAI Relay、Google image model。
- [ ] 提交动作创建真实任务并进入任务队列。
- [ ] loading、success、failure 状态与后端任务一致。
- [ ] 失败信息能区分配置、认证、网络、超时、Provider 和响应解析错误。
- [ ] 支持失败任务的真实重试；若产品没有重试入口，登记问题而非伪造重试。
- [ ] 成功结果图片可打开、详情可查看、历史可回看。
- [ ] 刷新、切页和应用重启后图片仍显示。
- [ ] 导出文件真实存在且可打开。
- [ ] 无相应真实凭据的 Provider 标记 `BLOCKED_BY_CREDENTIALS`。

## D. 单房间方案板

- [ ] 输入房间、风格、预算和需求。
- [ ] 上传样例 PNG；文件上传的格式限制与错误提示明确。
- [ ] GLM 提取任务进入任务队列并调用所配置的真实 GLM。
- [ ] 核对结构化房间、风格、材料、产品、预算、尺寸和数量。
- [ ] 核对中文、数字、币种和字段映射，无截断或乱码。
- [ ] 生成方案板后结果、资产和任务状态一致。
- [ ] 结果图片刚生成、刷新、切页、历史和重启后均可显示。
- [ ] SVG 导出内容完整，中文字体和布局正常。
- [ ] CSV 导出字段有业务含义，UTF-8 BOM、中文、数字和换行正常。
- [ ] 历史记录与项目归档一致。
- [ ] 无 GLM 凭据时标记 `BLOCKED_BY_CREDENTIALS`。

## E. 多房间方案板

- [ ] 输入并上传客厅、餐厅、主卧资料。
- [ ] 真实 GLM 能识别多个房间且不会把字段串房。
- [ ] 每个房间的风格、材料、产品、预算、尺寸和数量可核对。
- [ ] 总预算与分房间预算关系正确。
- [ ] 整体方案板和分房间方案板资产均真实存在。
- [ ] 图片在刷新、切页、历史和重启后仍显示。
- [ ] SVG 和 CSV 导出覆盖所选房间，中文与数字正常。
- [ ] 空房间、部分提取失败和非法资产有明确失败状态。
- [ ] 无 GLM 凭据时标记 `BLOCKED_BY_CREDENTIALS`。

## F. 空间渲染

- [ ] 输入需求并上传样例图或有权使用的空间图片。
- [ ] Provider 与模型选项来自模型设置，不由页面拼接 endpoint。
- [ ] 提交后创建任务并显示 loading。
- [ ] 成功图片、失败状态和后端记录一致。
- [ ] 重试不覆盖原始失败事实。
- [ ] 历史、刷新、切页和重启后图片仍显示。
- [ ] 无真实凭据时标记 `BLOCKED_BY_CREDENTIALS`。

## G. 自定义任务

- [ ] 新建可复用任务模板。
- [ ] 编辑名称、提示词和实际存在的参数。
- [ ] 选择真实 Provider/模型并提交到任务队列。
- [ ] 成功或失败结果与任务历史一致。
- [ ] 模板和历史在重启后仍存在。
- [ ] 删除模板不误删无关项目资产。

## H. 提示词

- [ ] 新建中文提示词。
- [ ] 编辑并保存。
- [ ] 在对应工作流中选择或使用该提示词。
- [ ] 重启后内容仍存在。
- [ ] 删除行为明确，已存在任务快照不被篡改。

## I. 模型设置

- [ ] Generation / OpenAI Native：UI provider、model、Base URL、Key 状态与保存值一致。
- [ ] Generation / OpenAI Relay：中转 Base URL、接口路径、model 与实际请求一致。
- [ ] Generation / Google image：Google Provider 下的图片模型与实际请求一致。
- [ ] Extraction / GLM：provider、model、endpoint 与实际提取请求一致。
- [ ] 保存后刷新和重启，配置仍存在于隔离 QA 数据库。
- [ ] 运行任务后核对 provider、model、endpoint/config version 快照，不含明文 API Key。
- [ ] generation 选择变化不会覆盖 extraction 配置，反向亦然。
- [ ] “测试连接”必须有真实请求结果，不能固定返回成功。
- [ ] 无凭据的 Live 项标记 `BLOCKED_BY_CREDENTIALS`。

## J. 本地部署（仅 Windows）

- [ ] 页面存在且为中文桌面系统页。
- [ ] FastAPI 状态显示当前验收端口 `8001` 的真实结果。
- [ ] health 检查与 `desktop_test_status.bat` 一致。
- [ ] start/stop 操作不误杀本机其他 node、python、uvicorn、cargo 或 tauri。
- [ ] 本地部署错误不影响已配置的云 Provider 模式。
- [ ] ComfyUI 未配置时只显示可选 Provider 未就绪，不把整个本地部署判为失败。

## K. 资产与图片

- [ ] 上传后立即显示。
- [ ] 刷新后显示。
- [ ] 切换页面后显示。
- [ ] 关闭并重启后显示。
- [ ] 任务历史中显示。
- [ ] DB 资产记录对应的文件存在于隔离 workspace。
- [ ] 内容接口 MIME 与文件签名一致。
- [ ] 持久字段不保存 `file://` URL 或会失效的临时绝对路径。
- [ ] 删除/非法路径/丢失文件返回明确资产错误。

## L. 导出

- [ ] SVG 文件可打开，画布完整且无截断、溢出或乱码。
- [ ] CSV 为真实结构化数据，不是截图。
- [ ] CSV 包含 UTF-8 BOM，Excel 打开中文正常。
- [ ] 项目、房间、产品、材质、颜色、尺寸、数量、单价、预算和备注按实际数据输出。
- [ ] 图片引用真实有效。
- [ ] 空数据导出被明确拒绝。
- [ ] 非法、越界或丢失资产被拒绝且不泄露本机路径。

## 完成记录

- 测试人：
- 开始时间：
- 完成时间：
- Git HEAD：`3ae7c557dab327fe7d7f96eed85b27bb4a049a7c`（如本阶段有提交，在此补充测试时 HEAD）
- PASS 数：
- FAIL 数：
- BLOCKED_BY_CREDENTIALS 数：
- 关联问题 ID：
