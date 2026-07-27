# Development Phases

## Phase 1: Foundation

Umgesetzt und committed:

- Desktop Shell
- React Renderer
- FastAPI Health API
- FastAPI Settings API
- lokale Settings-Persistenz
- sichere Electron Preload-Bridge

## Phase 2: Editor

Umgesetzt:

- Monaco Editor
- nativer Datei-Oeffnen-Dialog
- Datei speichern ueber Electron IPC
- Tab-System
- Dirty-State
- Shortcuts `Ctrl+O` und `Ctrl+S`

## Phase 3: Local Model Index

Umgesetzt:

- dynamische Indexierung von `D:\Models`
- Nutzung vorhandener DBZS-Modellkataloge
- Backend-Endpunkt `GET /models/index`
- Klassifikation nach Coding, Chat, Vision, Reranker, Embedding, Media und Adapter
- Topbar- und AI/Agents-Panel-Anbindung
- Runtime-Endpunkte `GET /runtime/status`, `POST /runtime/start`, `POST /runtime/stop`
- bewusster Start/Stop eines ausgewaehlten `llama-server`-Modells
- Runtime-Controls im AI/Agents-Panel

## Phase 4: Runtime Chat

Umgesetzt:

- projektbewusstes Chat-Panel im AI/Agents-Bereich
- Chat gegen aktive lokale `llama-server` Runtime
- OpenAI-kompatibler Backend-Endpunkt `POST /runtime/chat`
- sichere Electron-Bridge fuer Runtime-Chat
- aktiver Editor-Tab als optionaler Dateikontext
- Chat-Store mit Verlauf, Fehlerzustand und Sendestatus
- Ollama aus `G:\Ollama` als lokaler Provider
- Ollama-Modellindex ueber lokale Manifestdateien
- Ollama Runtime-Start ueber `ollama.exe serve`
- Ollama Chat ueber lokalen `/api/chat` Endpunkt
- Runtime-Panel mit bewusster Auswahl startbarer `llama-server`- und Ollama-Modelle

## Phase 5: Agent Registry

Umgesetzt:

- Backend-Endpunkte fuer Agent Registry (`GET/POST/PUT/DELETE /agents`)
- Agent-Start/Stop-Endpunkte (`POST /agents/{id}/start`, `POST /agents/{id}/stop`)
- Agent-Logs-Endpunkt (`GET /agents/{id}/logs`)
- SQLite-Persistenz fuer Agent-Definitionen und Laufzeit-Logs
- Guardrails fuer Kommandos und Argumente (Allowlist, Laengenlimits, Metachar-Filter)
- Runtime-Timeout fuer Agent-Prozesse mit kontrollierter Terminierung
- Electron-Bridge fuer Registry-, Start/Stop-, Delete- und Log-Operationen
- Agent-Registry-Store im Renderer inkl. Auswahl, Create/Update, Enable/Disable, Delete
- Agent-Logs im AI/Agents-Panel sichtbar

## Phase 9: Sichere File Tools mit Diff und Undo

Umgesetzt:

- DiffPanel mit farbiger Diff-Darstellung (+ gruen, - rot, @@ cyan) fuer activePendingChange
- Apply/Verwerfen/Zuruecksetzen-Buttons direkt im DiffPanel
- Anzeige der zuletzt angewendeten Aenderungen
- FileToolsPanel mit Restore-Point-Verwaltung (Erstellen, Anzeigen, Wiederherstellen, Loeschen)
- Undo fuer letztes Schreiben der aktiven Datei im FileToolsPanel
- Bereinigung alter Restore Points ab 10 Eintraegen
- Bestehende Infrastruktur genutzt: fileChangeService, restorePointService, editorStore, gitStore

## Phase 10: Terminal- und Git-Integration

Umgesetzt:

- IPC-Namespace dbzs:terminal:session:* fuer persistente Shell-Sessions
  (start, write, kill) mit powershell.exe auf Windows
- Streaming-Events dbzs:terminal:output und dbzs:terminal:exit
  via mainWindow.webContents.send zu Renderer
- Preload-Bridge erweitert: terminalSessionStart, terminalSessionWrite,
  terminalSessionKill, onTerminalOutput, onTerminalExit
- Globale TypeScript-Typen in global.d.ts ergaenzt
- TerminalPanel: interaktives Terminal im rechten Sidebar-Panel
  - Shell-Session-Modus (interaktiv) und Einzel-Exec-Modus
  - Scrollbarer Output mit stdout/stderr/system-Farben
  - 500-Zeilen-Puffer mit Auto-Scroll
- Git-Integration: gitService, GitPanel, GitStore bereits vollstaendig
  aus Phase 10-Vorarbeiten vorhanden

## Phase 11: Packaging und Release-Prozess

Umgesetzt:

- electron-builder als devDependency in apps/desktop/package.json
- electron-builder.yml: AppId de.dbzs.codee, Win NSIS + Portable,
  Mac DMG, Linux AppImage, Backend als extraResources eingebunden
- Release-Skripts: release:win, release:mac, release:linux, release:all
- backend/run.py: uvicorn Entry-Point fuer PyInstaller-Bundle
- backend/build.py: PyInstaller-Script mit allen hidden-imports
  fuer fastapi/uvicorn; Ausgabe nach backend-dist/dbzs-backend/
- main.ts: startBackend() verzweigt zwischen gepacktem Modus
  (dbzs-backend.exe aus resources/) und Dev-Modus (uv run uvicorn)
- .gitignore: backend-dist/, dist-release/, backend/build-work/ ergaenzt
- Workflow: 1. uv run python backend/build.py  2. pnpm release:win

## Phase 6: SQLite Project Memory

Umgesetzt:

- Backend-Endpunkte `GET/PUT/DELETE /project-memory`
- SQLite-Persistenz fuer Workspace-Memory-Keys und Tags
- Electron-Bridge und Renderer-Store fuer Laden, Upsert, Delete
- UI-Panel fuer projektbezogene Memory-Eintraege

## Phase 7: Task Board

Umgesetzt:

- Backend-Endpunkte `GET/POST/PUT/DELETE /task-board`
- Task-Lebenszyklus mit Status (`todo`, `in_progress`, `done`) und Prioritaet
- Electron-Bridge und Renderer-Store fuer Board-Operationen
- UI-Panel fuer operative Aufgabenpflege

## Phase 8: Dokumentationsgenerator und Codeanalyse

Umgesetzt:

- Analyse-Endpunkt `GET /docs/analyze` mit Dateistatistiken und TODO/FIXME-Erkennung
- Generierungs-Endpunkt `POST /docs/generate` fuer Markdown-Zusammenfassungen
- Electron-Bridge und Renderer-Store fuer Analyse und Generierung
- UI-Panel zur workspace-bezogenen Doku-Unterstuetzung
