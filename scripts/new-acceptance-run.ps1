# Scaffolds a new acceptance-test run folder per Plaene/10 DBZS_CODEE_V4_ABNAHME_TEST_PLAYBOOK.md
# (Abschnitt 4/5): docs/audits/runs/<timestamp>/ with the recommended subfolders,
# environment.txt, git-status.txt, and a RUN_SUMMARY.md pre-filled with every test ID
# from the playbook at status NOT_RUN, so a run only needs filling in, not re-structuring.
#
# Usage: pnpm acceptance:new-run
#        pnpm acceptance:new-run -Label "installer-retry"

param(
    [string]$Label = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$Timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm"
$FolderName = if ($Label) { "${Timestamp}_$Label" } else { $Timestamp }
$RunDir = Join-Path "docs/audits/runs" $FolderName

foreach ($sub in @("screenshots", "logs", "diffs", "test-output", "backups", "crash")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $RunDir $sub) | Out-Null
}

# --- environment.txt ---
function Get-ToolVersion([scriptblock]$probe) {
    try {
        $result = & $probe 2>$null
        if ($LASTEXITCODE -ne 0 -and -not $result) { return "nicht verfuegbar" }
        return ($result | Out-String).Trim()
    } catch {
        return "nicht verfuegbar"
    }
}

$envLines = @(
    "Run: $FolderName",
    "Erstellt: $(Get-Date -Format o)",
    "OS: $([System.Environment]::OSVersion.VersionString)",
    "Node: $(Get-ToolVersion { node -v })",
    "pnpm: $(Get-ToolVersion { pnpm -v })",
    "Python (uv): $(Get-ToolVersion { uv run python --version })",
    "uv: $(Get-ToolVersion { uv --version })"
)
$envLines -join "`n" | Out-File -FilePath (Join-Path $RunDir "environment.txt") -Encoding utf8

# --- git-status.txt ---
$gitLines = @(
    "=== git status ===",
    (git status | Out-String),
    "=== git rev-parse HEAD ===",
    (git rev-parse HEAD | Out-String),
    "=== git branch --show-current ===",
    (git branch --show-current | Out-String)
)
$gitLines -join "`n" | Out-File -FilePath (Join-Path $RunDir "git-status.txt") -Encoding utf8

