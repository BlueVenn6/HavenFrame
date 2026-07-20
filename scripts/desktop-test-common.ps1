$ErrorActionPreference = "Stop"

function Get-DesktopTestLayout {
    $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
    $runtimeRoot = Join-Path $repoRoot "manual-acceptance\runtime"
    return [pscustomobject]@{
        RepoRoot = $repoRoot
        RuntimeRoot = $runtimeRoot
        DataRoot = Join-Path $runtimeRoot "data"
        WorkspaceRoot = Join-Path $runtimeRoot "workspace"
        LogRoot = Join-Path $runtimeRoot "logs"
        StatePath = Join-Path $runtimeRoot "processes.json"
        BackendPort = 8001
        FrontendPort = 5174
        BackendUrl = "http://127.0.0.1:8001"
        FrontendUrl = "http://127.0.0.1:5174"
    }
}

function Initialize-DesktopTestLayout($layout) {
    @(
        $layout.RuntimeRoot,
        $layout.DataRoot,
        $layout.WorkspaceRoot,
        (Join-Path $layout.WorkspaceRoot "projects"),
        (Join-Path $layout.WorkspaceRoot "outputs"),
        (Join-Path $layout.WorkspaceRoot "logs"),
        (Join-Path $layout.WorkspaceRoot "cache"),
        (Join-Path $layout.WorkspaceRoot "temp"),
        $layout.LogRoot
    ) | ForEach-Object { New-Item -ItemType Directory -Path $_ -Force | Out-Null }
}

function Read-DesktopTestState($layout) {
    if (-not (Test-Path -LiteralPath $layout.StatePath)) { return $null }
    try {
        return Get-Content -LiteralPath $layout.StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        throw "The managed process state is invalid: $($layout.StatePath). No process was stopped."
    }
}

function Write-DesktopTestState($layout, $state) {
    $state | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $layout.StatePath -Encoding UTF8
}

function Get-ListenerPid([int]$port) {
    $pattern = "^\s*TCP\s+127\.0\.0\.1:$port\s+\S+\s+LISTENING\s+(\d+)\s*$"
    foreach ($line in (& netstat -ano -p TCP)) {
        if ($line -match $pattern) { return [int]$Matches[1] }
    }
    return $null
}

function Get-ProcessDetails([int]$processId) {
    try {
        return Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop
    } catch {
        return $null
    }
}

function Test-ManagedRoot($record) {
    if (-not $record -or -not $record.pid -or -not $record.launcher) { return $false }
    $process = Get-ProcessDetails ([int]$record.pid)
    if (-not $process) { return $false }
    return ($process.CommandLine -like "*$($record.launcher)*")
}

function Test-ManagedDesktopUi($record) {
    if (-not $record -or -not $record.ui_pid) { return $false }
    $process = Get-ProcessDetails ([int]$record.ui_pid)
    $executablePath = if ($process -and $process.ExecutablePath) { [string]$process.ExecutablePath } else {
        try { [string](Get-Process -Id ([int]$record.ui_pid) -ErrorAction Stop).Path } catch { "" }
    }
    if (-not $executablePath) { return $false }
    $expected = if ($record.ui_executable) {
        [string]$record.ui_executable
    } elseif ($record.launcher) {
        $repoRoot = Split-Path (Split-Path ([string]$record.launcher) -Parent) -Parent
        Join-Path $repoRoot "app\src-tauri\target\debug\interior-ai-studio.exe"
    } else {
        return $false
    }
    return ([IO.Path]::GetFullPath($executablePath) -eq [IO.Path]::GetFullPath($expected))
}

function Stop-ManagedRoot($record) {
    if (-not $record -or -not $record.pid) { return }
    $process = Get-ProcessDetails ([int]$record.pid)
    if ($process) {
        if (-not (Test-ManagedRoot $record)) {
            throw "PID $($record.pid) exists but does not match the registered project launcher. Refusing to stop it."
        }
        & taskkill.exe /F /T /PID ([string]$record.pid) | Out-Null
        return
    }
    if (Test-ManagedDesktopUi $record) {
        Stop-Process -Id ([int]$record.ui_pid) -Force
        return
    }
    $uiStillExists = if ($record.ui_pid) { Get-Process -Id ([int]$record.ui_pid) -ErrorAction SilentlyContinue } else { $null }
    if ($uiStillExists) {
        throw "Desktop UI PID $($record.ui_pid) exists but its executable does not match this repository. Refusing to stop it."
    }
}

function Wait-HttpOk([string]$url, [int]$timeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    do {
        if (Test-RawHttp200 $url) { return $true }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Test-RawHttp200([string]$url) {
    $uri = [Uri]$url
    $port = if ($uri.IsDefaultPort) { 80 } else { $uri.Port }
    $path = if ([string]::IsNullOrEmpty($uri.PathAndQuery)) { "/" } else { $uri.PathAndQuery }
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect($uri.Host, $port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(2000)) { return $false }
        $client.EndConnect($async)
        $stream = $client.GetStream()
        $stream.ReadTimeout = 3000
        $request = [Text.Encoding]::ASCII.GetBytes("GET $path HTTP/1.1`r`nHost: $($uri.Host):$port`r`nConnection: close`r`n`r`n")
        $stream.Write($request, 0, $request.Length)
        $buffer = New-Object byte[] 1024
        $count = $stream.Read($buffer, 0, $buffer.Length)
        if ($count -le 0) { return $false }
        $response = [Text.Encoding]::ASCII.GetString($buffer, 0, $count)
        return $response -match '^HTTP/1\.[01] 200 '
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Get-HealthStatus([string]$url) {
    try {
        $response = Invoke-RestMethod -Uri "$url/health" -TimeoutSec 3
        return ($response.status -eq "ok")
    } catch {
        return $false
    }
}

function Assert-PortAvailableOrManaged([int]$port, $record) {
    $listenerPid = Get-ListenerPid $port
    if (-not $listenerPid) { return }
    if ($record -and (Test-ManagedRoot $record)) { return }
    $process = Get-ProcessDetails $listenerPid
    $path = if ($process) { $process.ExecutablePath } else { "unknown" }
    $command = if ($process) { $process.CommandLine } else { "unavailable" }
    throw "Port $port belongs to an unmanaged process. PID=$listenerPid, executable=$path, command=$command. No process was stopped."
}

function Start-ManagedPowerShell([string]$launcher, [string[]]$launcherArguments, [string]$stdout, [string]$stderr) {
    $quotedLauncher = '"' + $launcher + '"'
    $argumentList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $quotedLauncher) + $launcherArguments
    return Start-Process -FilePath "powershell.exe" -ArgumentList $argumentList -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
}

function Show-LogTail([string]$path) {
    if (Test-Path -LiteralPath $path) {
        Write-Host "---- $path ----"
        Get-Content -LiteralPath $path -Tail 30
    }
}
