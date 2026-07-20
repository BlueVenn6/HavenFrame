param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][int]$FrontendPort,
    [Parameter(Mandatory = $true)][int]$BackendPort
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath (Join-Path $RepoRoot "app")
$env:VITE_API_BASE_URL = "http://127.0.0.1:$BackendPort"
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& npm.cmd run preview -- --host 127.0.0.1 --port $FrontendPort --strictPort
exit $LASTEXITCODE
