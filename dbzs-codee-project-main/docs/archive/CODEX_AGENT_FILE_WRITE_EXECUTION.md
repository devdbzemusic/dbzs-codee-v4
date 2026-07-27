# CODEX TASK — Agent Patch Execution End-to-End

Repository:

`devdbzemusic/dbzs-codee-project`

## Ziel

CODEE soll nicht nur Quellcode analysieren und Änderungsvorschläge formulieren, sondern nach Nutzerfreigabe tatsächlich Dateien im geöffneten Workspace ändern.

Der bestehende Unterbau ist bereits vorhanden:

- `PatchPipelineService`
- `FileChangeService`
- `RestorePointService`
- `agentHostExecutor`
- Host Action `apply_patch`
- Review Gates
- Workspace Boundary
- Git Diff
- Safe Commands

Was fehlt, ist die vollständige Verbindung:

```text
LLM-Ausgabe
→ strukturierter Patch-Vorschlag
→ Validierung
→ Diff-Vorschau
→ Review Gate
→ Host Action apply_patch
→ echte Dateiänderung
→ Workspace Refresh
→ Tests
→ Ergebnis zurück in den Agentenlauf
```

Keine neue Agentenarchitektur bauen.
Keine zweite Patch-Pipeline bauen.
Vorhandene Services integrieren und vervollständigen.

## 1. Aktuellen Schreibpfad auditieren

Prüfe mindestens:

```text
apps/desktop/src/services/runtimeChatAgentRunner.ts
apps/desktop/src/services/agentRunService.ts
apps/desktop/src/services/agentHostExecutor.ts
apps/desktop/src/services/agentWorkbenchService.ts
apps/desktop/electron/patchPipelineService.ts
apps/desktop/electron/fileChangeService.ts
apps/desktop/electron/restorePointService.ts
apps/desktop/electron/preload.ts
apps/desktop/electron/main.ts
backend/app/agent_workbench/
backend/app/review_gates/
```

Dokumentiere zuerst:

- wo Modellantworten heute verarbeitet werden
- wo Tool Calls oder strukturierte Aktionen erkannt werden
- wo Host Actions erzeugt werden
- warum aktuell keine echte Dateiänderung aus einer normalen Coding-Anfrage entsteht
- welche vorhandenen Contracts wiederverwendet werden können

Keine Implementierung beginnen, bevor der konkrete fehlende Verbindungsweg identifiziert ist.

## 2. Zentralen Patch-Vorschlag-Contract definieren

Erstelle einen gemeinsamen typisierten Contract, bevorzugt in `packages/shared`.

```ts
export interface AgentFileChangeProposal {
  id: string;
  runId: string;
  decisionId?: string;
  filePath: string;
  changeType: "create" | "modify" | "delete";
  proposedContent?: string;
  reason: string;
  summary: string;
  riskLevel: "low" | "medium" | "high";
  requiresReview: boolean;
  createdAt: string;
}

export interface AgentPatchProposal {
  id: string;
  runId: string;
  title: string;
  summary: string;
  changes: AgentFileChangeProposal[];
  validationCommands?: string[];
  createdAt: string;
}
```

Anforderungen:

- keine losen `Record<string, unknown>` als primärer Contract
- `filePath` immer workspace-relativ
- `proposedContent` nur für `create` und `modify`
- `delete` benötigt keinen Dateiinhalt
- Runtime-Validierung vor Persistierung
- maximale Zahl und Größe der Änderungen über bestehende Limits

## 3. Modellantwort in Patch-Vorschlag überführen

Implementiere eine zentrale Komponente, beispielsweise:

```text
AgentPatchCoordinator
```

Verantwortung:

1. strukturierte Dateiänderungen aus Agent-/Tool-Ausgabe empfangen
2. Contract validieren
3. Workspace Boundary prüfen
4. betroffene Dateien laden
5. Patch-Vorschauen erzeugen
6. Proposal persistieren
7. Review Gate anlegen
8. nach Freigabe Host Actions erzeugen
9. Ausführung überwachen
10. Resultat in den Agentenlauf zurückmelden

Der Coordinator darf Dateien nicht selbst direkt schreiben.
Er verwendet ausschließlich die vorhandene Safe Patch Pipeline und Host Actions.

## 4. Strukturierte Tool-Ausgabe als Hauptweg

