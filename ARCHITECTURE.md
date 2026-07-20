# HavenFrame Desktop Architecture / 栖构桌面架构

## Runtime

```text
Tauri Windows shell
  -> React + TypeScript production bundle
  -> loopback-only FastAPI sidecar (127.0.0.1:8010)
  -> SQLite + workspace asset storage
  -> task queue
  -> Provider adapters
```

The desktop UI validates the sidecar service ID and API contract before using it. The sidecar owns project persistence, task state, asset access, exports, protected credential references, and Provider orchestration.

桌面 UI 在使用 sidecar 前校验 service ID 与 API contract。sidecar 负责项目持久化、任务状态、资产访问、导出、安全凭据引用和 Provider 编排。

## Ownership boundaries / 职责边界

| Area | Path | Responsibility |
|---|---|---|
| Desktop UI | `app/src/` | Workflows, bilingual presentation, task/result views |
| Windows shell | `app/src-tauri/` | Window lifecycle, sidecar startup, OS integration |
| API and persistence | `backend/` | FastAPI, SQLite, task queue, assets and exports |
| Provider adapters | `backend/providers/` | Provider-specific request/response translation |
| Release tooling | `scripts/` | Local build, validation and artifact provenance |

页面组件不得直接拼 Provider endpoint 或 payload。图片生成与多模态提取使用独立模型配置，所有生成动作进入任务队列。

Page components do not construct Provider endpoints or payloads. Image generation and multimodal extraction use independent model configurations, and every generation action enters the task queue.

## Data paths / 数据路径

- Packaged application: `%LOCALAPPDATA%\com.havenframe.desktop\`
- Source development: `backend/data/` and `workspace/`
- Generated sidecar: `app/src-tauri/binaries/`
- Production frontend: `app/dist/`

Local data, generated outputs, credentials, binaries, and installers are excluded from Git.

## Build chain / 构建链

```text
app/src + backend source
  -> npm production build
  -> PyInstaller FastAPI sidecar
  -> Tauri NSIS bundle
  -> exact installer + SHA-256
  -> installed-application acceptance
```

GitHub Actions validates source only. Windows artifacts are built on an authorized local machine and are not published by CI.
