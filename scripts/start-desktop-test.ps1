$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "desktop-test-common.ps1")

$layout = Get-DesktopTestLayout
Initialize-DesktopTestLayout $layout

Write-Host "Qigou Windows manual acceptance environment"
Write-Host "Repository: $($layout.RepoRoot)"
Write-Host "Isolated data: $($layout.RuntimeRoot)"

foreach ($command in @("python", "node", "npm", "cargo", "rustc")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Missing dependency: $command. Install it and add it to PATH."
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $layout.RepoRoot "app\node_modules\.bin\vite.cmd"))) {
    throw "Frontend dependencies are missing. Run npm install in the app directory first."
}

$existingState = Read-DesktopTestState $layout
if ($existingState) {
    $backendManaged = Test-ManagedRoot $existingState.processes.backend
    $frontendManaged = Test-ManagedRoot $existingState.processes.frontend
    $desktopManaged = (Test-ManagedRoot $existingState.processes.desktop) -or (Test-ManagedDesktopUi $existingState.processes.desktop)
    if ($backendManaged -and $frontendManaged -and $desktopManaged -and
        (Get-HealthStatus $layout.BackendUrl) -and (Wait-HttpOk $layout.FrontendUrl 3)) {
        Write-Host "The manual acceptance environment is already running."
        Write-Host "Desktop: running"
        Write-Host "Frontend: $($layout.FrontendUrl)"
        Write-Host "Backend: $($layout.BackendUrl)/health"
        exit 0
    }
    foreach ($name in @("desktop", "frontend", "backend")) {
        $record = $existingState.processes.$name
        if ($record -and ((Test-ManagedRoot $record) -or ($name -eq "desktop" -and (Test-ManagedDesktopUi $record)))) { Stop-ManagedRoot $record }
    }
    Remove-Item -LiteralPath $layout.StatePath -Force -ErrorAction SilentlyContinue
}

Assert-PortAvailableOrManaged $layout.BackendPort $null
Assert-PortAvailableOrManaged $layout.FrontendPort $null

$backendLauncher = Join-Path $layout.RepoRoot "scripts\run-manual-backend.ps1"
$frontendLauncher = Join-Path $layout.RepoRoot "scripts\run-manual-frontend.ps1"
$desktopLauncher = Join-Path $layout.RepoRoot "scripts\run-manual-tauri.ps1"
$state = [ordered]@{
    version = 1
    repo_root = $layout.RepoRoot
    created_at = (Get-Date).ToString("o")
    frontend_url = $layout.FrontendUrl
    backend_url = $layout.BackendUrl
    runtime_root = $layout.RuntimeRoot
    processes = [ordered]@{}
}

