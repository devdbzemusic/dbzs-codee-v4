# CODEX TASK — Safe Agent Terminal and Shell Execution

Repository: `devdbzemusic/dbzs-codee-project`

## Ziel

CODEE soll Agentenbefehle im Terminal beziehungsweise in der Shell kontrolliert ausführen können.

Der Agent darf keine beliebigen Shell-Strings direkt ausführen. Jeder Befehl muss über eine sichere, typisierte Command-Pipeline laufen:

```text
Runtime Chat / Agent Run
→ strukturierter Tool Call
→ Command Validation
→ Workspace Boundary
→ Policy / Allowlist
→ Benutzerfreigabe, falls erforderlich
→ Host Action run_command
→ Electron Main Process
→ Child Process
→ Live stdout/stderr
→ Exit Code / Timeout / Abort
→ Ergebnis zurück in Agent Run und Chat
```

Vorhandene Komponenten wie `agentHostExecutor`, Host Action `run_command` und Safe-Command-Infrastruktur wiederverwenden.

Keine zweite Terminal-Architektur bauen.
Keine direkte Shell-Ausführung aus dem Renderer.
Keine unvalidierten Modellbefehle ausführen.

## 1. Bestehenden Command-Pfad auditieren

Prüfe mindestens:

```text
apps/desktop/src/services/agentHostExecutor.ts
apps/desktop/src/services/agentWorkbenchService.ts
apps/desktop/src/services/runtimeChatAgentRunner.ts
apps/desktop/src/services/agentRunService.ts
apps/desktop/electron/main.ts
apps/desktop/electron/preload.ts
packages/shared/src/index.ts
backend/app/agent_workbench/
backend/app/runtime/
```

Dokumentiere:

1. vorhandene Safe Commands
2. Mapping von Command-IDs auf Prozesse
3. Rückgabe von stdout, stderr und Exit Code
4. Cancel- und Timeout-Pfad
5. Workspace-Boundary-Prüfung
6. fehlende Verbindung zum normalen Agentenlauf

## 2. Zentralen Command-Contract definieren

```ts
export type AgentCommandRisk = "low" | "medium" | "high";

export interface AgentCommandRequest {
  id: string;
  runId: string;
  commandId: string;
  args?: string[];
  cwd?: string;
  reason: string;
  riskLevel: AgentCommandRisk;
  requiresApproval: boolean;
  timeoutMs?: number;
  createdAt: string;
}

export interface AgentCommandResult {
  requestId: string;
  runId: string;
  commandId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}
```

Keine freien Command-Strings als primärer Contract.

## 3. Tool `run_workspace_command`

```json
{
  "name": "run_workspace_command",
  "arguments": {
    "command_id": "typecheck",
    "args": [],
    "cwd": ".",
    "reason": "Verify the proposed TypeScript changes.",
    "risk_level": "low",
    "requires_approval": false,
    "timeout_ms": 120000
  }
}
```

Erlaubte Beispiele:

```text
typecheck
test
test:file-apply
test:chat-file-apply
build
lint
format-check
git-status
git-diff
```

Das Modell darf nur bekannte Command-IDs anfordern.

## 4. Zentrale Command Registry

```ts
export interface SafeCommandDefinition {
  id: string;
  executable: string;
  args: string[];
  allowedExtraArgs?: string[];
  cwdPolicy: "workspace-root" | "workspace-subdirectory";
  timeoutMs: number;
  riskLevel: AgentCommandRisk;
  requiresApproval: boolean;
  allowNetwork: boolean;
  allowWrite: boolean;
}
```

Anforderungen:

- `spawn()` mit Argumentarray statt `exec()`
- keine Shell-Interpolation
- keine Pipes, Redirects, `&&`, `||`, `;`
- keine freien `cmd /c`, `powershell -Command`, `sh -c` oder `bash -c`
- zusätzliche Argumente nur aus Allowlist
- keine beliebigen Umgebungsvariablen
- Secrets nicht protokollieren

## 5. Plattformübergreifende Ausführung

Unterstütze Windows und die bereits vorgesehenen weiteren Plattformen.

Berücksichtige insbesondere:

- `pnpm.cmd` auf Windows
- UTF-8
- Pfadnormalisierung
- keine feste Abhängigkeit von PowerShell

## 6. Workspace Boundary

`cwd` muss innerhalb des aktiven Workspace liegen.

Blockieren:

```text
..
absolute Pfade außerhalb Workspace
Symlink-Ausbruch
UNC-Ausbruch
Laufwerkswechsel
Reparse-Point-Ausbruch
```

Vor Start Realpath und Boundary prüfen.

## 7. Risiko- und Approval-Modell

Niedriges Risiko:

```text
typecheck
test
lint
build
git-status
git-diff
```

Mittleres Risiko:

```text
format
code generation
dependency install
migration dry-run
```

Hohes Risiko:

```text
Dateien löschen
git reset/clean
git commit
git push
publish
deploy
schreibende Migrationen
Netzwerkdownloads
Systeminstallation
```

Standard:

```text
git commit: nicht automatisch
git push: blockiert
deploy: blockiert
sudo/admin: blockiert
```

## 8. Host Action `run_command`

```json
{
  "action_type": "run_command",
  "payload": {
    "workspace_root": "...",
    "command_id": "typecheck",
    "args": [],
    "cwd": ".",
    "timeout_ms": 120000,
    "proposal_id": "...",
    "run_id": "..."
  }
}
```

Host Executor:

1. Action claimen
2. Registry auflösen
3. Policy prüfen
4. Prozess starten
5. Logs streamen
6. Timeout/Cancel unterstützen
7. Resultat persistieren
8. Action abschließen

## 9. Live stdout/stderr

