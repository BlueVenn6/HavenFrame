param(
    [string]$InstallerPath = "",
    [string]$InstallDir = "",
    [string]$RuntimeDir = "",
    [string]$ResultPath = "",
    [switch]$SkipUninstall
)

$ErrorActionPreference = "Stop"

function Resolve-RequiredPath {
    param([string]$PathValue, [string]$Label)
    if (-not $PathValue) {
        throw "$Label is required."
    }
    $resolved = Resolve-Path -LiteralPath $PathValue -ErrorAction Stop
    return $resolved.Path
}

function Assert-TempPath {
    param([string]$PathValue)
    $full = [System.IO.Path]::GetFullPath($PathValue)
    $temp = [System.IO.Path]::GetFullPath($env:TEMP)
    if (-not $full.StartsWith($temp, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove non-temp install directory: $full"
    }
    if ($full -notmatch "havenframe|qigou|interior") {
        throw "Refusing to remove temp path without expected validation marker: $full"
    }
}

function Invoke-JsonGet {
    param([string]$Url, [hashtable]$Headers = @{})
    return Invoke-RestMethod -Method Get -Uri $Url -Headers $Headers -TimeoutSec 10
}

function Get-SidecarCount {
    param([string]$SidecarPath)
    $processes = Get-CimInstance Win32_Process -Filter "Name = 'qigou-backend-sidecar.exe'" -ErrorAction SilentlyContinue
    if (-not $processes) { return 0 }
    $matching = if ($SidecarPath) {
        @($processes | Where-Object { $_.ExecutablePath -eq $SidecarPath })
    } else {
        @($processes)
    }
    $matchingIds = @($matching | ForEach-Object { [int]$_.ProcessId })
    return @($matching | Where-Object { [int]$_.ParentProcessId -notin $matchingIds }).Count
}

function Wait-Health {
    param([int]$Seconds = 180)
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        try {
            $health = Invoke-JsonGet "http://127.0.0.1:8010/health"
            if (
                $health.status -eq "ok" -and
                $health.service_id -eq "com.havenframe.desktop.backend" -and
                $health.api_contract_version -eq "2026-07-13-model-persistence-v1"
            ) {
                return $true
            }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Wait-SidecarStopped {
    param([string]$SidecarPath, [int]$Seconds = 20)
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        if ((Get-SidecarCount $SidecarPath) -eq 0) {
            return $true
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    return $false
}

if (-not $InstallerPath) {
    $package = Get-Content -LiteralPath (Join-Path (Get-Location) "app\package.json") -Raw | ConvertFrom-Json
    $releaseVersion = [string]$package.version
    $bundleDir = Join-Path (Get-Location) "app\src-tauri\target\aarch64-pc-windows-msvc\release\bundle\nsis"
    $installers = @(Get-ChildItem -LiteralPath $bundleDir -Filter "*_$($releaseVersion)_arm64-setup.exe" -File)
    if ($installers.Count -ne 1) {
        throw "Expected exactly one bilingual $releaseVersion ARM64 installer in $bundleDir, found $($installers.Count)."
    }
    $InstallerPath = $installers[0].FullName
}
if (-not $InstallDir) {
    $InstallDir = Join-Path $env:TEMP "havenframe-bilingual-validation"
}
if (-not $RuntimeDir) {
    $RuntimeDir = Join-Path $env:TEMP "havenframe-bilingual-runtime"
}
if (-not $ResultPath) {
    $ResultPath = Join-Path $env:TEMP "havenframe-bilingual-validation-result.json"
}

$installer = Resolve-RequiredPath $InstallerPath "InstallerPath"
$installDirFull = [System.IO.Path]::GetFullPath($InstallDir)
$runtimeDirFull = [System.IO.Path]::GetFullPath($RuntimeDir)
$resultFull = [System.IO.Path]::GetFullPath($ResultPath)

Assert-TempPath $installDirFull
Assert-TempPath $runtimeDirFull
if (Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 8010 -State Listen -ErrorAction SilentlyContinue) {
    throw "Port 8010 is already in use. Refusing to validate against a pre-existing backend."
}
if (Test-Path -LiteralPath $installDirFull) {
    Remove-Item -LiteralPath $installDirFull -Recurse -Force
}
New-Item -ItemType Directory -Path $installDirFull -Force | Out-Null
if (Test-Path -LiteralPath $runtimeDirFull) {
    Remove-Item -LiteralPath $runtimeDirFull -Recurse -Force
}
New-Item -ItemType Directory -Path $runtimeDirFull -Force | Out-Null

$startedAt = Get-Date
$installProcess = Start-Process -FilePath $installer -ArgumentList @("/S", "/D=$installDirFull") -Wait -PassThru -WindowStyle Hidden
if ($installProcess.ExitCode -ne 0) {
    throw "Installer failed with exit code $($installProcess.ExitCode)."
}

$appExe = Join-Path $installDirFull "interior-ai-studio.exe"
$sidecarExe = Join-Path $installDirFull "qigou-backend-sidecar.exe"
$uninstaller = Join-Path $installDirFull "uninstall.exe"
foreach ($required in @($appExe, $sidecarExe, $uninstaller)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Installed file missing: $required"
    }
}

$previousAppDataDir = $env:QIGOU_APP_DATA_DIR
$previousWorkspaceDir = $env:QIGOU_WORKSPACE_DIR
try {
    $env:QIGOU_APP_DATA_DIR = $runtimeDirFull
    $env:QIGOU_WORKSPACE_DIR = Join-Path $runtimeDirFull "workspace"
    $appProcess = Start-Process -FilePath $appExe -PassThru
} finally {
    $env:QIGOU_APP_DATA_DIR = $previousAppDataDir
    $env:QIGOU_WORKSPACE_DIR = $previousWorkspaceDir
}
$healthReady = Wait-Health
if (-not $healthReady) {
    throw "Installed app did not expose the expected current-version backend on 127.0.0.1:8010."
}
$firstReadySeconds = [Math]::Round(((Get-Date) - $startedAt).TotalSeconds, 2)

$session = Invoke-JsonGet "http://127.0.0.1:8010/api/security/session"
$headers = @{ "X-Qigou-Local-Token" = $session.token }
$capabilities = Invoke-JsonGet -Url "http://127.0.0.1:8010/api/platform/capabilities" -Headers $headers
if ($capabilities.PSObject.Properties.Name -contains "local_deployment" -or $capabilities.PSObject.Properties.Name -contains "local_renderer") {
    throw "Release package exposed removed desktop deployment capability fields."
}
if ($capabilities.cloud_api) {
    throw "Release package unexpectedly enabled the cloud-server profile."
}
if (-not $capabilities.local_file_open) {
    throw "Release package lost desktop project and asset file access."
}
foreach ($removedPath in @("/api/local/status", "/api/render-engines")) {
    try {
        Invoke-WebRequest -Uri "http://127.0.0.1:8010$removedPath" -Headers $headers -UseBasicParsing -ErrorAction Stop | Out-Null
        throw "Removed local-deployment route is still exposed: $removedPath"
    } catch {
        if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
    }
}

$sidecarCountBeforeClose = Get-SidecarCount $sidecarExe
if ($sidecarCountBeforeClose -ne 1) {
    throw "Expected exactly one installed sidecar process, found $sidecarCountBeforeClose."
}
$closed = $appProcess.CloseMainWindow()
Start-Sleep -Seconds 8
if (-not $appProcess.HasExited) {
    Stop-Process -Id $appProcess.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2
$sidecarCountAfterClose = Get-SidecarCount $sidecarExe
if ($sidecarCountAfterClose -ne 0) {
    throw "Installed sidecar was still running after the desktop app closed."
}

try {
    $env:QIGOU_APP_DATA_DIR = $runtimeDirFull
    $env:QIGOU_WORKSPACE_DIR = Join-Path $runtimeDirFull "workspace"
    $forcedExitApp = Start-Process -FilePath $appExe -PassThru
} finally {
    $env:QIGOU_APP_DATA_DIR = $previousAppDataDir
    $env:QIGOU_WORKSPACE_DIR = $previousWorkspaceDir
}
if (-not (Wait-Health)) {
    throw "Installed app did not restart the expected backend for forced-exit validation."
}
$sidecarCountBeforeForcedExit = Get-SidecarCount $sidecarExe
if ($sidecarCountBeforeForcedExit -ne 1) {
    throw "Expected one sidecar instance before forced GUI exit, found $sidecarCountBeforeForcedExit."
}
Stop-Process -Id $forcedExitApp.Id -Force -ErrorAction Stop
$forcedExitStartedAt = Get-Date
if (-not (Wait-SidecarStopped -SidecarPath $sidecarExe -Seconds 45)) {
    throw "Installed sidecar remained after the desktop GUI process was forcibly terminated."
}
$forcedExitReleaseSeconds = [Math]::Round(((Get-Date) - $forcedExitStartedAt).TotalSeconds, 2)
$sidecarCountAfterForcedExit = Get-SidecarCount $sidecarExe

$uninstallExitCode = $null
if (-not $SkipUninstall) {
    $uninstallProcess = Start-Process -FilePath $uninstaller -ArgumentList @("/S") -Wait -PassThru -WindowStyle Hidden
    $uninstallExitCode = $uninstallProcess.ExitCode
}

$payload = [ordered]@{
    installer = $installer
    install_dir = $installDirFull
    user_data_dir = $runtimeDirFull
    sidecar_process_name = "qigou-backend-sidecar.exe"
    first_ready_seconds = $firstReadySeconds
    sidecar_count_before_close = $sidecarCountBeforeClose
    close_main_window = $closed
    sidecar_count_after_close = $sidecarCountAfterClose
    sidecar_count_before_forced_exit = $sidecarCountBeforeForcedExit
    sidecar_count_after_forced_exit = $sidecarCountAfterForcedExit
    forced_exit_release_seconds = $forcedExitReleaseSeconds
    uninstall_exit_code = $uninstallExitCode
    install_dir_exists_after_uninstall = Test-Path -LiteralPath $installDirFull
    user_data_dir_exists = Test-Path -LiteralPath $runtimeDirFull
}

$payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultFull -Encoding UTF8
$payload | ConvertTo-Json -Depth 8
