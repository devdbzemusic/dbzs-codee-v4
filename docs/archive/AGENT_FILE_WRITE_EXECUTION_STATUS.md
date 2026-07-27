# Agent File Write Execution Status

## Root Cause

Normale Coding-Antworten konnten zwar strukturierte ProposedChanges erzeugen,
aber der sichere Schreibpfad war nicht durchgaengig verbunden:

- Modellantworten wurden im Runtime-Chat/Agent-Turn geparst und als lokale
  `ProposedChange`-Eintraege in den Editor-Store gelegt.
- Die vorhandene Electron-Pipeline (`PatchPipelineService`,
  `FileChangeService`, `RestorePointService`) konnte echte Dateien schreiben,
  war aber nur als Single-File-Pipeline erreichbar.
- Der alte `AgentPatchProposal`-Typ war ein Legacy-Artefakt des Backend-Agent-
  Runners und kein zentraler Contract fuer reviewbare Multi-File-Patches.
- Es gab keinen zentralen Coordinator, der Proposal, Preview, Approval,
  Apply, Verifikation und Rollback als einen nachvollziehbaren Ablauf kapselt.

## Implementierter Datenfluss

Diese Phase verbindet den sicheren lokalen Schreibpfad im Electron-Host:

```text
AgentPatchProposal
-> Contract- und Boundary-Validierung
-> Diff Preview ueber PatchPipelineService
-> approvalVersion
-> explizite Freigabe
-> Restore Point fuer alle betroffenen Dateien
-> Safe Apply ueber PatchPipelineService
-> Delete ueber RestorePoint + fs.rm ohne Shell
-> Inhalts-/Delete-Verifikation
-> Rollback ueber RestorePointService
```

Der Coordinator schreibt nicht aus dem Renderer heraus und verwendet keine
Shell-Kommandos fuer Dateioperationen.

## Neue Contracts

In `packages/shared/src/index.ts`:

- `AgentFileChangeProposal`
- `AgentPatchProposal`
- `AgentFileChangePreview`
- `AgentPatchPreview`
- `AgentPatchApplyResult`
- `PatchValidationResult`
- `AgentPatchState`

Der alte Backend-AgentRunner-Artefakttyp ist jetzt als
`AgentRunnerPatchProposal` getrennt.

## Geaenderte/Neue Dateien

- `packages/shared/src/index.ts`
- `apps/desktop/electron/agentPatchCoordinator.ts`
- `apps/desktop/electron/agentPatchCoordinator.test.ts`
- `apps/desktop/electron/main.ts`
- `apps/desktop/electron/preload.ts`
- `apps/desktop/src/types/global.d.ts`
- `apps/desktop/src/stores/agentRunnerStore.ts`
- `apps/desktop/package.json`
- `package.json`

## Nachweise

Der neue Befehl `pnpm test:file-apply` fuehrt einen echten
Dateisystem-Acceptance-Test aus:

- temporaerer Workspace
- reale Datei `src/math.ts`
- Diff `a - b` -> `a + b`
- explizite Freigabe per `approvalVersion`
- echter Apply auf Festplatte
- Git-Diff enthaelt die erwartete Aenderung
- Restore Point vorhanden
- Rollback stellt den Originalinhalt wieder her

Zusaetzlich getestet:

- Create einer Textdatei
- Delete mit Restore Point
- Pfad ausserhalb Workspace blockiert
- stale approval wird blockiert

## Bekannte Einschraenkungen

Diese Phase stellt den sicheren Host-Schreibpfad und den realen Nachweis her.
Noch nicht vollstaendig umgesetzt sind:

- UI fuer einzelne Datei-Abwahl innerhalb eines Multi-File-Proposals
- Persistierte Proposal-Liste ueber App-Neustarts hinweg
- automatische Validierungskommandos nach Apply im Coordinator
- Reparaturschleife mit neuer Freigabe pro Folgepatch
- vollstaendige Workbench-Review-Gate-Synchronisation fuer jede Runtime-Chat-
  Antwort

## Naechste Phase

Als naechstes sollte der Runtime-Chat den neuen `AgentPatchProposal`-Contract
direkt aus `propose_file_changes`-Toolausgaben erzeugen und die bestehende
Diff-/Approval-UI an die neuen IPC-Methoden binden:

- `previewAgentPatch`
- `approveAgentPatch`
- `rejectAgentPatch`
- `applyAgentPatch`
- `rollbackAgentPatch`
