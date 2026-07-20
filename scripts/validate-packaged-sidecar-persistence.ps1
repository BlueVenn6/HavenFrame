param(
    [Parameter(Mandatory = $true)]
    [string]$SidecarPath,
    [string]$ResultPath = ""
)

$ErrorActionPreference = "Stop"
$sidecar = (Resolve-Path -LiteralPath $SidecarPath -ErrorAction Stop).Path
$runtimeRoot = Join-Path $env:TEMP ("qigou-sidecar-persistence-" + [guid]::NewGuid().ToString("N"))
$stdoutLog = Join-Path $runtimeRoot "sidecar.stdout.log"
$stderrLog = Join-Path $runtimeRoot "sidecar.stderr.log"
if (-not $ResultPath) {
    $ResultPath = Join-Path $env:TEMP "qigou-sidecar-persistence-result.json"
}
$resultFull = [System.IO.Path]::GetFullPath($ResultPath)
$sidecarProcess = $null
$sidecarPort = $null
$validationSucceeded = $false

function Get-FreeLoopbackPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try {
        return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    } finally {
        $listener.Stop()
    }
}

function Start-IsolatedSidecar {
    param([int]$Port)
    $script:sidecarPort = $Port
    $previous = @{
        INTERIOR_AI_STUDIO_SKIP_LOCAL_ENV = $env:INTERIOR_AI_STUDIO_SKIP_LOCAL_ENV
        QIGOU_APP_DATA_DIR = $env:QIGOU_APP_DATA_DIR
        QIGOU_WORKSPACE_DIR = $env:QIGOU_WORKSPACE_DIR
        QIGOU_API_HOST = $env:QIGOU_API_HOST
        QIGOU_API_PORT = $env:QIGOU_API_PORT
        INTERIOR_AI_STUDIO_DATABASE_URL = $env:INTERIOR_AI_STUDIO_DATABASE_URL
    }
    try {
        $env:INTERIOR_AI_STUDIO_SKIP_LOCAL_ENV = "1"
        $env:QIGOU_APP_DATA_DIR = $runtimeRoot
        $env:QIGOU_WORKSPACE_DIR = Join-Path $runtimeRoot "workspace"
        $env:QIGOU_API_HOST = "127.0.0.1"
        $env:QIGOU_API_PORT = [string]$Port
        Remove-Item -Path "Env:INTERIOR_AI_STUDIO_DATABASE_URL" -ErrorAction SilentlyContinue
        return Start-Process -FilePath $sidecar -ArgumentList @("--host", "127.0.0.1", "--port", [string]$Port) -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
    } finally {
        foreach ($name in $previous.Keys) {
            Set-Item -Path "Env:$name" -Value $previous[$name] -ErrorAction SilentlyContinue
            if ($null -eq $previous[$name]) {
                Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
            }
        }
    }
}

function Stop-IsolatedSidecar {
    if ($null -ne $script:sidecarProcess -and -not $script:sidecarProcess.HasExited) {
        $startedPid = $script:sidecarProcess.Id
        $taskkill = Start-Process -FilePath "taskkill.exe" -ArgumentList @("/F", "/T", "/PID", [string]$startedPid) -PassThru -Wait -WindowStyle Hidden
        if ($taskkill.ExitCode -ne 0 -and -not $script:sidecarProcess.HasExited) {
            Stop-Process -Id $startedPid -Force -ErrorAction SilentlyContinue
        }
        $script:sidecarProcess.WaitForExit(10000) | Out-Null
    }
    if ($null -ne $script:sidecarPort) {
        $escapedPath = [regex]::Escape($sidecar)
        $portPattern = "--port\s+$($script:sidecarPort)(\s|$)"
        $children = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $_.ExecutablePath -and
            $_.ExecutablePath -match "^$escapedPath$" -and
            $_.CommandLine -match $portPattern
        }
        foreach ($child in @($children)) {
            Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
    $script:sidecarProcess = $null
    $script:sidecarPort = $null
}

function Wait-Health {
    # A freshly built PyInstaller one-file sidecar can spend over a minute in
    # first-run extraction and Windows security scanning on ARM64/x64 emulation.
    # This gate must test the application, not fail while that one-time work is
    # still in progress.
    param([string]$ApiBase, [int]$Seconds = 180)
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        if ($null -ne $script:sidecarProcess -and $script:sidecarProcess.HasExited) {
            throw "Packaged sidecar exited before health became ready. See $stderrLog"
        }
        try {
            $health = Invoke-RestMethod -Method Get -Uri "$ApiBase/health" -TimeoutSec 3
            if (
                $health.status -eq "ok" -and
                $health.service_id -eq "com.havenframe.desktop.backend" -and
                $health.api_contract_version -eq "2026-07-13-model-persistence-v1"
            ) {
                return
            }
        } catch {
            Start-Sleep -Milliseconds 300
        }
    } while ((Get-Date) -lt $deadline)
    throw "Packaged sidecar did not expose the expected health identity. See $stderrLog"
}

function Get-SessionHeaders {
    param([string]$ApiBase)
    $session = Invoke-RestMethod -Method Get -Uri "$ApiBase/api/security/session" -TimeoutSec 10
    if (-not $session.token) {
        throw "Packaged sidecar did not return a local security token."
    }
    return @{ "X-Qigou-Local-Token" = $session.token }
}

function Expand-RestItems {
    param([object]$Value)
    if ($null -eq $Value) {
        return
    }
    if ($Value -is [System.Array]) {
        foreach ($item in $Value) {
            Expand-RestItems -Value $item
        }
        return
    }
    Write-Output $Value
}

