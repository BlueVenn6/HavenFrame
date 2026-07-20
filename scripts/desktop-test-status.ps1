$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "desktop-test-common.ps1")

$layout = Get-DesktopTestLayout
$state = Read-DesktopTestState $layout
$backendPid = Get-ListenerPid $layout.BackendPort
$frontendPid = Get-ListenerPid $layout.FrontendPort
$backendHealthy = Get-HealthStatus $layout.BackendUrl
$frontendHealthy = Wait-HttpOk $layout.FrontendUrl 3

Write-Host "Qigou Windows manual acceptance environment status"
Write-Host ""
Write-Host ("backend  : {0}" -f $(if ($backendHealthy) { "running" } else { "stopped/unhealthy" }))
Write-Host "  URL     : $($layout.BackendUrl)/health"
Write-Host "  port    : $($layout.BackendPort)"
Write-Host "  PID     : $(if ($backendPid) { $backendPid } else { '-' })"
Write-Host ("frontend : {0}" -f $(if ($frontendHealthy) { "running" } else { "stopped" }))
Write-Host "  URL     : $($layout.FrontendUrl)"
Write-Host "  port    : $($layout.FrontendPort)"
Write-Host "  PID     : $(if ($frontendPid) { $frontendPid } else { '-' })"

if ($state) {
    $desktopRunning = (Test-ManagedRoot $state.processes.desktop) -or (Test-ManagedDesktopUi $state.processes.desktop)
    Write-Host ("desktop  : {0}" -f $(if ($desktopRunning) { "running" } else { "stopped" }))
    Write-Host "  root PID: $(if ($state.processes.desktop.pid) { $state.processes.desktop.pid } else { '-' })"
    Write-Host "  UI PID  : $(if ($state.processes.desktop.ui_pid) { $state.processes.desktop.ui_pid } else { '-' })"
} else {
    Write-Host "desktop  : stopped (no managed state)"
}
Write-Host ""
Write-Host "log path : $($layout.LogRoot)"
Write-Host "database : $(Join-Path $layout.DataRoot 'interior_ai_studio.db')"
Write-Host "workspace: $($layout.WorkspaceRoot)"
