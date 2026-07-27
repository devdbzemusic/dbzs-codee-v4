# DBZS Security Model

**Dokument-Version:** 1.0  
**Letzte Aktualisierung:** 2026-06-11  
**Geltungsbereich:** Desktop-App, Backend, Agent-Execution

---

## 1. Übersicht

Dieses Dokument beschreibt die Sicherheitsarchitektur des DBZS Code Assistant. Es richtet sich an:

- Entwickler, die neue Features implementieren
- Security-Reviewer, die die Anwendung prüfen
- Administratoren, die die Anwendung in sensiblen Umgebungen betreiben

---

## 2. Sicherheitsprinzipien

### 2.1 Defense in Depth

Mehrere Sicherheitsebenen schützen vor Fehlkonfiguration und Missbrauch:

```
┌─────────────────────────────────────────────────────────────┐
│  Renderer (Sandbox)                                         │
│  - Kein Node.js Zugriff                                     │
│  - Kein direkter Dateisystemzugriff                         │
│  - Nur explizite window.dbzs API                            │
└─────────────────────────────────────────────────────────────┘
                          ↓ IPC (validiert)
┌─────────────────────────────────────────────────────────────┐
│  Electron Main Process                                      │
│  - Workspace Path Validation                                │
│  - Command Allowlists                                       │
│  - Timeout-Begrenzungen                                     │
└─────────────────────────────────────────────────────────────┘
                          ↓ HTTP (localhost only)
┌─────────────────────────────────────────────────────────────┐
│  FastAPI Backend (127.0.0.1:8876)                           │
│  - Agent Command Validation                                 │
│  - Model Path Validation                                    │
│  - SQLite mit Foreign Keys                                  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Least Privilege

- Agenten dürfen nur explizit erlaubte Commands ausführen
- Workspace-Zugriff ist auf das aktive Projekt beschränkt
- Git-Operationen sind read-only (Intelligence) oder user-bestätigt (Commit)

### 2.3 Secure by Default

- Shell-Zugriff (`powershell`, `cmd`) ist standardmäßig **deaktiviert**
- Cloud-Modelle sind standardmäßig **deaktiviert**
- Telemetrie ist standardmäßig **deaktiviert**

---

## 3. Bedrohungsmodell

### 3.1 Abgewehrte Risiken

| Bedrohung | Schutzmaßnahme | Status |
|-----------|----------------|--------|
| Command Injection (Shell) | `shell: false` bei subprocess | ✅ |
| Path Traversal | `ensurePathInsideWorkspace()` | ✅ |
| Agent Missbrauch | Command Allowlist | ✅ |
| Credential Leak | Keine Secrets in Logs/Commits | ✅ |
| XSS im Renderer | `contextIsolation: true` | ✅ |
| RCE via IPC | Explizite Preload-Bridge | ✅ |

### 3.2 Restrisiken

| Risiko | Beschreibung | Gegenmaßnahme |
|--------|--------------|---------------|
| User-Fehler | User bestätigt riskante Commits | Restore Points |
| Git-Misconfiguration | Falscher Branch/Upstream | Divergenz-Warnungen |
| Agent-Logikfehler | Agent wählt unerwünschte Files | Review-Pflicht |

---

## 4. Agent Security

### 4.1 Command Allowlist

Standardmäßig erlaubte Commands (sicherer Default):

```python
DEFAULT_AGENT_ALLOWED_COMMANDS = frozenset([
    "node",
    "python",
    "python.exe",
    "uv",
    "pnpm",
    "npm",
    "pytest",
    "git",
])
```

**Nicht im Default enthalten** (nur mit expliziter Konfiguration):

```python
SHELL_COMMANDS = frozenset([
    "powershell",
    "powershell.exe",
    "pwsh",
    "cmd",
    "cmd.exe",
])
```

### 4.2 Konfiguration

#### Umgebungsvariablen

| Variable | Zweck | Default | Beispiel |
|----------|-------|---------|----------|
| `DBZS_AGENT_ALLOWED_COMMANDS` | Eigene Allowlist | Siehe oben | `node,python,pnpm,git` |
| `DBZS_AGENT_ALLOW_SHELL` | Shell-Commands erlauben | `false` | `true` |
| `DBZS_AGENT_MAX_RUNTIME_SECONDS` | Maximale Laufzeit | `3600` | `1800` |
| `DBZS_AGENT_TERMINATE_TIMEOUT_SECONDS` | Kill-Timeout | `3` | `5` |

#### Beispiel: Restriktive Entwicklungsumgebung

```bash
# Nur Build/Tool-Commands, keine Shell
DBZS_AGENT_ALLOWED_COMMANDS=node,python,pnpm,npm,git
DBZS_AGENT_ALLOW_SHELL=false
```

#### Beispiel: Erweiterte Umgebung (nur vertrauenswürdige Workspaces)

```bash
# Mit PowerShell für lokale Automation
DBZS_AGENT_ALLOWED_COMMANDS=node,python,pnpm,git,powershell
DBZS_AGENT_ALLOW_SHELL=true
```

### 4.3 Argument-Validierung

```python
UNSAFE_ARGUMENT_PATTERN = re.compile(r"[;&|`><]|\$\(|\)\s*\{")