# --- RUN_SUMMARY.md ---
# ID/title pairs mirror Plaene/10's section headings exactly, in playbook order.
$TestIds = @(
    @{ Id = "SV-01"; Title = "Repository- und Abhaengigkeitszustand" },
    @{ Id = "SV-02"; Title = "Vollstaendiges lokales CI-Gate" },
    @{ Id = "SV-03"; Title = "TypeScript-Typecheck" },
    @{ Id = "SV-04"; Title = "Backend-Testlauf" },
    @{ Id = "SV-05"; Title = "Capability-Abnahme" },
    @{ Id = "SV-06"; Title = "Contract-Paritaet" },
    @{ Id = "SV-07"; Title = "Security Regression" },
    @{ Id = "SV-08"; Title = "Packaging Smoke" },
    @{ Id = "SV-09"; Title = "Backend Smoke und Doctor" },
    @{ Id = "UI-01"; Title = "App-Start und Grundzustand" },
    @{ Id = "UI-02"; Title = "Workspace oeffnen" },
    @{ Id = "UI-03"; Title = "Modellkatalog-Rescan" },
    @{ Id = "UI-04"; Title = "Modellstart und Modellstopp" },
    @{ Id = "UI-05"; Title = "Modellwechsel-Stabilitaet" },
    @{ Id = "UI-06"; Title = "Einfacher Chat" },
    @{ Id = "UI-07"; Title = "Fortsetzungsverstaendnis" },
    @{ Id = "UI-08"; Title = "Statusfrage" },
    @{ Id = "UI-09"; Title = "Tool-Call-Finalisierung" },
    @{ Id = "UI-10"; Title = "Unvollstaendiger Agentenlauf" },
    @{ Id = "UI-11"; Title = "Folgeaktionen" },
    @{ Id = "UI-12"; Title = "Text- und Code-Dateianhang" },
    @{ Id = "UI-13"; Title = "PDF-Anhang" },
    @{ Id = "UI-14"; Title = "ZIP-Anhang" },
    @{ Id = "UI-15"; Title = "Bildanhang und Vision-Gating" },
    @{ Id = "UI-16"; Title = "Rollenmodell-Aufloesung" },
    @{ Id = "UI-17"; Title = "Repository Review ohne Findings" },
    @{ Id = "UI-18"; Title = "Repository Review mit echten Findings" },
    @{ Id = "UI-19"; Title = "Diff-Erzeugung" },
    @{ Id = "UI-20"; Title = "Approval Gate" },
    @{ Id = "UI-21"; Title = "Patch Apply" },
    @{ Id = "UI-22"; Title = "Tests nach Patch" },
    @{ Id = "UI-23"; Title = "Fehlgeschlagener Test" },
    @{ Id = "UI-24"; Title = "Rollback" },
    @{ Id = "UI-25"; Title = "Backup und Restore" },
    @{ Id = "UI-26"; Title = "Crash-Recovery" },
    @{ Id = "UI-27"; Title = "Runtime-Prozessverlust" },
    @{ Id = "UI-28"; Title = "Backend-Prozessverlust" },
    @{ Id = "IN-01"; Title = "Release-Build" },
    @{ Id = "IN-02"; Title = "Neuinstallation" },
    @{ Id = "IN-03"; Title = "UserData- und AppData-Pfade" },
    @{ Id = "IN-04"; Title = "Installer Golden Path" },
    @{ Id = "IN-05"; Title = "Portable Build" },
    @{ Id = "IN-06"; Title = "Update ueber bestehende Installation" },
    @{ Id = "IN-07"; Title = "Deinstallation" },
    @{ Id = "PS-01"; Title = "Drei vollstaendige Laeufe" },
    @{ Id = "PS-02"; Title = "Pflichtumfang je Lauf" },
    @{ Id = "PS-03"; Title = "Alltagsnutzung" },
    @{ Id = "PS-04"; Title = "Freigabekriterien" }
)

$CurrentCommit = (git rev-parse HEAD | Out-String).Trim()
$CurrentBranch = (git branch --show-current | Out-String).Trim()

$summaryHeader = @"
# Abnahme-Run: $FolderName

Basis: Plaene/10 DBZS_CODEE_V4_ABNAHME_TEST_PLAYBOOK.md

- Datum: $(Get-Date -Format "yyyy-MM-dd HH:mm")
- Commit: $CurrentCommit
- Branch: $CurrentBranch
- App-Modus:
- Tester:

## Uebersicht

| Test-ID | Titel | Status |
| --- | --- | --- |
"@

$overviewRows = ($TestIds | ForEach-Object { "| $($_.Id) | $($_.Title) | NOT_RUN |" }) -join "`n"

$protocolBlocks = ($TestIds | ForEach-Object {
    @"

---

## $($_.Id) - $($_.Title)

- Status: NOT_RUN
- Datum:
- Tester:
- Commit: $CurrentCommit
- Branch: $CurrentBranch
- App-Modus: Dev / Installer / Portable
- Modell:
- Runtime-Slot:
- Workspace:

### Durchfuehrung

1.

### Ist-Ergebnis

### Erwartetes Ergebnis

### Beweise

- Screenshot:
- Log:
- Diff:
- Testausgabe:

### Abweichungen

### Entscheidung

PASS / FAIL / BLOCKED / NOT_RUN
"@
}) -join "`n"

$summaryHeader + "`n" + $overviewRows + "`n" + $protocolBlocks + "`n" |
    Out-File -FilePath (Join-Path $RunDir "RUN_SUMMARY.md") -Encoding utf8

Write-Host "Neuer Abnahme-Run angelegt: $RunDir"
Write-Host "  - environment.txt, git-status.txt geschrieben"
Write-Host "  - RUN_SUMMARY.md mit $($TestIds.Count) Test-IDs (NOT_RUN) vorbefuellt"
Write-Host "  - Unterordner: screenshots/, logs/, diffs/, test-output/, backups/, crash/"
