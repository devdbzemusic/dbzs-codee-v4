# DBZS Codee — Quickstart

**In 5 Minuten zum ersten Agent-Job**

## Voraussetzungen

- Node.js 24+
- Python 3.13+
- pnpm (`npm install -g pnpm`)
- uv (`curl -LsSf https://astral.sh/uv/install.sh | sh`)

## Installation

```powershell
# 1. Repository klonen
git clone https://github.com/devdbzemusic/dbzs-codee-project.git
cd dbzs-codee-project

# 2. Dependencies installieren
pnpm install

# 3. Backend synchronisieren
cd backend
uv sync
cd ..
```

## Starten

```powershell
# Entwicklungsserver starten
pnpm dev
```

Das Electron-Fenster öffnet sich automatisch. Das Backend startet asynchron im Hintergrund.

## Erster Test: Mission Control

1. **Mission Control** sollte beim Start erscheinen
2. Warte bis **Backend-Status** grün wird (OK)
3. Optional: **GPU-Info** laden für Hardware-Übersicht

## Job erstellen und ausführen

### Schritt 1: Job Monitor öffnen

Rechts im Panel den Tab **"Job Monitor"** klicken.

### Schritt 2: Neuen Job erstellen

Klicke auf **"Neuen Job erstellen"** und fülle aus:

| Feld | Wert |
|------|------|
| Titel | `Test: Datei erstellen` |
| Typ | `coding` |
| Priorität | `2` |
| Agent-Rolle | `coder` |
| Beschreibung | `Erstelle eine neue Datei hello.txt mit Inhalt "Hello World"` |

### Schritt 3: Job einreihen

Klicke auf **"Enqueue"**. Der Job erscheint in der Liste mit Status `queued`.

### Schritt 4: Job ausführen

1. Job in der Liste auswählen
2. Im Detail-Panel auf **"Claim"** klicken (Agent übernimmt Job)
3. Status ändert zu `claimed` → `running`
4. Warte auf Waypoint `completed`

### Schritt 5: Ergebnis prüfen

1. Im Job-Detail den Tab **"Artefakte"** öffnen
2. Output-Artefakt sollte den generierten Code zeigen
3. Optional: **"Apply"** klicken um Patch anzuwenden

## Runtime-Chat (Optional)

Für direkte Interaktion mit lokaler Runtime:

1. Tab **"Runtime"** öffnen
2. Runtime-Status prüfen (sollte "aktiv" sein)
3. Prompt eingeben: `Erkläre kurz was du tun kannst`
4. Enter zum Senden
5. Antwort erscheint im Chat

## Cloud-Fallback (Ohne lokale Runtime)

Falls keine lokale Runtime verfügbar ist:

1. **Settings** öffnen (`,` oder Button oben rechts)
2. **Cloud-Provider** konfigurieren:
   ```json
   {
     "cloudModelsEnabled": true,
     "anthropicApiKey": "sk-ant-..."
   }
   ```
3. Job wie oben erstellen — Agent weicht automatisch auf Cloud aus

## Nützliche Commands

```powershell
# Smoke-Test (alle Checks)
pnpm smoke-test

# Nur Backend testen
pnpm smoke:backend
pnpm doctor:backend

# Typecheck
pnpm typecheck

# Tests
pnpm test

# Build
pnpm build

# E2E-Tests
pnpm e2e
```

## Tastenkürzel

| Shortcut | Aktion |
|----------|--------|
| `Ctrl+K` | Command Palette |
| `Ctrl+O` | Datei öffnen |
| `Ctrl+S` | Datei speichern |
| `,` | Settings öffnen |
| `Esc` | Panel schließen |

## Hilfe & Dokumentation

| Dokument | Inhalt |
|----------|--------|
| `HANDOVER.md` | Projekt-Übersicht, Status, offene Punkte |
| `docs/ARCHITECTURE.md` | System-Architektur |
| `docs/PHASES.md` | Feature-Phasen-Historie |
| `docs/CLOUD_FALLBACK_TEST.md` | Cloud-Fallback Testanleitung |
| `docs/PHASE_2C_DESIGN.md` | Autonomous Loop Design |

## Troubleshooting

### Backend startet nicht

```powershell
# Backend manuell starten
pnpm dev:backend

# Logs prüfen
Get-Content backend/logs/app.log -Tail 50 -Wait
```

### Typecheck-Fehler

```powershell
# Cache löschen
Remove-Item -Recurse -Force node_modules\.pnpm
pnpm install
pnpm typecheck
```

### Backend-Tests schlagen fehl

```powershell
# pytest-Cache löschen
Remove-Item -Recurse -Force backend\.pytest_cache
cd backend
uv run pytest tests/test_health.py -v
```

### Electron-Fenster bleibt schwarz

1. App neu starten
2. Mission Control sollte nach 2-3 Sekunden erscheinen
3. Falls nicht: DevTools öffnen (`Ctrl+Shift+I`), Console prüfen

---

**Nächste Schritte:**
- [ ] Eigene Agent-Jobs erstellen
- [ ] Runtime mit lokalem Modell starten
- [ ] Cloud-Fallback testen
- [ ] Review-Gates ausprobieren (Phase 2C+)