Der bevorzugte Weg muss strukturierte Tool-/Action-Ausgabe sein.

```json
{
  "tool": "propose_file_changes",
  "arguments": {
    "title": "Fix email validation",
    "changes": [
      {
        "file_path": "src/services/userService.ts",
        "change_type": "modify",
        "proposed_content": "...",
        "reason": "Validation rejects valid plus-addressing"
      }
    ],
    "validation_commands": [
      "test",
      "typecheck"
    ]
  }
}
```

Falls lokale Modelle kein zuverlässiges Tool Calling unterstützen:

- optionalen JSON-Fallback erlauben
- strikt validieren
- kein freies Markdown automatisch ausführen
- niemals Codeblöcke blind als Dateiinhalt übernehmen

## 5. Patch-Vorschau erzeugen

Für jede vorgeschlagene Änderung:

- aktuelle Datei lesen
- Snapshot erzeugen
- Diff erzeugen
- Create/Modify/Delete eindeutig darstellen
- Binärdateien blockieren
- geschützte Dateien blockieren
- Workspace-Grenzen erzwingen
- Symlink-Ausbruch verhindern

Mehrere Änderungen müssen als eine logisch zusammengehörige Patch-Gruppe dargestellt werden.

## 6. Review Gate integrieren

Vor jeder echten Dateiänderung muss standardmäßig ein Review Gate stehen.

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

Anforderungen:

- Nutzer kann gesamten Patch genehmigen oder ablehnen
- optional einzelne Dateien abwählen
- ohne Freigabe kein Schreibvorgang
- Freigabe mit Proposal-ID und Snapshot-Version verknüpfen
- nach Änderung des Vorschlags alte Freigabe ungültig machen
- Audit-Trail speichern

## 7. Host Actions erzeugen

Nach Freigabe für jede Dateiänderung eine kontrollierte Host Action erzeugen.

```json
{
  "action_type": "apply_patch",
  "payload": {
    "workspace_root": "...",
    "file_path": "src/example.ts",
    "proposed_content": "...",
    "restore_reason": "before_patch",
    "proposal_id": "...",
    "change_id": "..."
  }
}
```

Für Delete:

- sicheren Delete-Contract verwenden oder ergänzen
- Restore Point zwingend
- keine Shell-Umgehung über `rm`, `del` oder PowerShell

## 8. Echte Dateiänderung nachweisen

Nach jeder Host Action verifizieren:

- Datei existiert oder wurde gelöscht
- tatsächlicher Inhalt entspricht dem freigegebenen Inhalt
- Snapshot-ID vorhanden
- Restore Point vorhanden
- Workspace-Refresh erfolgreich
- Git Diff enthält die erwartete Änderung

Bei Fehler:

- Action als fehlgeschlagen markieren
- keine abhängigen Änderungen mehr ausführen
- Rollback anbieten oder automatisch ausführen

## 9. Multi-File-Patch kontrolliert behandeln

Für mehrere Dateien:

1. Restore Points für alle betroffenen Dateien erzeugen
2. alle Änderungen anwenden
3. jede Änderung verifizieren
4. bei Fehler vollständigen Patch-Satz zurückrollen
5. erst danach Validierungskommandos starten

Kein halbfertiger Multi-File-Zustand.

## 10. Tests und Validierung ausführen

Nach erfolgreichem Apply:

- gezielte Tests bevorzugen
- anschließend optional Typecheck/Build
- nur bestehende Command-Allowlist verwenden
- keine freien Modell-Shellbefehle ausführen

```ts
export interface PatchValidationResult {
  proposalId: string;
  success: boolean;
  commands: Array<{
    commandId: string;
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }>;
}
```

## 11. Reparaturschleife

Wenn Tests fehlschlagen:

- Fehlerausgabe in den bestehenden Agentenlauf zurückgeben
- maximale Iterationen beachten
- neuer Patch-Vorschlag benötigt neue Vorschau
- neue Änderung benötigt neue Freigabe, sofern Review Gate aktiv
- keine stillen Folgeänderungen

Die Schleife endet bei:

```text
Tests erfolgreich
maxIterations erreicht
Nutzer stoppt
Patch abgelehnt
Rollback fehlgeschlagen
Workspace Boundary verletzt
```

## 12. UI minimal erweitern

Keine neue große Oberfläche bauen.

Benötigte Aktionen:

