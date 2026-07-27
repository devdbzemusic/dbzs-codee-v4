# Cloud-Fallback Testanleitung

## Zweck

Testen des automatischen Fallbacks von lokaler Runtime zu Cloud-Providern (Anthropic/OpenAI), wenn:
- Runtime gestoppt ist
- Lokale Modelle nicht verfügbar sind
- `cloudModelsEnabled=true` konfiguriert ist

## Voraussetzungen

### 1. API-Key konfigurieren

**Option A: Settings-JSON** (empfohlen)
```jsonc
// %LOCALAPPDATA%\DBZS\CodeAssistant\settings.json
{
  "cloudModelsEnabled": true,
  "anthropicApiKey": "sk-ant-...",
  "openaiApiKey": "sk-..."
}
```

**Option B: Umgebungsvariablen**
```powershell
$env:ANTHROPIC_API_KEY="sk-ant-..."
$env:OPENAI_API_KEY="sk-..."
```

### 2. Cloud-Fallback aktivieren

In den Settings (UI oder JSON):
- `cloudModelsEnabled`: `true`
- `preferLocalModels`: `false` (optional, erzwingt Cloud)
- `localOnlyModels`: `false` (muss false sein für Fallback)

## Test-Schritte

### Schritt 1: Runtime-Status prüfen

1. App starten mit `pnpm dev`
2. Mission Control öffnen
3. Backend-Status sollte grün sein
4. Runtime-Status sollte "nicht aktiv" oder "stopped" sein

### Schritt 2: Cloud-Provider verifizieren

1. Settings → Provider-Konfiguration öffnen
2. Anthropic API-Key eingeben (falls noch nicht geschehen)
3. "Verbindung testen" klicken (falls verfügbar)
4. Erwartung: Verbindung erfolgreich

### Schritt 3: Job mit Cloud-Fallback enqueuen

1. Job Monitor Panel öffnen
2. "Neuen Job erstellen" klicken
3. Job-Daten:
   ```
   Titel: Cloud-Fallback Test
   Typ: coding
   Priorität: 2
   Agent-Rolle: coder
   ```
4. Job enqueuen

### Schritt 4: Job-Events überwachen

Im JobMonitor den Job beobachten. Erwartete Waypoints:

```
✓ submitted
✓ claimed
✓ assigned
✓ started
✓ llm_inference_cloud_fallback  ← WICHTIG: Dieser Waypoint zeigt Cloud-Nutzung
✓ progress (optional)
✓ checkpoint
✓ completed
```

### Schritt 5: Artefakte prüfen

Nach Job-Abschluss:
1. Job-Detail öffnen
2. Artefakte-Tab prüfen
3. Erwartung: Output-Artefakt mit generiertem Code/Text

## Erfolgskriterien

- [ ] Job wird ohne lokale Runtime ausgeführt
- [ ] Waypoint `llm_inference_cloud_fallback` erscheint
- [ ] Job schließt mit status=completed ab
- [ ] Output-Artefakt ist vorhanden und sinnvoll

## Fehlerbehandlung

### Job bleibt in "claimed" hängen

**Ursache:** Cloud-Provider nicht verfügbar
**Lösung:** API-Key prüfen, Netzwerkverbindung testen

### Waypoint fehlt

**Ursache:** Logging nicht korrekt implementiert
**Lösung:** Backend-Logs prüfen (`backend/logs/`)

### 401 Unauthorized

**Ursache:** Ungültiger API-Key
**Lösung:** Key in Settings aktualisieren

## Backend-Logs prüfen

```powershell
# Live-Logs anzeigen
Get-Content backend/logs/app.log -Wait -Tail 50
```

Nach "cloud_fallback" oder "CloudRuntimeClient" suchen.

## Cleanup

Nach Test:
- API-Keys aus Settings entfernen (wenn nicht dauerhaft benötigt)
- Test-Jobs im JobMonitor aufräumen
- Dokumentation aktualisieren bei Problemen

## Referenzen

- `backend/app/runtime/cloud_client.py` — Cloud-Fallback-Implementierung
- `backend/app/agent_runner/service.py` — Fallback-Integration
- `HANDOVER.md` — Abschnitt "Cloud-Debugging"
