param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string]$RuntimeRoot,
    [Parameter(Mandatory = $true)][int]$Port
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $RepoRoot
$env:INTERIOR_AI_STUDIO_SKIP_LOCAL_ENV = "1"
$env:QIGOU_API_PROFILE = "desktop_client"
$env:QIGOU_API_HOST = "127.0.0.1"
$env:QIGOU_API_PORT = [string]$Port
$env:QIGOU_FRONTEND_PORT = "5174"
$env:QIGOU_APP_DATA_DIR = $RuntimeRoot
$env:QIGOU_WORKSPACE_DIR = Join-Path $RuntimeRoot "workspace"
$env:QIGOU_ALLOWED_ORIGINS = "http://127.0.0.1:5174,http://localhost:5174"

& python -m uvicorn backend.main:app --host 127.0.0.1 --port $Port
exit $LASTEXITCODE
