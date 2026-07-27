param(
    [int]$BackendPort = $(if ($env:DBZS_BACKEND_PORT) { [int]$env:DBZS_BACKEND_PORT } else { 8876 })
)
$ErrorActionPreference = "Continue"
$script:ErrorCount = 0
$script:WarnCount = 0
function Get-RepoRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}
function Add-DoctorRow {
    param([string]$Check, [ValidateSet("OK","WARN","ERROR")][string]$Status, [string]$Detail, [string]$Recommendation = "-")
    if ($Status -eq "ERROR") { $script:ErrorCount++ }
    if ($Status -eq "WARN") { $script:WarnCount++ }
    [PSCustomObject]@{ Check=$Check; Status=$Status; Detail=$Detail; Recommendation=$Recommendation }
}
function Test-CommandVersion {
    param([string]$Name, [scriptblock]$GetVersion, [scriptblock]$Validate)
    try {
        $version = & $GetVersion
        if (& $Validate $version) { return Add-DoctorRow $Name "OK" $version }
        return Add-DoctorRow $Name "WARN" $version "Version pruefen."
    } catch {
        return Add-DoctorRow $Name "ERROR" "nicht gefunden" "Installieren."
    }
}
function Get-PortOwnerPid { param([int]$Port)
    netstat -ano | Select-String ":$Port\s" | ForEach-Object {
        if ($_ -match "\s(?:LISTENING|ABH[^\s]*)\s+(\d+)\s*$") { return [int]$Matches[1] }
    }
    return $null
}
$repoRoot = Get-RepoRoot
$rows = @()
$rows += Test-CommandVersion "Node.js" { node --version } { param($v) [int]($v -replace '^v','' -split '\.')[0] -ge 24 }
$rows += Test-CommandVersion "pnpm" { pnpm --version } { param($v) [version]$v; $v -ge [version]"11.0.0" }
$rows += Test-CommandVersion "Python" { python --version 2>&1 } { param($v) $v -match '3\.(1[3-9]|[2-9][0-9])' }
$rows += Test-CommandVersion "uv" { uv --version } { param($v) $v -match 'uv\s+\d+\.' }
if (Test-Path (Join-Path $repoRoot "package.json")) { $rows += Add-DoctorRow "Repo-Root" "OK" $repoRoot } else { $rows += Add-DoctorRow "Repo-Root" "ERROR" "fehlt" "Repo-Root nutzen." }
if (Test-Path (Join-Path $repoRoot "node_modules")) { $rows += Add-DoctorRow "pnpm install" "OK" "node_modules" } else { $rows += Add-DoctorRow "pnpm install" "WARN" "fehlt" "pnpm install" }
if (Test-Path (Join-Path $repoRoot "backend\.venv")) { $rows += Add-DoctorRow "uv sync" "OK" "backend/.venv" } else { $rows += Add-DoctorRow "uv sync" "WARN" "fehlt" "uv sync" }
foreach ($var in @("DBZS_BACKEND_PORT","DBZS_MODELS_DIR","DBZS_OLLAMA_DIR","DBZS_OLLAMA_MODELS_DIR","OLLAMA_MODELS")) {
    $value = [Environment]::GetEnvironmentVariable($var)
    if ($value) { $rows += Add-DoctorRow "env $var" "OK" $value } else { $rows += Add-DoctorRow "env $var" "WARN" "(default)" "-" }
}
function Resolve-DoctorPath { param([string]$Default,[string]$EnvName)
    $configured = [Environment]::GetEnvironmentVariable($EnvName)
    if ($configured) { return $configured.Replace('\','/') }
    return $Default
}
$modelsDir = (Resolve-DoctorPath (Join-Path $repoRoot "models") "DBZS_MODELS_DIR").Replace('\','/')
$ollamaDir = Resolve-DoctorPath "G:/Ollama" "DBZS_OLLAMA_DIR"
foreach ($entry in @(@{N="Models dir";P=$modelsDir},@{N="Ollama dir";P=$ollamaDir},@{N="ollama.exe";P=(Join-Path $ollamaDir "ollama.exe")},@{N="llama-server.exe";P=(Join-Path $modelsDir "llama.cpp-win-runtime/llama-server.exe")})) {
    if (Test-Path $entry.P) { $rows += Add-DoctorRow $entry.N "OK" $entry.P } else { $rows += Add-DoctorRow $entry.N "WARN" "fehlt" $entry.P }
}
$portPid = Get-PortOwnerPid -Port $BackendPort
if (-not $portPid) { $rows += Add-DoctorRow "Port $BackendPort" "OK" "frei" } else { $rows += Add-DoctorRow "Port $BackendPort" "WARN" "PID $portPid" "Prozess pruefen" }
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$BackendPort/health" -TimeoutSec 3
    if ($health.status -eq "ok") { $rows += Add-DoctorRow "Backend /health" "OK" "ok" } else { $rows += Add-DoctorRow "Backend /health" "WARN" ($health|ConvertTo-Json -Compress) "-" }
} catch { $rows += Add-DoctorRow "Backend /health" "WARN" "offline" "pnpm dev" }
Write-Host "DBZS Local Dev Doctor"
$rows | Format-Table -AutoSize Check, Status, Detail, Recommendation
Write-Host "Summary: warnings=$script:WarnCount errors=$script:ErrorCount"
if ($script:ErrorCount -gt 0) { exit 1 }
exit 0
