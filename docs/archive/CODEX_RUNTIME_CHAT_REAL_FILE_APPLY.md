# CODEX TASK — Runtime Chat to Real File Apply Integration

Repository:

`devdbzemusic/dbzs-codee-project`

## Ausgangslage

Der sichere lokale Schreibpfad ist bereits implementiert und per echtem Dateisystem-Acceptance-Test nachgewiesen.

Vorhanden sind unter anderem:

- `AgentPatchCoordinator`
- `PatchPipelineService`
- `FileChangeService`
- `RestorePointService`
- `AgentPatchProposal`
- `AgentFileChangeProposal`
- `previewAgentPatch`
- `approveAgentPatch`
- `rejectAgentPatch`
- `applyAgentPatch`
- `rollbackAgentPatch`
- echter Datei-Apply
- Restore Point
- Rollback
- Workspace Boundary
- Create/Modify/Delete-Grundlage
- `pnpm test:file-apply`

Was fehlt, ist die produktive End-to-End-Verbindung vom normalen Runtime Chat bis zur echten Dateiänderung.

## Ziel

Ein Nutzer soll in CODEE schreiben können:

```text
Ändere in src/math.ts die Subtraktion zu einer Addition.
```

Danach muss CODEE:

```text
Runtime Chat
→ Agent/LLM erzeugt propose_file_changes
→ AgentPatchProposal
→ Patch Preview
→ Diff UI
→ Nutzerfreigabe
→ applyAgentPatch
→ echte Dateiänderung
→ Workspace/Monaco/Git Refresh
→ Safe Validation Commands
→ Ergebnis zurück in Chat und Agent Run
```

Keine neue Patch-Pipeline bauen.
Keine zweite Proposal-Struktur einführen.
Keine direkte Dateiänderung aus dem Renderer.
Bestehende Contracts und IPC-Methoden wiederverwenden.

## 1. Bestehenden Runtime-Chat-Pfad auditieren

Prüfe mindestens:

```text
apps/desktop/src/stores/runtimeChatStore.ts
apps/desktop/src/services/runtimeChatAgentRunner.ts
apps/desktop/src/services/agentRunService.ts
apps/desktop/src/services/backendClient.ts
apps/desktop/src/services/agentWorkbenchService.ts
apps/desktop/src/services/agentHostExecutor.ts
apps/desktop/electron/agentPatchCoordinator.ts
apps/desktop/electron/preload.ts
apps/desktop/electron/main.ts
packages/shared/src/index.ts
backend/app/runtime/
backend/app/agent_workbench/
backend/app/review_gates/
```

Dokumentiere vor der Implementierung:

1. wo Tool Calls im Runtime Chat erkannt werden
2. wie Tool-Argumente aktuell validiert werden
3. wo Chat-Antworten in den Store geschrieben werden
4. wie Agent Runs und Runtime Chat aktuell verbunden sind
5. warum `AgentPatchProposal` noch nicht automatisch aus normalen Coding-Anfragen entsteht
6. welche vorhandenen UI-Komponenten für Diff und Approval wiederverwendet werden können

## 2. `propose_file_changes` als internes Agent-Tool registrieren

Führe ein strukturiertes Tool ein oder vervollständige den vorhandenen Tool-Contract:

```json
{
  "name": "propose_file_changes",
  "description": "Proposes one or more safe workspace file changes for user review.",
  "arguments": {
    "title": "Fix math implementation",
    "summary": "Replace subtraction with addition.",
    "changes": [
      {
        "file_path": "src/math.ts",
        "change_type": "modify",
        "proposed_content": "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
        "reason": "The function currently subtracts instead of adding.",
        "risk_level": "low"
      }
    ],
    "validation_commands": [
      "typecheck",
      "test"
    ]
  }
}
```

### Anforderungen

