$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "desktop-test-common.ps1")

$layout = Get-DesktopTestLayout
$state = Read-DesktopTestState $layout
if (-not $state) {
    Write-Host "No managed process state exists. No process was stopped."
    exit 0
}

try {
    foreach ($name in @("desktop", "frontend", "backend")) {
        $record = $state.processes.$name
        if ($record -and ((Test-ManagedRoot $record) -or ($name -eq "desktop" -and (Test-ManagedDesktopUi $record)))) {
            Write-Host "Stopping managed $name process tree at root PID $($record.pid)..."
            Stop-ManagedRoot $record
        } elseif ($record) {
            Write-Host "$name root PID $($record.pid) already exited. No other process was touched."
        }
    }
    Remove-Item -LiteralPath $layout.StatePath -Force -ErrorAction SilentlyContinue
    Write-Host "The manual acceptance environment is stopped. Database and workspace are preserved."
} catch {
    Write-Host "Safe stop failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "The state file was preserved for review: $($layout.StatePath)"
    exit 1
}
