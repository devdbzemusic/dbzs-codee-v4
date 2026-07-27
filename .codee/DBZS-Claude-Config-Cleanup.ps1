<#
.SYNOPSIS
  Sicheres Cleanup-/Reset-Script für Claude Code unter Windows.

.DESCRIPTION
  - Erstellt vor Änderungen ein Backup.
  - Standardmäßig nur Analyse (Audit).
  - Bereinigt optional Logs, Debugdaten, temporäre Dateien und Projekt-Sitzungsverläufe.
  - Löscht Einstellungen oder Anmeldung nur bei ausdrücklich gewähltem FullReset.

.EXAMPLE
  .\DBZS-Claude-Config-Cleanup.ps1
  .\DBZS-Claude-Config-Cleanup.ps1 -Mode Standard -WhatIf
  .\DBZS-Claude-Config-Cleanup.ps1 -Mode Standard
  .\DBZS-Claude-Config-Cleanup.ps1 -Mode FullReset -IncludeAuth -ConfirmFullReset
#>

[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [ValidateSet('Audit', 'Minimal', 'Standard', 'FullReset')]
    [string]$Mode = 'Audit',

    [string]$ProjectPath,

    [switch]$IncludeAuth,

    [switch]$ConfirmFullReset,

    [string]$BackupRoot = "$env:USERPROFILE\Documents\Claude-Code-Backups"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Section([string]$Text) {
    Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function Get-ItemSizeBytes([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return 0L }
    $item = Get-Item -LiteralPath $Path -Force
    if (-not $item.PSIsContainer) { return [int64]$item.Length }
    return [int64](Get-ChildItem -LiteralPath $Path -Force -Recurse -File -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
}

function Format-Bytes([int64]$Bytes) {
    if ($Bytes -ge 1GB) { return ('{0:N2} GB' -f ($Bytes / 1GB)) }
    if ($Bytes -ge 1MB) { return ('{0:N2} MB' -f ($Bytes / 1MB)) }
    if ($Bytes -ge 1KB) { return ('{0:N2} KB' -f ($Bytes / 1KB)) }
    return "$Bytes B"
}

function Backup-Path([string]$Source, [string]$BackupDir) {
    if (-not (Test-Path -LiteralPath $Source)) { return }

    $safeName = ($Source -replace '[:\\/]', '_').Trim('_')
    $destination = Join-Path $BackupDir $safeName

    if ($PSCmdlet.ShouldProcess($Source, "Backup nach $destination")) {
        $item = Get-Item -LiteralPath $Source -Force
        if ($item.PSIsContainer) {
            Copy-Item -LiteralPath $Source -Destination $destination -Recurse -Force
        } else {
            Copy-Item -LiteralPath $Source -Destination $destination -Force
        }
    }
}

function Remove-SafePath([string]$Path, [string]$Reason) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $size = Get-ItemSizeBytes $Path
    if ($PSCmdlet.ShouldProcess($Path, "$Reason; freigeben: $(Format-Bytes $size)")) {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
        Write-Host "Entfernt: $Path ($(Format-Bytes $size))" -ForegroundColor Green
    }
}

function Remove-ChildrenSafe([string]$Path, [string]$Reason) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $size = Get-ItemSizeBytes $Path
    if ($PSCmdlet.ShouldProcess("$Path\*", "$Reason; freigeben: $(Format-Bytes $size)")) {
        Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue |
            Remove-Item -Recurse -Force -ErrorAction Stop
        Write-Host "Geleert: $Path ($(Format-Bytes $size))" -ForegroundColor Green
    }
}

$homeClaude = Join-Path $env:USERPROFILE '.claude'
$globalState = Join-Path $env:USERPROFILE '.claude.json'
$timestamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$backupDir = Join-Path $BackupRoot "claude-backup_$timestamp"

# Bekannte Claude-Code-Bereiche. Nicht vorhandene Pfade werden ignoriert.
$diagnosticPaths = @(
    (Join-Path $homeClaude 'debug'),
    (Join-Path $homeClaude 'logs'),
    (Join-Path $homeClaude 'telemetry'),
    (Join-Path $homeClaude 'statsig'),
    (Join-Path $homeClaude 'shell-snapshots'),
    (Join-Path $homeClaude 'todos')
)

$sessionPaths = @(
    (Join-Path $homeClaude 'projects')
)

$configPaths = @(
    (Join-Path $homeClaude 'settings.json'),
    (Join-Path $homeClaude 'settings.local.json'),
    (Join-Path $homeClaude 'CLAUDE.md')
)

if ($ProjectPath) {
    $resolvedProject = Resolve-Path -LiteralPath $ProjectPath -ErrorAction Stop
    $projectClaude = Join-Path $resolvedProject.Path '.claude'
    $configPaths += @(
        (Join-Path $projectClaude 'settings.json'),
        (Join-Path $projectClaude 'settings.local.json'),
        (Join-Path $resolvedProject.Path 'CLAUDE.md'),
        (Join-Path $resolvedProject.Path '.mcp.json')
    )
}

Write-Section 'Claude Code Cleanup'
Write-Host "Modus:       $Mode"
Write-Host "Claude Home: $homeClaude"
Write-Host "Backup:      $backupDir"

Write-Section 'Gefundene Daten'
$allKnown = @($diagnosticPaths + $sessionPaths + $configPaths + $globalState) | Select-Object -Unique
$found = foreach ($path in $allKnown) {
    if (Test-Path -LiteralPath $path) {
        [pscustomobject]@{
            Path = $path
            Size = Format-Bytes (Get-ItemSizeBytes $path)
            Type = if ((Get-Item -LiteralPath $path -Force).PSIsContainer) { 'Ordner' } else { 'Datei' }
        }
    }
}

if ($found) {
    $found | Format-Table -AutoSize
} else {
    Write-Host 'Keine bekannten Claude-Code-Konfigurationsdaten gefunden.' -ForegroundColor Yellow
}

if ($Mode -eq 'Audit') {
    Write-Host "`nKeine Änderungen durchgeführt. Nutze -Mode Minimal, Standard oder FullReset." -ForegroundColor Yellow
    exit 0
}

if ($Mode -eq 'FullReset' -and -not $ConfirmFullReset) {
    throw 'FullReset abgebrochen: Zusätzlich -ConfirmFullReset angeben.'
}

Write-Section 'Backup'
if ($PSCmdlet.ShouldProcess($backupDir, 'Backup-Verzeichnis erstellen')) {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
}

# Vor jeder Bereinigung die tatsächlich betroffenen Daten sichern.
$toBackup = @($diagnosticPaths)
if ($Mode -in @('Standard', 'FullReset')) { $toBackup += $sessionPaths }
if ($Mode -eq 'FullReset') { $toBackup += $configPaths; $toBackup += $globalState }
$toBackup | Select-Object -Unique | ForEach-Object { Backup-Path $_ $backupDir }

Write-Section 'Bereinigung'
foreach ($path in $diagnosticPaths) {
    Remove-SafePath $path 'Diagnose-, Log- oder temporäre Claude-Daten entfernen'
}

if ($Mode -in @('Standard', 'FullReset')) {
    foreach ($path in $sessionPaths) {
        Remove-SafePath $path 'Lokale Claude-Code-Sitzungsverläufe entfernen'
    }
}

if ($Mode -eq 'FullReset') {
    foreach ($path in $configPaths | Select-Object -Unique) {
        Remove-SafePath $path 'Claude-Code-Konfiguration zurücksetzen'
    }

    if ($IncludeAuth) {
        Remove-SafePath $globalState 'Globalen Claude-Code-Status inklusive möglicher Anmeldung zurücksetzen'
    } else {
        Write-Host 'Globale Status-/Anmeldedatei wurde behalten. Für deren Entfernung: -IncludeAuth' -ForegroundColor Yellow
    }
}

Write-Section 'Abschluss'
Write-Host 'Cleanup abgeschlossen.' -ForegroundColor Green
Write-Host "Backup liegt unter: $backupDir"
Write-Host 'Danach empfohlen: claude doctor'