- Tool-Ausgabe strikt validieren
- nur workspace-relative Pfade akzeptieren
- `change_type` nur `create`, `modify`, `delete`
- `proposed_content` für `create` und `modify` erforderlich
- `delete` ohne `proposed_content`
- keine freien Shell-Kommandos
- keine Markdown-Codeblöcke automatisch ausführen
- keine Dateiänderung während des Tool Calls
- Tool erzeugt ausschließlich ein reviewbares Proposal

## 3. Tool-Ausgabe in `AgentPatchProposal` überführen

Verwende den bestehenden zentralen Shared Contract.

Keine neue Parallelstruktur wie:

```text
RuntimePatch
ChatPatch
ToolPatch
SuggestedEdit
```

Die Tool-Ausgabe muss exakt in einen `AgentPatchProposal` normalisiert werden.

Pflichtfelder:

```ts
{
  id: string;
  runId: string;
  title: string;
  summary: string;
  changes: AgentFileChangeProposal[];
  validationCommands?: string[];
  createdAt: string;
}
```

Zusätzlich:

- `decisionId` aus dem aktuellen Model Selection Broker übernehmen
- Chat-Turn-ID speichern
- Workspace-ID oder Workspace-Root referenzieren
- Proposal mit Agent Run und Chat Message verknüpfen
- identische Proposal-ID durch Preview, Approval, Apply und Resultat führen

## 4. Runtime-Chat-Store erweitern

Erweitere den bestehenden Store minimal.

Benötigte Zustände:

```ts
activePatchProposal: AgentPatchProposal | null;
activePatchPreview: AgentPatchPreview | null;
patchState: AgentPatchState | null;
patchError: string | null;
patchValidationResult: PatchValidationResult | null;
```

Benötigte Actions:

```ts
receivePatchProposal(...)
previewPatch(...)
approvePatch(...)
rejectPatch(...)
applyPatch(...)
rollbackPatch(...)
validatePatch(...)
clearPatchState(...)
```

Anforderungen:

- kein Proposal darf durch eine spätere normale Assistant-Textantwort überschrieben werden
- Apply-Status muss unabhängig vom Textstream bestehen bleiben
- stale Approval blockieren
- Workspace-Wechsel invalidiert offene Proposals
- Chat-Abbruch darf keinen bereits laufenden Apply inkonsistent machen
- Agent Run und Chat Store müssen dieselbe Proposal-ID verwenden

## 5. Patch Preview automatisch erzeugen

Nach erfolgreichem `propose_file_changes`:

1. `previewAgentPatch` aufrufen
2. Preview im Store speichern
3. Diff-UI öffnen
4. Chat-Nachricht mit Status erzeugen

Beispiel:

```text
CODEE hat 1 Dateiänderung vorbereitet.
Bitte prüfe den Diff und bestätige oder verwerfe die Änderung.
```

Nicht automatisch anwenden.

## 6. Bestehende Diff-/Approval-UI anbinden

Keine neue große Oberfläche bauen.

Verwende oder erweitere vorhandene Komponenten.

Die UI muss mindestens anzeigen:

```text
Proposal-Titel
Zusammenfassung
Dateien
Änderungstyp
Begründung
Risiko
Diff
Validierungsbefehle
Status
```

Benötigte Buttons:

```text
Übernehmen
Ablehnen
Rollback
Tests starten
Datei öffnen
```

Optional:

```text
Einzelne Datei abwählen
```

Diese Option darf als nächste Teilphase markiert werden, falls sie noch nicht vorhanden ist.

## 7. Approval und Apply korrekt verknüpfen

Beim Klick auf „Übernehmen“:

```text
approveAgentPatch(proposalId, approvalVersion)
→ applyAgentPatch(proposalId, approvalVersion)
```

Anforderungen:

- Approval-Version prüfen
- Preview-Version prüfen
- stale Proposal blockieren
- Apply-Button während Ausführung deaktivieren
- Statusübergänge anzeigen
- kein doppelter Apply
- bei App-Neuladen keine automatische Wiederholung

Zustände:

```text
PROPOSED
PREVIEW_READY
WAITING_FOR_APPROVAL
APPROVED
APPLYING
APPLIED
VALIDATING
PASSED
FAILED
ROLLED_BACK
REJECTED
```

