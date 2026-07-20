param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string]$RuntimeRoot,
    [Parameter(Mandatory = $true)][int]$FrontendPort,
    [Parameter(Mandatory = $true)][int]$BackendPort
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath (Join-Path $RepoRoot "app")
$env:INTERIOR_AI_STUDIO_SKIP_LOCAL_ENV = "1"
$env:QIGOU_API_PROFILE = "desktop_client"
$env:QIGOU_API_PORT = [string]$BackendPort
$env:QIGOU_FRONTEND_PORT = [string]$FrontendPort
$env:QIGOU_APP_DATA_DIR = $RuntimeRoot
$env:QIGOU_WORKSPACE_DIR = Join-Path $RuntimeRoot "workspace"
$env:VITE_API_BASE_URL = "http://127.0.0.1:$BackendPort"
& npm.cmd run desktop:dev -- --config src-tauri/tauri.dev-5174.conf.json
exit $LASTEXITCODE