```ts
export interface AgentCommandOutputEvent {
  requestId: string;
  runId: string;
  stream: "stdout" | "stderr";
  chunk: string;
  sequence: number;
  timestamp: string;
}
```

Anforderungen:

- Reihenfolge erhalten
- keine doppelten Chunks
- Logs begrenzen
- vollständiges Ergebnis separat persistieren
- Secrets redigieren

## 10. Timeout und Cancel

Jeder Prozess benötigt:

- eindeutige Run-ID
- AbortController
- Timeout
- Prozessbaum-Cleanup in `finally`

Windows: Child-Prozessbaum beenden.
Unix: Prozessgruppe verwenden, falls erforderlich.

Status:

```text
queued
running
succeeded
failed
cancelled
timed_out
```

## 11. Terminal-UI

Bestehendes Terminal-/Log-Panel erweitern.

Anzeigen:

```text
Command
CWD
Reason
Risk Level
Status
Live stdout
Live stderr
Exit Code
Duration
Cancel
Retry
```

## 12. Verbindung zum Patch-Workflow

Nach `applyAgentPatch` müssen `validationCommands` über dieselbe Command-Pipeline laufen:

```text
Patch angewendet
→ typecheck
→ test
→ Ergebnis an Patch Coordinator
→ Chat und Agent Run aktualisieren
```

Keine zweite Test-Ausführungsschiene.

## 13. Fehler zurück in den Agentenlauf

Fehlgeschlagene Commands strukturiert zurückgeben:

```text
Command: test
Exit Code: 1
stdout: ...
stderr: ...
```

Der Agent darf danach einen neuen Patch vorschlagen. Maximalgrenzen beachten.

## 14. Explizit blockieren

```text
rm -rf
del /s /q
format
diskpart
shutdown
reboot
reg delete
sudo
runas
curl | sh
wget | sh
Invoke-Expression
powershell -EncodedCommand
git reset --hard
git clean -fdx
git push --force
npm publish
pnpm publish
docker system prune
```

Primär durch Registry und strukturierte Argumente blockieren, nicht nur durch Stringsuche.

## 15. Environment Policy

Nur erlaubte Variablen übergeben, z. B.:

```text
NODE_ENV
CI
FORCE_COLOR
PYTHONUTF8
```

API Keys, Tokens, Passwörter, SSH-Secrets und Cloud Credentials weder an Modell noch Logs ausgeben.

## 16. Acceptance-Test

Temporärer Workspace:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

Testablauf:

1. Agent erzeugt `run_workspace_command`
2. Command wird validiert
3. Prozess startet im temporären Workspace
4. stdout/stderr werden erfasst
5. Exit Code wird zurückgegeben
6. Agent Run erhält Ergebnis
7. Chat zeigt Resultat
8. kein verwaister Prozess bleibt

Cancel-Test:

1. lang laufenden erlaubten Prozess starten
2. Cancel auslösen
3. Prozessbaum beenden
4. Status `cancelled`
5. keine weiteren Chunks

## 17. Pflicht-Tests

1. erlaubter Command erfolgreich
2. erlaubter Command schlägt fehl
3. unbekannte Command-ID blockiert
4. freier Shell-String blockiert
5. Argument außerhalb Allowlist blockiert
6. CWD außerhalb Workspace blockiert
7. Symlink-Ausbruch blockiert
8. Timeout beendet Prozess
9. Cancel beendet Prozessbaum
10. stdout/stderr Reihenfolge stabil
11. Secrets redigiert
12. High-Risk benötigt Freigabe
13. blockierter Command startet nicht
14. Patch Validation nutzt dieselbe Pipeline
15. Ergebnis geht in Agent Run zurück
16. maxCommandCount erzwungen
17. keine verwaisten Prozesse

## 18. Testkommando

```powershell
pnpm test:agent-shell
```

Der Test muss reale Prozesse im temporären Workspace starten.

## 19. Qualitäts-Gates

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm doctor:all
pnpm smoke-test
pnpm test:capabilities
pnpm test:coding-loop
pnpm test:file-apply
pnpm test:chat-file-apply
pnpm test:agent-shell
```

## 20. Definition of Done

Der Nutzer kann schreiben:

```text
Prüfe das Projekt mit Typecheck und Tests.
```

CODEE muss:

1. strukturierte Command Requests erzeugen
2. nur erlaubte Commands verwenden
3. im aktiven Workspace ausführen
4. Live-Ausgabe zeigen
5. Cancel und Timeout unterstützen
6. Exit Codes auswerten
7. Resultate in Chat und Agent Run zurückgeben
8. bei Fehlern Reparaturschleife ermöglichen
9. keine freien Shell-Befehle ausführen
10. keine Prozesse zurücklassen

## 21. Nicht Teil dieser Phase

Nicht umsetzen:

- uneingeschränkte interaktive Shell für das Modell
- automatische Commits oder Pushes
- Deployment
- Paketveröffentlichung
- Systemadministration
- sudo/admin
- freie Netzwerkdownloads
- Ausführung außerhalb des Workspace

## 22. Abschlussbericht

Liefern:

1. vorhandener Command-Pfad
2. identifizierte Integrationslücke
3. Command Registry und Policy
4. geänderte Dateien
5. unterstützte Command-IDs
6. Streaming-Nachweis
7. Cancel-/Timeout-Nachweis
8. Security-Tests
9. Qualitäts-Gates
10. bekannte Einschränkungen

Empfohlene Commits:

```text
feat(agent): add structured workspace command contract
feat(host): execute safe agent commands
feat(terminal): stream agent command output
feat(policy): enforce command registry and approvals
feat(patch): validate applied changes through command pipeline
test(agent): prove safe terminal execution and cancellation
docs(status): document agent shell capability
```