# Blockiert:
# - Command-Chaining: ; | &
# - Redirection: > <
# - Command-Substitution: $(...)
# - Unerwartete Syntax: ){
```

**Limits:**
- Max. 32 Argumente pro Command
- Max. 512 Zeichen pro Argument

---

## 5. Workspace Security

### 5.1 Path Validation

Alle Dateipfade werden validiert:

```typescript
function ensurePathInsideWorkspace(workspaceRoot: string, candidatePath: string): string {
  const root = toResolvedPath(workspaceRoot);
  const candidate = toResolvedPath(candidatePath);
  const relative = path.relative(root, candidate);

  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return candidate;
  }

  throw new Error("Path is outside of current workspace.");
}
```

**Schützt vor:**
- Zugriff auf `../secret.txt`
- Absolute Pfade außerhalb des Workspace
- Symlink-basierte Escape-Versuche (Symlinks werden ignoriert)

### 5.2 Restore Points

Vor riskanten Operationen werden Snapshots erstellt:

| Auslöser | Restore-Point-Typ | Dateien |
|----------|-------------------|---------|
| Agent-Patch | `before_patch` | Geänderte Files |
| Commit | `before_commit` | Staged Files |
| Agent-Run | `before_agent_run` | Konfigurierbar |
| Debug-Fix | `before_debug_fix` | Betroffene Files |

**Speicherort:** `.codee/restore-points/` (workspace-lokal)

---

## 6. Secrets Management

### 6.1 Regeln

**Niemals committen:**
- API-Keys (`openaiApiKey`, `anthropicApiKey`)
- Tokens (GitHub, GitLab, etc.)
- Private Schlüssel (SSH, GPG)
- Passwörter

**Stattdessen:**
- Platzhalter: `"openaiApiKey": "YOUR_API_KEY_HERE"`
- Umgebungsvariablen: `process.env.OPENAI_API_KEY`
- Lokale Config-Dateien (`.env`, `.dbzs/config.json`)

### 6.2 .gitignore

Folgende Dateien sind standardmäßig ignoriert:

```gitignore
# Secrets
.env
.env.local
*.pem
*.key

# Lokale Konfiguration
.dbzs/
.codee/