## 8. Nach Apply Workspace und Editor aktualisieren

Nach erfolgreichem Apply:

- betroffene Dateien neu laden
- Monaco Editor aktualisieren
- Workspace-Dateiliste aktualisieren
- Git Status aktualisieren
- Git Diff aktualisieren
- offene Tabs synchronisieren
- Agent Run Status aktualisieren

Der Nutzer darf nicht manuell neu laden müssen.

## 9. Safe Validation Commands ausführen

Nach erfolgreichem Apply:

- `validationCommands` aus dem Proposal lesen
- nur bestehende Allowlist-Command-IDs akzeptieren
- keine freien Befehlsstrings
- sequenziell ausführen
- stdout/stderr/exitCode erfassen
- Ergebnis in `PatchValidationResult` speichern

Beispiel erlaubter IDs:

```text
typecheck
test
build
lint
```

Die tatsächliche Zuordnung muss über bestehende Safe-Command-Infrastruktur erfolgen.

## 10. Resultat zurück in Runtime Chat und Agent Run

Nach Apply und Validierung muss CODEE eine strukturierte Statusmeldung erzeugen.

Erfolg:

```text
Änderung angewendet.

Dateien:
- src/math.ts

Validierung:
- typecheck: erfolgreich
- test: erfolgreich

Restore Point:
- verfügbar
```

Fehler:

```text
Änderung wurde angewendet, aber die Validierung ist fehlgeschlagen.

Fehlgeschlagen:
- test

Der Fehler wurde an den Agentenlauf zurückgegeben.
Rollback ist verfügbar.
```

Anforderungen:

- Resultat als Chat Message
- Resultat als Agent Event
- Proposal-ID beibehalten
- tatsächliche Dateien und Command-Ergebnisse nennen
- keine erfundenen Erfolgsbehauptungen

## 11. Reparaturschleife anbinden

Wenn Validierung fehlschlägt:

1. Fehlerausgabe an bestehenden Agentenlauf zurückgeben
2. Agent darf neuen `propose_file_changes`-Call erzeugen
3. neuer Proposal benötigt neue Preview
4. neuer Proposal benötigt neue Freigabe
5. maxIterations beachten
6. kein stiller Auto-Apply

Die Schleife endet bei:

```text
Tests erfolgreich
maxIterations erreicht
Nutzer stoppt
Proposal abgelehnt
Rollback fehlgeschlagen
Workspace gewechselt
```

## 12. Rollback in UI und Chat integrieren

Nach Apply muss Rollback verfügbar sein.

Beim Rollback:

- `rollbackAgentPatch` aufrufen
- Dateien neu laden
- Monaco aktualisieren
- Git Status aktualisieren
- Chat-Nachricht erzeugen
- Agent Event speichern

Beispiel:

```text
Die Änderung wurde vollständig zurückgerollt.
```

Bei Multi-File-Patches muss der gesamte Patch-Satz konsistent zurückgerollt werden.

## 13. Verbindlicher End-to-End-Acceptance-Test

Erstelle einen echten Integrationstest mit temporärem Workspace.

Ausgangsdatei:

```ts
export function add(a: number, b: number): number {
  return a - b;
}
```

Nutzeranfrage:

```text
Korrigiere die add-Funktion.
```

Erwarteter Ablauf:

1. Runtime Chat startet Agent Run
2. Modell-/Tool-Fixture erzeugt `propose_file_changes`
3. `AgentPatchProposal` entsteht
4. `previewAgentPatch` erzeugt Diff
5. UI-/Store-Zustand ist `WAITING_FOR_APPROVAL`
6. Test genehmigt Proposal
7. `applyAgentPatch` ändert reale Datei
8. Monaco-/Workspace-Refresh wird ausgelöst
9. Safe Validation Command läuft
10. Resultat erscheint im Chat
11. Git Diff enthält erwartete Änderung
12. Rollback stellt Originalinhalt wieder her

