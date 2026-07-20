# 栖构删除复核

## 已删除

| 路径/能力 | 引用检查 | 原因 | 数据影响 |
| --- | --- | --- | --- |
| `mobile-ios/` | 仅目录内自引用，Xcode 引用 7 个缺失 Swift 文件 | 破损英文重复客户端并污染 local deployment | 无用户数据；iOS 由 mobile-expo 接管 |
| `backend/adapters/cloud/*` | 真实 service 无引用 | 返回 `/mock/output.png` 的假成功 skeleton | 无 |
| `backend/adapters/local/comfyui_adapter.py` | 无运行引用 | 继承旧 mock adapter；真实检测在 runtime service | 无 |
| `backend/workflows/*` | route/service 不加载 | 固定 queued skeleton | 无 |
| `backend/tasks/worker.py` | 无实例化/启动引用 | 空 worker skeleton | 无 |
| `/api/tasks/mock` 与旧 fake workflow POST | 无真实 UI 必需 | 假排队/假输出风险 | 不删除历史 DB |
| legacy board PDF export | 前端无调用；shared contract 唯一旧引用 | 用户明确废弃 PDF 交付 | 保留已有文件/ExportRecord |
| `app/src/lib/mock-data.ts` | 常量已迁移，业务 stores 已接 API | 断网假业务数据风险 | 无 |
| `openai_item_extraction.py` | 调用迁移完成 | 名称掩盖 GLM 专用职责 | 替换为 `glm_item_extraction.py` |
| demo/mock label 与 `mock_source` | 无生产写入者 | 旧 skeleton metadata | 不修改旧 DB JSON |

## 受限保留

| 能力 | 保留理由 | 限制 |
| --- | --- | --- |
| Development Mock Renderer | 本地队列/归档失败路径测试 | 仅 `QIGOU_ENABLE_TEST_RENDERER=1`；正式包验证断言未暴露；结果标记 mock |
| PDF upload signature | GLM/资料输入可包含 PDF，不是 board PDF export | MIME、扩展名、magic、大小校验 |
| Volcengine/Jimeng registry | `PROJECT_SPEC` 要求内置 provider 身份 | 不在不可执行图片 workflow 下拉中 |
| ComfyUI runtime | Windows 可选本地部署能力 | 移动包和 cloud backend 不加载 |

## 暂不删除

- `workspace/`、`backend/data/`、旧输出和用户归档。
- SQLite 旧字段：缺少正式 migration framework，不执行破坏性迁移。
- 大型页面组件：虽有拆分价值，但当前功能正确且大规模视觉重构不属于 release blocker。
- 不能排除动态加载的 runtime registry 元数据。