# Build-Artefakte
node_modules/
dist/
__pycache__/
```

### 6.3 Secret-Erkennung

Bei der Entwicklung gilt:

1. **Pre-Commit-Check:** Keine Secrets in `git diff`
2. **Log-Review:** Keine Secrets in Console/Backend-Logs
3. **Error-Messages:** Keine Secrets in Stack-Traces

---

## 7. Electron Security

### 7.1 Renderer-Sandbox

```typescript
// main.ts
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  preload: path.join(__dirname, "preload.js")
}
```

**Konsequenzen:**
- Renderer kann nicht auf `require()` zugreifen
- Kein direkter `fs` oder `child_process` Zugriff
- Alle IPC-Aufrufe laufen durch `preload.ts`

### 7.2 Preload-Bridge

Nur explizit freigegebene APIs sind verfügbar:

```typescript
// preload.ts
contextBridge.exposeInMainWorld("dbzs", {
  // Explizite Methoden
  openFileDialog: () => ipcRenderer.invoke("dbzs:file:open-dialog"),
  saveFile: (request) => ipcRenderer.invoke("dbzs:file:save", request),
  // ...
});
```

### 7.3 IPC-Validierung

Jeder IPC-Handler validiert:

1. Workspace-Zugehörigkeit
2. Pfad-Safety
3. User-Intent (bei Mutationen)

---

## 8. Backend Security

### 8.1 Localhost-Only

Das FastAPI Backend bindet ausschließlich an `127.0.0.1:8876`:

```python
# start-dev.ps1 / Produktion
uvicorn app.main:app --host 127.0.0.1 --port 8876
```

**Schutz vor:**
- Externem Zugriff aus dem Netzwerk
- Port-Scanning auf öffentlichen Interfaces

### 8.2 SQLite Foreign Keys

Datenbanken verwenden Foreign Keys mit Cascade-Delete:

```sql
CREATE TABLE agent_logs (
    agent_id TEXT NOT NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
)
```

### 8.3 Input-Validierung

Alle API-Requests werden typisiert:

```python
@router.post("/agents")
def create_agent(request: AgentCreateRequest) -> AgentRecord:
    # Pydantic validiert Typen automatisch
    return service.create_agent(request)
```

---

## 9. Git Intelligence Security

### 9.1 Read-Only Default

Git-Intelligence verwendet ausschließlich sichere Commands:

| Command | Zweck | Risiko |
|---------|-------|--------|
| `git status --porcelain` | Status | Keines |
| `git diff` | Diff | Keines |
| `git diff --stat` | Statistik | Keines |
| `git branch --show-current` | Branch | Keines |
| `git rev-list` | Divergenz | Keines |

### 9.2 Commit-Assistant

Commit-Operationen erfordern:

1. Explizite `includeFiles`-Liste
2. Workspace-Validierung aller Pfade
3. Optional: Restore-Point vor Commit

### 9.3 Kein Auto-Push/Pull

**Non-Goal:** Automatische Remote-Operationen

- Kein automatischer `git push`
- Kein automatischer `git pull`
- Kein automatischer `git merge`

---

## 10. Security Checklist für Entwickler

### 10.1 Neue Features

- [ ] Pfad-Validierung mit `ensurePathInsideWorkspace()`
- [ ] IPC-Handler in `main.ts` absichern
- [ ] Preload-Bridge erweitern (nicht direkt im Renderer)
- [ ] Backend-API mit Pydantic-Schema validieren
- [ ] Secrets aus Code/Logs fernhalten

### 10.2 Agent-Erweiterungen

- [ ] Command in Allowlist aufnehmen (oder dokumentieren)
- [ ] Argument-Limits prüfen
- [ ] UNSAFE_ARGUMENT_PATTERN testen
- [ ] Timeout-Konfiguration berücksichtigen

### 10.3 Release-Check

- [ ] Keine API-Keys in Commits
- [ ] `.env` in `.gitignore`
- [ ] Backend nur auf 127.0.0.1
- [ ] Electron-Security-Einstellungen prüfen

---

## 11. Incident Response

### 11.1 Verdacht auf Secret-Leak

1. Secret sofort rotieren
2. Commit-History prüfen (`git log -p --all`)
3. Betroffene Commits mit `git filter-branch` bereinigen
4. In `SECURITY.md` dokumentieren (ohne Details)

### 11.2 Agent-Missbrauch

1. `DBZS_AGENT_ALLOWED_COMMANDS` restriktiv setzen
2. `DBZS_AGENT_ALLOW_SHELL=false` erzwingen
3. Agent-Logs prüfen (`.dbzs/agents.sqlite3`)
4. Restore-Point verwenden bei Änderungen

---

## 12. Referenzen

- [Electron Security Best Practices](https://www.electronjs.org/docs/latest/tutorial/security)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- `docs/ARCHITECTURE.md` — Architektur-Übersicht
- `docs/GIT_INTELLIGENCE.md` — Git-Safety-Modell
- `AGENTS.md` — Plattform-Leitbild

---

## 13. Änderungshistorie

| Version | Datum | Autor | Änderung |
|---------|-------|-------|----------|
| 1.0 | 2026-06-11 | Codex | Initialversion nach Code Review |