```text
Diff anzeigen
Übernehmen
Ablehnen
Rollback
Tests starten
Datei öffnen
```

Nach Apply:

- Monaco Editor aktualisieren
- Workspace-Dateiliste aktualisieren
- Git Diff aktualisieren
- Agentenstatus anzeigen

## 13. Verbindlicher Acceptance-Test

Erstelle einen echten End-to-End-Test mit temporärem Workspace.

Ausgangsdatei:

```ts
export function add(a: number, b: number): number {
  return a - b;
}
```

Aufgabe:

```text
Korrigiere die add-Funktion.
```

Erwarteter Ablauf:

1. Agent erzeugt strukturierten Patch-Vorschlag
2. Diff zeigt `a - b` → `a + b`
3. Review Gate wird erzeugt
4. Test genehmigt Gate
5. Host Action wird erzeugt
6. Datei wird tatsächlich auf Festplatte geändert
7. Git/File Diff zeigt Änderung
8. Test läuft erfolgreich
9. Restore Point ist vorhanden
10. Rollback stellt ursprünglichen Inhalt wieder her

Mindestens ein Test muss eine reale temporäre Datei auf dem Dateisystem ändern.

## 14. Zusätzliche Tests

Pflichtfälle:

1. Modify einer Textdatei
2. Create einer neuen Datei
3. Delete mit Restore Point
4. Multi-File-Patch erfolgreich
5. zweiter Datei-Apply schlägt fehl → kompletter Rollback
6. Pfad außerhalb Workspace → blockiert
7. Symlink außerhalb Workspace → blockiert
8. Binärdatei → blockiert
9. Proposal nach Freigabe geändert → erneute Freigabe nötig
10. kein Chat-Store-Update überschreibt den Apply-Status
11. Tests fehlschlagen → Reparaturschleife erhält Fehler
12. maxFilesChanged / maxPatchSize werden erzwungen
13. Host Executor gestoppt → Action kontrolliert pending/failed
14. Workspace Refresh nach Apply
15. Git Diff stimmt mit Proposal überein

## 15. Qualitätsanforderungen

Vor Abschluss ausführen:

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm doctor:all
pnpm smoke-test
pnpm test:capabilities
pnpm test:coding-loop
```

Ergänze zusätzlich:

```powershell
pnpm test:file-apply
```

Dieser Befehl muss den realen Dateiänderungs-Acceptance-Test ausführen.

Keine Tests deaktivieren.
Keine Sicherheitsprüfungen umgehen.
Keine direkte Dateiänderung aus dem Renderer.
Keine Shell-Umgehung der Patch Pipeline.

## 16. Definition of Done

Die Aufgabe ist erst abgeschlossen, wenn ein Nutzer in CODEE Folgendes tun kann:

```text
„Korrigiere die Funktion in src/math.ts.“
```

und danach:

1. CODEE analysiert die Datei
2. CODEE erzeugt einen strukturierten Patch-Vorschlag
3. CODEE zeigt einen echten Diff
4. Nutzer genehmigt den Patch
5. CODEE schreibt die Datei tatsächlich auf die Festplatte
6. Editor und Workspace aktualisieren sich
7. Git Diff zeigt die Änderung
8. Tests werden ausgeführt
9. Ergebnis erscheint im Agentenlauf
10. Rollback funktioniert

Zusätzlich:

- keine Änderung außerhalb des Workspace
- keine Änderung ohne Freigabe
- Restore Point vor jedem Schreibvorgang
- Multi-File-Patches werden vollständig zurückgerollt, falls ein Teil fehlschlägt
- alle Aktionen sind im Audit-Trail nachvollziehbar
- keine Aussage „Production Ready“ ohne realen E2E-Nachweis

## 17. Abschlussbericht

Am Ende liefern:

1. identifizierte Root Cause
2. implementierter Datenfluss
3. neue und geänderte Contracts
4. geänderte Dateien
5. Testkommandos und Resultate
6. realer Dateiänderungsnachweis
7. Rollback-Nachweis
8. bekannte Einschränkungen
9. offene Risiken
10. nächste sinnvolle Phase

Empfohlene Commit-Struktur:

```text
feat(agent): add structured patch proposal contract
feat(agent): connect patch proposals to review gates
feat(host): execute approved file changes through safe patch pipeline
feat(ui): add patch preview and apply controls
test(agent): verify real file apply and rollback
docs(status): document agent write capability
```
