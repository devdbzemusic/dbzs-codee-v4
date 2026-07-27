# Live backend acceptance for Phase 0 interactive checks (Windows / PowerShell).
# Usage: pnpm acceptance:live
# Optional: -StartBackend to spawn uvicorn when port 8876 is free.

param(
    [switch]$StartBackend,
    [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"
$BaseUrl = "http://127.0.0.1:8876"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$BackendStarted = $false
$BackendJob = $null

function Write-Check {
    param([string]$Label, [bool]$Ok, [string]$Detail = "")
    $mark = if ($Ok) { "[OK]" } else { "[FAIL]" }
    $line = "$mark $Label"
    if ($Detail) { $line += ": $Detail" }
    Write-Host $line
    if (-not $Ok) { $script:Failed = $true }
}

function Wait-Health {
    param([int]$Seconds)
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-RestMethod -Uri "$BaseUrl/health" -Method Get -TimeoutSec 3
            if ($r.status -eq "ok") { return $true }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Invoke-Api {
    param(
        [string]$Path,
        [string]$Method = "Get",
        [object]$Body = $null
    )
    $params = @{
        Uri = "$BaseUrl$Path"
        Method = $Method
        TimeoutSec = 15
    }
    if ($Body) {
        $params.ContentType = "application/json"
        $params.Body = ($Body | ConvertTo-Json -Depth 10 -Compress)
    }
    return Invoke-RestMethod @params
}

$Failed = $false

Write-Host "=== DBZS Live Acceptance ==="
Write-Host "Base: $BaseUrl"

$healthUp = Wait-Health -Seconds 2
if (-not $healthUp -and $StartBackend) {
    Write-Host "Starting backend (dev:backend)..."
    $BackendJob = Start-Job -ScriptBlock {
        Set-Location $using:RepoRoot
        Set-Location backend
        uv run uvicorn app.main:app --host 127.0.0.1 --port 8876 2>&1
    }
    $BackendStarted = $true
    $healthUp = Wait-Health -Seconds $TimeoutSeconds
}

Write-Check "Backend /health" $healthUp $(if ($healthUp) { "status=ok" } else { "not reachable on 8876" })
if (-not $healthUp) {
    if ($BackendStarted -and $BackendJob) { Stop-Job $BackendJob -ErrorAction SilentlyContinue; Remove-Job $BackendJob -Force -ErrorAction SilentlyContinue }
    exit 1
}

try {
    $health = Invoke-Api "/health"
    Write-Check "Health payload" ($health.status -eq "ok") "status=$($health.status)"
} catch {
    Write-Check "Health payload" $false $_.Exception.Message
}

try {
    $models = Invoke-Api "/models/index"
    $count = if ($models.models) { @($models.models).Count } else { 0 }
    Write-Check "Model index" $true "$count models, summary present=$([bool]$models.summary)"
} catch {
    Write-Check "Model index" $false $_.Exception.Message
}

try {
    $runtime = Invoke-Api "/runtime/status"
    Write-Check "Runtime status" $true "state=$($runtime.state)"
} catch {
    Write-Check "Runtime status" $false $_.Exception.Message
}

try {
    $jobs = Invoke-Api "/job-spooler"
    $jobCount = @($jobs).Count
    Write-Check "Job spooler list" $true "$jobCount jobs"
} catch {
    Write-Check "Job spooler list" $false $_.Exception.Message
}

try {
    $agents = Invoke-Api "/agents"
    Write-Check "Agents registry" $true "$((@($agents)).Count) agents"
} catch {
    Write-Check "Agents registry" $false $_.Exception.Message
}

try {
    $settings = Invoke-Api "/settings"
    Write-Check "Settings" $true "keys=$($settings.PSObject.Properties.Name -join ', ')"
} catch {
    Write-Check "Settings" $false $_.Exception.Message
}

# Backend reload simulation: health must recover after process restart when -StartBackend
if ($StartBackend) {
    Write-Host "Simulating backend reload (stop job, restart)..."
    if ($BackendJob) {
        Stop-Job $BackendJob -ErrorAction SilentlyContinue
        Remove-Job $BackendJob -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
    $BackendJob = Start-Job -ScriptBlock {
        Set-Location $using:RepoRoot
        Set-Location backend
        uv run uvicorn app.main:app --host 127.0.0.1 --port 8876 2>&1
    }
    $reloadOk = Wait-Health -Seconds $TimeoutSeconds
    Write-Check "Backend reload recovery" $reloadOk $(if ($reloadOk) { "health after restart" } else { "timeout" })
}

Write-Host ""
if ($Failed) {
    Write-Host "acceptance-live: FAILED"
    if ($BackendStarted -and $BackendJob) { Stop-Job $BackendJob -ErrorAction SilentlyContinue; Remove-Job $BackendJob -Force -ErrorAction SilentlyContinue }
    exit 1
}

Write-Host "acceptance-live: OK"
if ($BackendStarted -and $BackendJob) {
    Write-Host "(Backend left running in background job; stop with: Get-Job | Stop-Job; Get-Job | Remove-Job)"
}
exit 0
