# Workspace-Sync — Wer erfährt vom geöffneten Projekt?

Stand: 2026-06-18

Nach **Projekt öffnen** (`openProjectDirectory` / `createProject`) muss jede Komponente, die `workspaceRoot` oder `workspaceFiles` braucht, aktualisiert werden.

## Ablauf beim Öffnen

```
openProjectDirectory()
  → setWorkspaceState (Electron main: currentWorkspaceState)
  → scanFiles()
  → notifyWorkspaceSynced(state, fileCount)
  → App useEffects reagieren auf workspaceState / workspaceFiles
  → publishRuntimeChatContext (IPC an detached Chat)
```

## Sync-Matrix

| System | Trigger | Daten | Status |
|--------|---------|-------|--------|
| **Workspace Store** | `openProjectDirectory`, `loadWorkspaceState` | `state`, `files[]` | ✅ |
| **Electron main** | `set-state` IPC | `currentWorkspaceState`, `commandExecutionService` | ✅ (Fix 2026-06-18) |
| **Runtime Chat (embedded)** | App props + `workspaceFiles` | root, name, files, activeFile | ✅ |
| **Runtime Chat (detached)** | `publishRuntimeChatContext` | inkl. `workspaceFiles` | ✅ (Fix 2026-06-18) |
| **Project Memory (SQLite lokal)** | `loadProjectMemory(projectPath)` | Frameworks, Tasks, Issues | ✅ |
| **Project Memory Metadaten** | `setDetectedWorkspaceData(files)` | Languages, Frameworks | ✅ (nach Scan) |
| **Code Index** | `buildWorkspaceIndex(projectPath)` | Suchindex | ✅ |
| **Git Panel** | `refreshGitStatus()` | Branch, Diff | ✅ |
| **Docs Analysis** | `setDocsWorkspaceRoot` | workspace root | ✅ |
| **Debug Agent** | `inspectLatestRun({ workspaceRoot, workspaceFiles })` | Kontext | ✅ |
| **Test Agent** | on-demand mit `projectPath` | Commands | ✅ |
| **Jobs / ATIF Trajectory** | Job-scoped, nicht workspace-scoped | job_id | ✅ (eigenes API) |
| **Backend Reload Recovery** | `reloadBackendStores` + health effect | re-scan, memory, git | ✅ (Fix 2026-06-18) |

## Plattform-Diagnose-Fenster

Alle Checks zentral: **Datei → Plattform-Diagnose** (`Ctrl+Shift+D`) oder Command Palette „Plattform-Diagnose öffnen“.

Zeigt live:

- Backend Health
- Workspace Sync (Pfad + Dateiscan)
- Runtime Chat IPC-Snapshot
- ATIF-light Trajectory (recent + Job-Panel-Link)
- letzter Chat-Workspace-Schritt


1. **Explorer:** Dateiliste sichtbar (nicht leer)
2. **Runtime Chat Chip:** `{Name} · N Dateien im Scan` mit **N > 0**
3. **Git Panel:** Branch/Status für Repo
4. **Job Monitor → Job wählen → Agent Trajectory:** kein „Failed to fetch“ (Backend + IPC)
5. **DevTools/Panel:** Activity nach Chat-Send → `N Dateien geladen`

## Bekannte Grenzen

- Kontext-Chat lädt max. **6 Dateiinhalte**, nicht die ganze Codebase
- **ATIF-light** zeigt Events pro **Job**, nicht pro Workspace
- **Installierte App** ohne Dev-Build enthält Fixes erst nach neuem Release

Siehe auch [`RUNTIME_CHAT_CONTEXT_ACCEPTANCE.md`](RUNTIME_CHAT_CONTEXT_ACCEPTANCE.md).
