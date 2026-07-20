# 本地部署测试计划

## 无 GPU 电脑

1. 启动或检查后端：
   ```powershell
   python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
   ```
2. 运行 smoke：
   ```powershell
   python scripts/smoke-local-deploy.py
   ```
3. 验证结果：
   - 输出 `PASS local deployment smoke test`。
   - `/api/local/jobs/{job_id}` 返回 `success`。
   - `workspace/outputs/project-demo/` 产生 PNG。
   - `workspace/logs/mock-renderer/` 产生任务日志。
   - 桌面底部任务队列能看到 Mock Renderer 任务。

## 有 GPU 电脑

1. 先运行无 GPU 测试，确认基础链路可用。
2. 安装对应真实引擎依赖。
3. 在本地部署页启用 Diffusers Worker 或外部引擎。
4. 点击“测试连接”，确认状态从 `unknown/unconfigured/disabled` 变为 `ready` 或明确 `failed`。
5. 只有 `ready/running` 引擎允许设为默认。

## ComfyUI

1. 启动 ComfyUI API，默认端口 `http://127.0.0.1:8188`。
2. 在本地部署页配置 ComfyUI Base URL。
3. 点击“测试连接”。
4. 通过条件：`/object_info` 或 `/prompt` 返回符合 ComfyUI API 特征，状态为 `ready`。

## Automatic1111 / Forge

1. 启动 WebUI API，默认端口 `http://127.0.0.1:7860`。
2. 确认 API 模式开启。
3. 点击“测试连接”。
4. 通过条件：`/sdapi/v1/options` 或 `/docs` 返回符合 SD WebUI API 特征，状态为 `ready`。

## InvokeAI

1. 启动 InvokeAI API，默认端口 `http://127.0.0.1:9090`。
2. 点击“测试连接”。
3. 通过条件：版本或 docs 接口返回 InvokeAI 特征，状态为 `ready`。

## Diffusers Worker

1. 安装 `torch` 和 `diffusers`。
2. 配置模型目录。
3. 启用并点击“测试连接”。
4. 当前测试只验证 Python 依赖和路径，不自动调用真实模型。

## 任务队列

1. 仅在源码开发环境设置 `QIGOU_ENABLE_TEST_RENDERER=1`，再提交明确标记为测试的渲染任务。
2. 底部任务队列应显示 `queued -> running -> success`。
3. 点击“模拟失败任务”。
4. 底部任务队列应显示 `queued -> running -> failed`。
5. 刷新页面后，任务仍可通过 `/api/tasks` 和 `/api/local/jobs/{job_id}` 查询。

## 本地归档

1. 成功 Mock 任务完成后检查：
   ```powershell
   Get-ChildItem workspace\outputs -Recurse -Filter *.png | Sort-Object LastWriteTime -Descending | Select-Object -First 5
   ```
2. 检查日志：
   ```powershell
   Get-ChildItem workspace\logs\mock-renderer -Filter *.log | Sort-Object LastWriteTime -Descending | Select-Object -First 5
   ```
3. API 检查：
   ```powershell
   Invoke-RestMethod http://127.0.0.1:8000/api/local/archive
   Invoke-RestMethod http://127.0.0.1:8000/api/local/logs
   ```

## 测试命令

后端测试：
```powershell
python -m pytest backend/tests -q
```

本地部署子集：
```powershell
python -m pytest backend/tests/test_api_smoke.py -q -k "local_runtime or renderer_engine or mock_renderer or local_mock"
```

前端构建：
```powershell
cd app
npm run build
```

前端本地部署页静态契约测试：
```powershell
cd app
npm run test:local-deploy
```

Smoke test：
```powershell
python scripts/smoke-local-deploy.py
```