Mindestens ein Test muss den vollständigen Weg vom Runtime-Chat-Tool-Result bis zur realen Datei auf dem Dateisystem abdecken.

## 14. Zusätzliche Tests

Pflichtfälle:

1. normales Coding-Chat erzeugt Proposal
2. nicht-coding Chat erzeugt kein Proposal
3. ungültiger Tool-Output wird abgelehnt
4. Pfad außerhalb Workspace blockiert
5. Preview wird korrekt gespeichert
6. stale Approval blockiert
7. Apply nur einmal möglich
8. Chat-Stream überschreibt Patch-Status nicht
9. Workspace-Wechsel invalidiert Proposal
10. Monaco Refresh nach Apply
11. Git Refresh nach Apply
12. Safe Commands werden ausgeführt
13. freier Shell-String wird blockiert
14. Validierungsfehler geht zurück in Agent Run
15. Folgepatch benötigt neue Freigabe
16. Rollback aktualisiert UI und Chat
17. Multi-File-Apply bleibt konsistent
18. Abbruch während Apply erzeugt keinen halbfertigen Status

## 15. Neue Testkommandos

Vorhandene Tests weiterverwenden:

```powershell
pnpm test:file-apply
pnpm test:coding-loop
pnpm test:capabilities
```

Ergänze:

```powershell
pnpm test:chat-file-apply
```

Dieser Befehl muss den vollständigen Runtime-Chat-bis-Dateisystem-Acceptance-Test ausführen.

## 16. Qualitäts-Gates

Vor Abschluss ausführen:

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
```

Keinen Test deaktivieren.
Keine Sicherheitsprüfung umgehen.
Keine direkte Renderer-Dateioperation.
Keine automatische Freigabe.
Keine freien Modell-Shellbefehle.

## 17. Definition of Done

Die Phase ist erst abgeschlossen, wenn folgender Ablauf in der echten App funktioniert:

```text
Nutzer:
„Ändere in src/math.ts die Subtraktion zu einer Addition.“
```

CODEE muss danach:

1. Datei analysieren
2. strukturierten Patch-Vorschlag erzeugen
3. echten Diff anzeigen
4. Nutzerfreigabe verlangen
5. Datei nach Freigabe real ändern
6. Editor automatisch aktualisieren
7. Git Diff automatisch aktualisieren
8. Safe Tests ausführen
9. Ergebnis im Chat anzeigen
10. Rollback ermöglichen

Zusätzlich:

- kein Schreibvorgang ohne Freigabe
- keine Änderung außerhalb des Workspace
- Proposal-ID durch gesamten Ablauf stabil
- Restore Point vorhanden
- keine erfundenen Testresultate
- Folgepatch nach Fehler benötigt neue Freigabe
- echter E2E-Test beweist den kompletten Pfad

## 18. Nicht Teil dieser Phase

Nicht umsetzen:

- neue Agentenarchitektur
- neue Patch-Pipeline
- Cloud-spezifische Sonderlogik
- automatische Commits
- automatische Pushes
- freie Shell-Ausführung
- vollständige persistente Proposal-Historie
- große UI-Neugestaltung

## 19. Abschlussbericht

Am Ende liefern:

1. Root Cause der bisherigen Integrationslücke
2. implementierter Runtime-Chat-zu-Apply-Datenfluss
3. neue oder geänderte Contracts
4. geänderte Dateien
5. UI-Anbindung
6. echte Dateiänderungsnachweise
7. Testkommandos und Resultate
8. Rollback-Nachweis
9. bekannte Einschränkungen
10. nächste sinnvolle Phase

Empfohlene Commit-Struktur:

```text
feat(chat): register propose_file_changes tool
feat(agent): map tool output to agent patch proposals
feat(ui): connect patch preview and approval controls
feat(host): apply approved runtime chat patches
feat(validation): run safe commands after patch apply
test(chat): prove runtime chat to real file apply
docs(status): document chat-driven write capability
```
