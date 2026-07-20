$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$AppDir = Join-Path $Root "app"
$BackendHealthUrl = "http://127.0.0.1:8010/health"
$FrontendUrl = "http://127.0.0.1:5173"
$ReleaseExe = Join-Path $AppDir "src-tauri\target\release\interior-ai-studio.exe"
$DebugExe = Join-Path $AppDir "src-tauri\target\debug\interior-ai-studio.exe"
$LegacyDebugExe = Join-Path $AppDir "src-tauri\target\debug\havenframe-cn.exe"

function Test-UrlOk {
  param([string]$Url)

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Wait-ForUrl {
  param(
    [string]$Url,
    [int]$Attempts = 30
  )

  for ($index = 0; $index -lt $Attempts; $index += 1) {
    if (Test-UrlOk -Url $Url) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  }

  return $false
}

function Start-BackendIfNeeded {
  if (Test-UrlOk -Url $BackendHealthUrl) {
    return
  }

  Start-Process -FilePath "python" `
    -ArgumentList @("-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "8010") `
    -WorkingDirectory $Root `
    -WindowStyle Hidden

  if (-not (Wait-ForUrl -Url $BackendHealthUrl -Attempts 30)) {
    Write-Warning "FastAPI backend did not answer $BackendHealthUrl. The desktop window can still open, but API functions may fail."
  }
}

function Start-FrontendIfNeeded {
  if (Test-UrlOk -Url $FrontendUrl) {
    return
  }

  Start-Process -FilePath "npm.cmd" `
    -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", "5173", "--strictPort") `
    -WorkingDirectory $AppDir `
    -WindowStyle Hidden

  if (-not (Wait-ForUrl -Url $FrontendUrl -Attempts 60)) {
    throw "Vite frontend did not answer $FrontendUrl."
  }
}

function Build-DesktopIfNeeded {
  if (Test-Path $ReleaseExe) {
    return
  }

  Push-Location $AppDir
  try {
    npm run desktop:build
  } finally {
    Pop-Location
  }

  if (-not (Test-Path $ReleaseExe)) {
    throw "Desktop executable was not created at $ReleaseExe."
  }
}

Start-BackendIfNeeded

if (Test-Path $ReleaseExe) {
  Start-Process -FilePath $ReleaseExe -WorkingDirectory (Split-Path -Parent $ReleaseExe)
  exit 0
}

if (Test-Path $DebugExe) {
  Start-FrontendIfNeeded
  Start-Process -FilePath $DebugExe -WorkingDirectory (Split-Path -Parent $DebugExe)
  exit 0
}

if (Test-Path $LegacyDebugExe) {
  Start-FrontendIfNeeded
  Start-Process -FilePath $LegacyDebugExe -WorkingDirectory (Split-Path -Parent $LegacyDebugExe)
  exit 0
}

Build-DesktopIfNeeded
Start-Process -FilePath $ReleaseExe -WorkingDirectory (Split-Path -Parent $ReleaseExe)
