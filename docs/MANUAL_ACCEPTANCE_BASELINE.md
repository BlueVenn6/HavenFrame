# Windows 人工验收基线

记录日期：2026-07-11（Asia/Tokyo）

## Git 与发布基线

- 分支：`master`
- HEAD：`3ae7c557dab327fe7d7f96eed85b27bb4a049a7c`
- 初始工作树：干净（`git status --porcelain` 无输出）
- 最近六个逻辑提交：`846fab0`、`7f8cf1f`、`2960e86`、`dc5fc62`、`2f1e893`、`3ae7c55`
- 审计标签：`pre-release-audit-head-20260710`，当前指向 `7ab0d720e2c0c80a713000f0b4029196325e672d`，并非当前 HEAD
- stash：`stash@{0}: pre-release-audit-baseline-2026-07-10`
- 未执行 reset、restore、stash apply、历史重写或 workspace 清理

## Windows 与构建产物

- 操作系统：Windows 11 Home `10.0.26200`
- 架构：ARM64
- Node：`v20.20.0`
- npm：`10.8.2`
- Python：`3.12.10`
- Rust：`rustc 1.95.0` / `cargo 1.95.0`
- NSIS：`app/src-tauri/target/aarch64-pc-windows-msvc/release/bundle/nsis/栖构_0.1.0-rc.2_arm64-setup.exe`
- NSIS 大小：40,745,335 bytes
- 后端 sidecar：`app/src-tauri/target/aarch64-pc-windows-msvc/release/qigou-backend-sidecar.exe`
- sidecar 大小：39,059,283 bytes

`app/src-tauri/target/` 是被 Git 忽略的本机构建目录。安装包存在不等于本轮已完成人工 GUI 验收。

## 5174 故障基线

- 2026-07-11 调查时 `127.0.0.1:5174` 无监听，因此浏览器返回 `ERR_CONNECTION_REFUSED`。
- 上一轮 Vite PID `26884` 已退出。
- `127.0.0.1:8001` 仍由 PID `29492` 监听；命令行确认为本仓库上一轮启动的 `python -m uvicorn backend.main:app --host 127.0.0.1 --port 8001`。
- `127.0.0.1:8000` 调查时无监听；上一轮报告的旧端口冲突在本次检查时已不存在，未终止任何 8000 占用者。
- 根因是上一轮使用临时后台进程，没有持久 PID 所有权记录。前端进程消失后，旧后端独立残留，环境不再成套运行。

## 本轮正式测试入口

- 主测试模式：Tauri desktop development mode（真实 Windows 桌面窗口）
- 前端诊断 URL：`http://127.0.0.1:5174`
- 后端 URL：`http://127.0.0.1:8001`
- 后端健康检查：`http://127.0.0.1:8001/health`
- 后端入口：`backend.main:app`
- 前端入口：`app/src/main.tsx`
- Tauri 入口：`app/src-tauri/src/main.rs`

## 三种运行模式

| 模式 | 入口 | 数据边界 | 本轮状态 |
|---|---|---|---|
| 浏览器诊断模式 | `http://127.0.0.1:5174`（Vite preview） | 人工验收隔离目录 | 由启动器先构建再托管静态产物，不是主要交付界面 |
| Tauri 桌面开发模式 | `start_desktop_test.bat` 自动打开桌面窗口 | 人工验收隔离目录 | 本轮主要人工验收模式；窗口加载同一份已构建前端 |
| Windows 安装包 | ARM64 NSIS 安装后的 `栖构` | `%LOCALAPPDATA%\com.qigou.desktop` | 最接近正式发布；本轮不用于可删除 QA 数据，仍需后续安装后完整 GUI 验收 |

## 数据隔离

人工验收环境：

- 数据库：`manual-acceptance/runtime/data/interior_ai_studio.db`
- workspace：`manual-acceptance/runtime/workspace`
- 项目资产：`manual-acceptance/runtime/workspace/projects`
- 输出：`manual-acceptance/runtime/workspace/outputs`
- 缓存和临时文件：`manual-acceptance/runtime/workspace/cache`、`manual-acceptance/runtime/workspace/temp`
- 进程记录：`manual-acceptance/runtime/processes.json`
- 启动日志：`manual-acceptance/runtime/logs`
- 样例输入：`manual-acceptance/fixtures`

正式/正常数据位置：

- 源码默认数据库：`backend/data/interior_ai_studio.db`
- 源码默认 workspace：`workspace/`
- 安装版数据：`%LOCALAPPDATA%\com.qigou.desktop\data` 与 `%LOCALAPPDATA%\com.qigou.desktop\workspace`

可以放心停止并删除后重新测试的目录只有 `manual-acceptance/runtime/`。它已加入 `.gitignore`。`manual-acceptance/fixtures/` 是受版本控制的验收输入，不属于运行数据。

## 凭据边界

验收启动器设置 `INTERIOR_AI_STUDIO_SKIP_LOCAL_ENV=1`，不会读取仓库 `.env`，也不会把正常环境的 Provider 配置复制进 QA 数据库。需要 Live 验证时，必须在人工验收环境的模型设置页手工配置真实凭据。没有凭据的项目必须记录为 `BLOCKED_BY_CREDENTIALS`。

## 本阶段实际验证

- `npm run build`：通过；最终启动器也会先构建再启动 Vite preview。
- `cargo check --manifest-path app/src-tauri/Cargo.toml`：通过。
- `python -m pytest backend/tests -q`：`155 passed`，未调用付费 Provider。
- Tauri 窗口：标题“栖构”，Windows 进程状态 `Responding=True`。
- 前端：最终连续三次 HTTP 200，响应约 0.33、0.21、0.14 秒。
- 后端：最终连续三次 `/health` 均为 `status=ok`。
- 本地部署状态接口：backend `running`，地址 `http://127.0.0.1:8001`。
- 端口 8000：最终无监听；未终止任何 8000 占用者。
- 安全停止：按登记的三棵父子进程树停止后，4 个非本项目 Node/Python PID 全部保留，5174/8001 监听归零。
- 重启持久化：数据库保留，样例项目保持唯一一条；启动器用隔离数据目录内的 seed 标记避免重复创建。
- 当前环境在交付时保持运行；状态以 `desktop_test_status.bat` 的实时输出为准。

ARM64 首次或源码变更后的启动需要完成前端构建和 Tauri 开发编译，实测可能接近 3 分钟。启动器分别为前端和 Tauri 保留 5 分钟等待预算，并在失败时打印对应日志后只停止自己登记的进程。
