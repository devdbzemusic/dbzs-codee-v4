# DBZS Codee — Slot Management E2E Tests
# Stand: 2026-06-27
#
# Tests:
# 1. Slot-Status abfragen (alle Slots)
# 2. Slot starten (quality_cpu)
# 3. Warten bis running + chat_ready
# 4. Slot stoppen
# 5. Fehlerfall: Start mit ungültigem Modell

$ErrorActionPreference = "Stop"
$BackendUrl = "http://127.0.0.1:8876"
$TestSlot = "quality_cpu"
$TestModel = "microsoft-Phi-4-mini-instruct-Q8-0"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "DBZS Slot Management E2E Tests" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Helper: HTTP Request
function Invoke-SlotApi {
    param(
        [string]$Endpoint,
        [string]$Method = "GET",
        [string]$Body = $null
    )

    $url = "$BackendUrl$Endpoint"
    $headers = @{ "Content-Type" = "application/json" }

    try {
        if ($Body) {
            $response = Invoke-WebRequest -Uri $url -Method $Method -Headers $headers -Body $Body -UseBasicParsing
        } else {
            $response = Invoke-WebRequest -Uri $url -Method $Method -Headers $headers -UseBasicParsing
        }
        return @{
            Success = $true
            StatusCode = $response.StatusCode
            Content = $response.Content | ConvertFrom-Json
        }
    } catch {
        return @{
            Success = $false
            Error = $_.Exception.Message
            StatusCode = $_.Exception.Response?.StatusCode
        }
    }
}

# Helper: Warten bis Slot ready
function Wait-SlotReady {
    param(
        [string]$SlotId,
        [int]$TimeoutSec = 30,
        [int]$PollIntervalMs = 1000
    )

    $startTime = Get-Date
    $timeout = [TimeSpan]::FromSeconds($TimeoutSec)

    Write-Host "  Warte auf Slot-Bereitschaft (Timeout: ${TimeoutSec}s)..." -ForegroundColor Yellow

    while ((Get-Date) - $startTime -lt $timeout) {
        $result = Invoke-SlotApi -Endpoint "/runtime/slots/$SlotId/status"

        if ($result.Success -and $result.Content.state -eq "running" -and $result.Content.chat_ready) {
            Write-Host "  ✓ Slot ist bereit!" -ForegroundColor Green
            return $true
        }

        if ($result.Content.state -eq "error") {
            Write-Host "  ✗ Slot-Fehler: $($result.Content.error_message)" -ForegroundColor Red
            return $false
        }

        Start-Sleep -Milliseconds $PollIntervalMs
    }

    Write-Host "  ✗ Timeout erreicht" -ForegroundColor Red
    return $false
}

# Tests
$passedTests = 0
$failedTests = 0

function Test-Result {
    param(
        [bool]$Passed,
        [string]$TestName
    )

    if ($Passed) {
        Write-Host "  ✓ $TestName" -ForegroundColor Green
        $script:passedTests++
    } else {
        Write-Host "  ✗ $TestName" -ForegroundColor Red
        $script:failedTests++
    }
}

# Test 1: Backend Health Check
Write-Host "Test 1: Backend Health Check" -ForegroundColor Cyan
$result = Invoke-SlotApi -Endpoint "/health"
Test-Result -Passed $result.Success -TestName "Backend ist erreichbar"
Write-Host ""

# Test 2: Alle Slots abfragen
Write-Host "Test 2: Alle Slots abfragen" -ForegroundColor Cyan
$slots = @("fast_gpu", "quality_cpu", "utility")
foreach ($slot in $slots) {
    $result = Invoke-SlotApi -Endpoint "/runtime/slots/$slot/status"
    Test-Result -Passed $result.Success -TestName "Slot $slot Status abrufbar"

    if ($result.Success) {
        $content = $result.Content
        Write-Host "    Status: $($content.state), Modell: $($content.model_name ?? 'n/a')" -ForegroundColor Gray
    }
}
Write-Host ""

# Test 3: Slot starten
Write-Host "Test 3: Slot starten ($TestSlot)" -ForegroundColor Cyan
$stopFirst = Invoke-SlotApi -Endpoint "/runtime/slots/$TestSlot/stop" -Method "POST"
Start-Sleep -Seconds 2

$result = Invoke-SlotApi -Endpoint "/runtime/slots/$TestSlot/start" -Method "POST" -Body (@{ model_id = $TestModel } | ConvertTo-Json)
Test-Result -Passed $result.Success -TestName "Slot-Start API erfolgreich"

if ($result.Success) {
    Write-Host "    Start-Status: $($result.Content.state)" -ForegroundColor Gray
}
Write-Host ""

# Test 4: Warten bis Slot ready
Write-Host "Test 4: Slot-Bereitschaft prüfen" -ForegroundColor Cyan
$ready = Wait-SlotReady -SlotId $TestSlot -TimeoutSec 30
Test-Result -Passed $ready -TestName "Slot wurde bereit (running + chat_ready)"
Write-Host ""

# Test 5: Slot stoppen
Write-Host "Test 5: Slot stoppen" -ForegroundColor Cyan
$stopResult = Invoke-SlotApi -Endpoint "/runtime/slots/$TestSlot/stop" -Method "POST"
Test-Result -Passed $stopResult.Success -TestName "Slot-Stop API erfolgreich"

if ($stopResult.Success) {
    Start-Sleep -Seconds 2
    $statusResult = Invoke-SlotApi -Endpoint "/runtime/slots/$TestSlot/status"
    $isStopped = $statusResult.Success -and $statusResult.Content.state -eq "stopped"
    Test-Result -Passed $isStopped -TestName "Slot-Status ist 'stopped'"
}
Write-Host ""

# Test 6: Fehlerfall - ungültiges Modell
Write-Host "Test 6: Fehlerfall - ungültiges Modell" -ForegroundColor Cyan
$invalidResult = Invoke-SlotApi -Endpoint "/runtime/slots/$TestSlot/start" -Method "POST" -Body (@{ model_id = "invalid-model-xyz" } | ConvertTo-Json)
$expectedFailure = -not $invalidResult.Success -or $invalidResult.StatusCode -ne 200
Test-Result -Passed $expectedFailure -TestName "Ungültiges Modell wird abgelehnt"

if ($invalidResult.Success) {
    Write-Host "    Unerwartet erfolgreich (Backend akzeptiert alle Modelle?)" -ForegroundColor Yellow
} else {
    Write-Host "    Erwarteter Fehler: $($invalidResult.Error)" -ForegroundColor Gray
}
Write-Host ""

# Zusammenfassung
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Test-Zusammenfassung" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Bestanden: $passedTests" -ForegroundColor Green
Write-Host "Fehlgeschlagen: $failedTests" -ForegroundColor Red
Write-Host ""

if ($failedTests -eq 0) {
    Write-Host "✓ Alle Tests erfolgreich!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "✗ Einige Tests fehlgeschlagen" -ForegroundColor Red
    exit 1
}
