# DBZS Codee — Troubleshooting Guide

**Häufige Probleme und Lösungen**

---

## Backend startet nicht

### Symptome
- Electron-Fenster öffnet sich
- Mission Control zeigt "Backend nicht verbunden"
- Health-Check schlägt fehl

### Lösung

```powershell
# 1. Backend manuell starten
pnpm dev:backend

# 2. Port prüfen (Default: 8876)
netstat -ano | findstr :8876

# 3. Logs prüfen
Get-Content backend/logs/app.log -Tail 50 -Wait

# 4. Config prüfen
Get-Content $env:LOCALAPPDATA\DBZS\CodeAssistant\settings.json
```

### Mögliche Ursachen

| Ursache | Lösung |
|---------|--------|
| Port bereits belegt | Anderen Port: `$env:DBZS_BACKEND_PORT=8877` |
| Python-Umgebung defekt | `cd backend; uv sync` |
| Config-Datei korrupt | Settings-JSON löschen, neu starten |

---

## Tests schlagen fehl

### Symptome
- `pnpm test` bricht mit Fehlern ab
- Permission-Errors bei pytest

### Lösung

```powershell
# 1. pytest-Cache löschen
Remove-Item -Recurse -Force backend\.pytest_cache

# 2. Temp-Ordner bereinigen
Remove-Item -Recurse -Force $env:TEMP\pytest-of-*

# 3. Nur Core-Tests laufen
cd backend
uv run pytest tests/test_health.py tests/test_runtime_api.py -v
```

### Bekannte Issues

**Problem:** `PermissionError: [WinError 5] Zugriff verweigert`

**Lösung:** pytest.ini setzt `cache_dir = ".pytest_cache"` (lokal im Backend)

---

## Runtime verbindet nicht

### Symptome
- Runtime-Tab zeigt "nicht aktiv"
- Modell-Start schlägt fehl
- Chat-Antworten bleiben aus

### Lösung

```powershell
# 1. Runtime-Status prüfen
Invoke-RestMethod http://127.0.0.1:8876/runtime/status

# 2. Modellpfad prüfen
# Settings → Models → Path (Default: D:\Models)

# 3. llama-server manuell starten
D:\Models\llama-server.exe -m D:\Models\your-model.gguf

# 4. Ollama prüfen
ollama list
ollama serve
```

### Debug-Schritte

1. **Browser-Console öffnen** (F12)
2. **Network-Tab** → `/runtime/start` Request prüfen
3. **Backend-Logs** → Nach "runtime" suchen
4. **Modell-Datei** → Existiert sie? GGUF-Format?

---

## SSE funktioniert nicht

### Symptome
- Job-Status aktualisiert nicht live
- Manueller Refresh nötig
- Console zeigt EventSource-Fehler

### Lösung

```javascript
// Browser-Console (F12)
console.log("SSE Status:", window.dbzs?.sseConnected)

// Connection testen
fetch("http://127.0.0.1:8876/job-spooler/stream")
  .then(r => console.log("SSE Endpoint OK"))
  .catch(e => console.error("SSE Error:", e))
```

### Mögliche Ursachen

| Ursache | Lösung |
|---------|--------|
| Backend nicht gestartet | `pnpm dev:backend` |
| CORS-Fehler | Backend-URL in preload.ts prüfen |
| Browser-Extension blockiert | Incognito-Mode testen |

---

## Typecheck-Fehler

### Symptome
- `pnpm typecheck` zeigt TypeScript-Fehler
- IDE zeigt rote Wellenlinien

### Lösung

```powershell
# 1. Node-Modules Cache löschen
Remove-Item -Recurse -Force node_modules\.pnpm

# 2. Dependencies neu installieren
pnpm install

# 3. Typecheck erneut
pnpm typecheck
```

### Häufige Fehler

**Fehler:** `Cannot find module '@dbzs/shared'`

**Lösung:** `pnpm --filter @dbzs/shared build`

---

## Build-Fehler

### Symptome
- `pnpm build` bricht ab
- Electron-Vite zeigt Fehler

### Lösung

```powershell
# 1. Output-Ordner löschen
Remove-Item -Recurse -Force apps\desktop\out

# 2. Clean Build
pnpm --filter @dbzs/shared build
pnpm --filter @dbzs/desktop build

# 3. Vollständiger Build
pnpm build
```

---

## Agent-Execution-Fehler

### Symptome
- Job bleibt in "claimed" hängen
- Keine Artefakte erzeugt
- Logs zeigen Timeout

### Lösung

```powershell
# 1. Job-Status prüfen
Invoke-RestMethod http://127.0.0.1:8876/job-spooler/{job-id}

# 2. Agent-Logs
Get-Content $env:LOCALAPPDATA\DBZS\CodeAssistant\agents.sqlite3

# 3. Runtime prüfen (für LLM-Inferenz)
Invoke-RestMethod http://127.0.0.1:8876/runtime/status
```

### Cloud-Fallback prüfen

Wenn lokale Runtime nicht verfügbar:

```jsonc
// settings.json
{
  "cloudModelsEnabled": true,
  "anthropicApiKey": "sk-ant-..."
}
```

---

## Git-Intelligence-Fehler

### Symptome
- Git-Panel zeigt "kein Repository"
- Diffs werden nicht geladen
- Commit-Assistent inaktiv

### Lösung

```powershell
# 1. Repository-Status prüfen
git status

# 2. Workspace-Root prüfen
# Muss Repository-Root sein

# 3. Git-Pfad in System-Path
where git
```

### Bekannte Einschränkungen

- **Read-Only:** Git-Intelligence ändert nichts am Repository
- **Workspace-Boundary:** Nur Dateien im Workspace werden analysiert
- **Keine SSH-Keys:** Git-Operations ohne Auth (read-only)

---

## Memory/Disk-Probleme

### Symptome
- App wird langsam
- Festplatte voll
- SQLite-Locks

### Lösung

```powershell
# 1. App-Data bereinigen
Remove-Item "$env:LOCALAPPDATA\DBZS\CodeAssistant\*.db"

# 2. Restore-Points aufräumen
# UI → Git Panel → "Aufräumen"

# 3. Logs rotieren
Remove-Item "backend\logs\*.log" -Exclude "app.log"
```

### Empfohlene Limits

| Ressource | Limit | Überwachung |
|-----------|-------|-------------|
| Restore-Points | 10 | Auto-Cleanup |
| Job-History | 100 | Manuell löschen |
| Logs | 50 MB | Rotation |

---

## Smoke-Test-Fehler

### Symptome
- `pnpm smoke-test` schlägt fehl
- Einzelne Checks rot

### Lösung

```powershell
# Einzelne Checks manuell
pnpm typecheck      # TypeScript
pnpm test           # Unit-Tests
pnpm build          # Production-Build
pnpm doctor:backend # Backend-Health
```

### Check-Liste

- [ ] Node.js 24+ installiert?
- [ ] Python 3.13+ installiert?
- [ ] pnpm aktuell?
- [ ] uv installiert?
- [ ] Backend-Dependencies gesynced?

---

## Contact & Help

Wenn nichts hilft:

1. **GitHub Issues** → https://github.com/devdbzemusic/dbzs-codee-project/issues
2. **Logs beifügen:**
   - `backend/logs/app.log`
   - Browser-Console (F12 → Console-Tab)
   - Smoke-Test Output
3. **System-Info:**
   - OS (Windows/Mac/Linux)
   - Node-Version: `node --version`
   - Python-Version: `python --version`

---

**Letztes Update:** 2026-06-17