function Assert-PersistedRoute {
    param([string]$ApiBase, [hashtable]$Headers, [int]$ConfigId, [string]$ExpectedBase)
    $providers = @(Expand-RestItems -Value (Invoke-RestMethod -Method Get -Uri "$ApiBase/api/models/providers" -Headers $Headers -TimeoutSec 10))
    $saved = @($providers | Where-Object { $_.id -eq $ConfigId })
    if ($saved.Count -ne 1) {
        throw "Saved relay config $ConfigId was not returned exactly once."
    }
    if ($saved[0].base_url -ne $ExpectedBase -or -not $saved[0].has_api_key) {
        $baseMatches = ([string]$saved[0].base_url) -eq $ExpectedBase
        $keyReferencePresent = [bool]$saved[0].has_api_key
        throw "Saved relay persistence mismatch (base_matches=$baseMatches, key_reference_present=$keyReferencePresent)."
    }
    $invalid = @($providers | Where-Object { $_.model_name -in @("relay-text-smoke-test", "studio-custom-image", "custom-rest-model") })
    if ($invalid.Count -ne 0) {
        throw "Removed placeholder provider configs were exposed by the packaged sidecar."
    }
    $preferences = @(Expand-RestItems -Value (Invoke-RestMethod -Method Get -Uri "$ApiBase/api/models/module-preferences" -Headers $Headers -TimeoutSec 10))
    $floorplan = @($preferences | Where-Object { $_.module_name -eq "floorplan" })
    if ($floorplan.Count -ne 1 -or $floorplan[0].default_provider_config_id -ne $ConfigId) {
        throw "Floorplan module did not preserve the saved provider config binding."
    }
}

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
$port = Get-FreeLoopbackPort
$apiBase = "http://127.0.0.1:$port"
$expectedBase = "https://relay.persistence-gate.invalid/v1"
$configId = 0

try {
    $sidecarProcess = Start-IsolatedSidecar -Port $port
    Wait-Health -ApiBase $apiBase
    $headers = Get-SessionHeaders -ApiBase $apiBase
    $payload = @{
        provider_id = "openai"
        provider_type = "openai_compatible"
        provider_name = "OpenAI-Compatible Relay"
        routing_mode = "relay_base_url"
        compatibility_mode = "openai_compatible"
        base_url = $expectedBase
        api_key = "gate-test-value"
        api_key_name = "OPENAI_RELAY_API_KEY"
        model_name = "gpt-image-2"
        model_id = "gpt-image-2"
        display_name = "GPT Image 2 Relay Persistence Gate"
        capabilities_json = @("image", "text_to_image", "image_to_image")
        timeout_sec = 180
        max_concurrency = 1
        priority = 20
        is_enabled = $true
        extra_config_json = @{
            provider_id = "openai"
            model_id = "gpt-image-2"
            compatibility_mode = "openai_compatible"
            capability = "image"
            default_endpoint_path = "/images/generations"
        }
    } | ConvertTo-Json -Depth 8
    $saved = Invoke-RestMethod -Method Post -Uri "$apiBase/api/models/configs" -Headers $headers -ContentType "application/json" -Body $payload -TimeoutSec 15
    if ($saved.base_url -ne $expectedBase -or -not $saved.has_api_key) {
        throw "Packaged sidecar did not confirm Base URL and secure Key persistence on save."
    }
    $configId = [int]$saved.id
    $preferencePayload = @{
        priority_order_json = @("gpt-image-2")
        default_provider_config_id = $configId
        fallback_enabled = $false
    } | ConvertTo-Json -Depth 4
    Invoke-RestMethod -Method Patch -Uri "$apiBase/api/models/module-preferences/floorplan" -Headers $headers -ContentType "application/json" -Body $preferencePayload -TimeoutSec 10 | Out-Null
    Assert-PersistedRoute -ApiBase $apiBase -Headers $headers -ConfigId $configId -ExpectedBase $expectedBase

    Stop-IsolatedSidecar
    $sidecarProcess = Start-IsolatedSidecar -Port $port
    Wait-Health -ApiBase $apiBase
    $headers = Get-SessionHeaders -ApiBase $apiBase
    Assert-PersistedRoute -ApiBase $apiBase -Headers $headers -ConfigId $configId -ExpectedBase $expectedBase

    $result = [ordered]@{
        sidecar = $sidecar
        api_contract_version = "2026-07-13-model-persistence-v1"
        save_response_confirmed = $true
        secure_key_reference_confirmed = $true
        restart_persistence_confirmed = $true
        module_binding_confirmed = $true
        placeholder_routes_absent = $true
        external_provider_called = $false
    }
    $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resultFull -Encoding UTF8
    $result | ConvertTo-Json -Depth 6
    $validationSucceeded = $true
} finally {
    Stop-IsolatedSidecar
    if ($validationSucceeded -and (Test-Path -LiteralPath $runtimeRoot)) {
        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            try {
                Remove-Item -LiteralPath $runtimeRoot -Recurse -Force -ErrorAction Stop
                break
            } catch {
                if ($attempt -eq 19) { throw }
                Start-Sleep -Milliseconds 250
            }
        }
    } elseif (-not $validationSucceeded) {
        Write-Error "Packaged sidecar validation failed. Runtime logs were preserved at $runtimeRoot" -ErrorAction Continue
        if (Test-Path -LiteralPath $stderrLog) {
            Get-Content -LiteralPath $stderrLog -ErrorAction SilentlyContinue | Write-Error -ErrorAction Continue
        }
    }
}