try {
    $backendOut = Join-Path $layout.LogRoot "backend.stdout.log"
    $backendErr = Join-Path $layout.LogRoot "backend.stderr.log"
    $backend = Start-ManagedPowerShell $backendLauncher @(
        "-RepoRoot", ('"' + $layout.RepoRoot + '"'),
        "-RuntimeRoot", ('"' + $layout.RuntimeRoot + '"'),
        "-Port", [string]$layout.BackendPort
    ) $backendOut $backendErr
    $state.processes.backend = [ordered]@{ pid = $backend.Id; launcher = $backendLauncher; stdout = $backendOut; stderr = $backendErr }
    Write-DesktopTestState $layout $state
    if (-not (Wait-HttpOk "$($layout.BackendUrl)/health" 60)) {
        Show-LogTail $backendErr
        throw "Backend health did not pass within 60 seconds."
    }
    $state.processes.backend.listener_pid = Get-ListenerPid $layout.BackendPort
    Write-DesktopTestState $layout $state

    $session = Invoke-RestMethod -Uri "$($layout.BackendUrl)/api/security/session" -SessionVariable qaSession -TimeoutSec 5
    $headers = @{ "X-Qigou-Local-Token" = $session.token }
    $seedMarker = Join-Path $layout.DataRoot "sample-project-seeded"
    $projectFixture = Join-Path $layout.RepoRoot "manual-acceptance\fixtures\sample-project.json"
    $project = Get-Content -LiteralPath $projectFixture -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not (Test-Path -LiteralPath $seedMarker)) {
        $body = [Text.Encoding]::UTF8.GetBytes(($project | ConvertTo-Json))
        Invoke-RestMethod -Uri "$($layout.BackendUrl)/api/projects" -Method Post -Headers $headers -WebSession $qaSession -ContentType "application/json; charset=utf-8" -Body $body -TimeoutSec 10 | Out-Null
        (Get-Date).ToString("o") | Set-Content -LiteralPath $seedMarker -Encoding ASCII
    }

    $frontendOut = Join-Path $layout.LogRoot "frontend.stdout.log"
    $frontendErr = Join-Path $layout.LogRoot "frontend.stderr.log"
    $frontend = Start-ManagedPowerShell $frontendLauncher @(
        "-RepoRoot", ('"' + $layout.RepoRoot + '"'),
        "-FrontendPort", [string]$layout.FrontendPort,
        "-BackendPort", [string]$layout.BackendPort
    ) $frontendOut $frontendErr
    $state.processes.frontend = [ordered]@{ pid = $frontend.Id; launcher = $frontendLauncher; stdout = $frontendOut; stderr = $frontendErr }
    Write-DesktopTestState $layout $state
    if (-not (Wait-HttpOk $layout.FrontendUrl 300)) {
        Show-LogTail $frontendErr
        Show-LogTail $frontendOut
        throw "Frontend build/preview did not serve an HTTP page within five minutes."
    }
    $state.processes.frontend.listener_pid = Get-ListenerPid $layout.FrontendPort
    Write-DesktopTestState $layout $state

    $desktopOut = Join-Path $layout.LogRoot "desktop.stdout.log"
    $desktopErr = Join-Path $layout.LogRoot "desktop.stderr.log"
    $desktop = Start-ManagedPowerShell $desktopLauncher @(
        "-RepoRoot", ('"' + $layout.RepoRoot + '"'),
        "-RuntimeRoot", ('"' + $layout.RuntimeRoot + '"'),
        "-FrontendPort", [string]$layout.FrontendPort,
        "-BackendPort", [string]$layout.BackendPort
    ) $desktopOut $desktopErr
    $state.processes.desktop = [ordered]@{ pid = $desktop.Id; launcher = $desktopLauncher; stdout = $desktopOut; stderr = $desktopErr }
    Write-DesktopTestState $layout $state

    $desktopExe = Join-Path $layout.RepoRoot "app\src-tauri\target\debug\interior-ai-studio.exe"
    $deadline = (Get-Date).AddMinutes(5)
    $desktopUi = $null
    do {
        if (-not (Test-ManagedRoot $state.processes.desktop)) { break }
        $desktopUi = Get-CimInstance Win32_Process -Filter "Name = 'interior-ai-studio.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.ExecutablePath -eq $desktopExe } | Select-Object -First 1
        if ($desktopUi) { break }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)
    if (-not $desktopUi) {
        Show-LogTail $desktopErr
        Show-LogTail $desktopOut
        throw "The Tauri desktop process did not start within five minutes."
    }
    $state.processes.desktop.ui_pid = $desktopUi.ProcessId
    $state.processes.desktop.ui_executable = $desktopExe
    Write-DesktopTestState $layout $state

    Write-Host ""
    Write-Host "Manual acceptance environment started successfully."
    Write-Host "Tauri desktop PID: $($desktopUi.ProcessId)"
    Write-Host "Frontend: $($layout.FrontendUrl)"
    Write-Host "Backend: $($layout.BackendUrl)/health"
    Write-Host "Database: $(Join-Path $layout.DataRoot 'interior_ai_studio.db')"
    Write-Host "Workspace: $($layout.WorkspaceRoot)"
    Write-Host "Logs: $($layout.LogRoot)"
} catch {
    Write-Host "Startup failed: $($_.Exception.Message)" -ForegroundColor Red
    $currentState = Read-DesktopTestState $layout
    if ($currentState) {
        foreach ($name in @("desktop", "frontend", "backend")) {
            $record = $currentState.processes.$name
            if ($record -and (Test-ManagedRoot $record)) { Stop-ManagedRoot $record }
        }
        Remove-Item -LiteralPath $layout.StatePath -Force -ErrorAction SilentlyContinue
    }
    exit 1
}
