# DBZS Codee – Implementation Queue System

## Übersicht

Dieses Dokument beschreibt das Implementation Queue System für Codee. Es ermöglicht kontrollierte, nachvollziehbare Implementierungsketten mit expliziten Abhängigkeiten, Akzeptanzkriterien und Testkommandos.

## Problemstellung

**Vorher:** Der Chat-Assistent war gleichzeitig Planer, Warteschlange und Executor. Das führte zu:

- Springen zwischen Vorschlägen, Analyse und Implementierung
- Keine kontrollierte Reihenfolge
- Keine expliziten Abhängigkeiten
- Schwer nachvollziehbare Änderungen

**Nachher:** Klare Trennung der Verantwortlichkeiten:

```text
Vorschlag
→ strukturierter Implementierungsplan
→ Benutzerfreigabe
→ Jobs in Warteschlange
→ genau ein Job wird ausgeführt
→ Tests und Review
→ Commit
→ nächster Job
```

## Architektur

### Schichten

```
┌─────────────────────────────────────────────────────────────┐
│                    Chat-Assistent                            │
│  (schlägt Änderungen vor, gibt strukturierte Pläne aus)     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              ImplementationPlanParser                        │
│  (extrahiert Plan aus Agent-Antwort, validiert Syntax)      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│           ImplementationPlanValidator                        │
│  (prüft semantische Korrektheit, Zyklen, Vollständigkeit)   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              Benutzer-Freigabe                               │
│  (manuelle Bestätigung vor Ausführung)                      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│          ImplementationQueueService                          │
│  (wandelt Tasks in Jobs, verwaltet Abhängigkeiten)          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              Workspace Lock Service                          │
│  (stellt sicher: nur ein Job pro Workspace)                 │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                 Job Spooler (Backend)                        │
│  (enqueueJob, claimNextJob, verifyJob, etc.)                │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              Job Executor Service                            │
│  (führt einzelnen Job aus, nicht gesamten Plan)             │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              Review Gate Service                             │
│  (unabhängige Validierung: Tests + Kriterien + Review)      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              Commit Service                                  │
│  (automatischer Commit nach erfolgreichem Job)              │
└─────────────────────────────────────────────────────────────┘
```

## Datenstrukturen

### ImplementationPlanV1

```typescript
interface ImplementationPlanV1 {
  id: string;              // z.B. "communication-spine-repair-20"
  goal: string;            // Übergeordnetes Ziel
  branchName: string;      // Git-Branch für diesen Plan
  createdAt: string;       // ISO-8601 Timestamp
  tasks: ImplementationTaskV1[];
  notes?: string[];
  status?: ImplementationPlanStatus;
}
```

### ImplementationTaskV1

```typescript
interface ImplementationTaskV1 {
  id: string;                    // z.B. "T1", "T2"
  title: string;                 // Kurzer Titel
  description: string;           // Detaillierte Beschreibung
  priority: number;              // Höhere Werte = wichtiger
  dependsOn: string[];           // IDs von Vorgänger-Tasks
  expectedFiles: string[];       // Zu verändernde Dateien
  acceptanceCriteria: string[];  // Überprüfbare Kriterien
  testCommands: string[];        // Validierungskommandos
  maxAttempts: number;           // Maximale Versuche
  requiresApproval: boolean;     // Benutzerfreigabe nötig?
  state?: ImplementationTaskState;
  jobId?: string | null;         // Job-ID im Spooler
  commitSha?: string | null;     // Nach erfolgreichem Commit
}
```

### Task States

```typescript
type ImplementationTaskState =
  | "proposed"    // Vom Planner erzeugt
  | "approved"    // Benutzer hat freigegeben
  | "queued"      // Im Job-Spooler
  | "blocked"     // Wartet auf Abhängigkeiten
  | "ready"       // Bereit zur Ausführung
  | "running"     // Wird ausgeführt
  | "validating"  // Tests/Review laufen
  | "done"        // Erfolgreich abgeschlossen
  | "failed"      // Fehlgeschlagen
  | "cancelled";  // Abgebrochen
```

## Ablauf

### 1. Plan-Erstellung

Der Planner-Agent erzeugt einen strukturierten Plan:

```json
{
  "id": "communication-spine-repair-20",
  "goal": "Runtime Chat Communication Spine stabilisieren",
  "branchName": "codee/communication-spine-repair-20",
  "createdAt": "2026-06-27T06:00:00Z",
  "tasks": [
    {
      "id": "T1",
      "title": "TypeScript-Buildfehler beheben",
      "description": "Doppelten TimeoutManager entfernen...",
      "priority": 100,
      "dependsOn": [],
      "expectedFiles": ["apps/desktop/src/stores/runtimeChatStore.ts"],
      "acceptanceCriteria": ["Kein Zugriff auf sendOptions.taskType"],
      "testCommands": ["pnpm typecheck"],
      "maxAttempts": 2,
      "requiresApproval": false
    }
  ]
}
```

### 2. Validierung

Der Validator prüft:

- Alle Pflichtfelder vorhanden
- Keine duplizierten Task-IDs
- Alle Abhängigkeiten existieren
- Keine zyklischen Abhängigkeiten
- Testkommandos und Akzeptanzkriterien sinnvoll

### 3. Benutzer-Freigabe

UI zeigt Plan an mit Optionen:
- [Plan prüfen]
- [In Warteschlange übernehmen]
- [Verwerfen]

### 4. Queue-Aufbau

Tasks werden topologisch sortiert und als Jobs gequeued:

```typescript
const sortedTasks = topologicalSortTasks(plan.tasks);
for (const task of sortedTasks) {
  const job = await backendClient.enqueueJob(taskToJobRequest(task, plan.id));
  task.jobId = job.id;
  task.state = "queued";
}
```

### 5. Workspace-Locking

Bevor ein Job ausgeführt wird:

```typescript
const result = await claimNextJobWithLock(workerId, supportedRoles);
if (!result.claimed) {
  // Workspace ist gesperrt – Job zurück zur Queue
  return;
}
```

### 6. Job-Ausführung

Nur ein Job wird gleichzeitig pro Workspace ausgeführt:

```typescript
const executor = new JobExecutorService({ workerId: "desktop-primary" });
const result = await executor.executeJob(job, workspaceRoot);
```

Der Executor:
- Setzt Waypoints (running → progress → waiting_verification → completed)
- Verlängert periodisch den Lock
- Führt Tests aus
- Meldet Ergebnisse zurück

### 7. Review-Gate

Ein Job wird erst `done` nach:

```typescript
const reviewResult = await jobReviewGateService.checkReviewCriteria(job, task);
if (!reviewResult.passed) {
  await jobReviewGateService.rejectGate(gateId, {
    reviewedBy: "system",
    rejectionReason: reviewResult.failures.join("; ")
  });
  return; // Job failed
}

await jobReviewGateService.approveGate(gateId, {
  reviewedBy: "system",
  reviewComment: "Alle Kriterien erfüllt"
});
```

**Review-Kriterien:**

| Kriterium | Beschreibung |
|-----------|--------------|
| `testsPassed` | Alle Testkommandos Exit-Code 0 |
| `acceptanceCriteriaMet` | Alle Akzeptanzkriterien erfüllt |
| `noCriticalChangesWithoutApproval` | Keine kritischen Änderungen ohne Approval |
| `codeQualityAcceptable` | Code-Qualität ausreichend |
| `noSecurityIssues` | Keine Sicherheitsprobleme |

### 8. Commit

Nach erfolgreichem Review wird ein Commit erstellt:

```typescript
const commitResult = await backendClient.createCommit(workspaceRoot, {
  message: task.title,
  paths: task.expectedFiles
});
task.commitSha = commitResult.commitSha;
```

## Dateien

| Datei | Zweck |
|-------|-------|
| `packages/shared/src/implementationPlan.ts` | Typen und Utilities |
| `apps/desktop/src/services/implementationPlanParser.ts` | Parser für Agent-Antworten |
| `apps/desktop/src/services/implementationPlanValidator.ts` | Semantische Validierung |
| `apps/desktop/src/services/implementationQueueService.ts` | Queue-Management |
| `apps/desktop/src/services/workspaceLockService.ts` | Workspace-Lock-Registry |
| `apps/desktop/src/services/jobWorkspaceLock.ts` | Lock-Integration beim Claim |
| `apps/desktop/src/services/jobExecutorService.ts` | Einzeljob-Executor |
| `apps/desktop/src/services/jobReviewGateService.ts` | Review-Gate-Service |

## Automatisierungsmodus

Empfohlene Konfiguration für Codee:

```text
Planfreigabe: manuell
Einzelne Jobs: automatisch
Commits: automatisch
Merge nach main: manuell
```

## Verbindlicher Ausführungspfad

```text
Anforderung
→ ImplementationPlanV1
→ Benutzerfreigabe
→ Job Spooler
→ Workspace Lock
→ Einzeljob-Implementierung
→ Pflichtprüfungen (Tests)
→ Review-Gate
→ Commit
→ Lock freigeben
→ nächster Job
```

## Systemanweisung für den Orchestrator

> Du bist der Implementierungs-Orchestrator von Division By Zeros (DBZS) Codee.
>
> Deine Aufgabe ist nicht, mehrere Änderungen sofort selbst auszuführen. Du wandelst Anforderungen, Audits und Verbesserungsvorschläge zuerst in einen strukturierten, ausführbaren Implementierungsplan um.
>
> Für jeden Plan:
>
> 1. Zerlege das Ziel in kleine, atomare Aufgaben.
> 2. Jede Aufgabe muss in einem einzelnen Commit abschließbar sein.
> 3. Definiere explizite Abhängigkeiten zwischen den Aufgaben.
> 4. Definiere erwartete Dateien, Akzeptanzkriterien und Testkommandos.
> 5. Erzeuge keine Aufgabe ohne überprüfbare Definition of Done.
> 6. Verwende keine freie Textliste als Queue-Ersatz.
> 7. Gib den Plan als `ImplementationPlanV1` aus.
> 8. Warte auf die Freigabe des Plans, bevor Jobs eingeplant werden.
> 9. Nach Freigabe werden die Aufgaben topologisch sortiert und einzeln in den Job Spooler übertragen.
> 10. Es darf nur ein schreibender Implementierungsjob pro Workspace gleichzeitig laufen.
> 11. Der Executor erhält immer nur einen Job, niemals den gesamten Gesamtplan.
> 12. Ein fehlgeschlagener Job blockiert alle abhängigen Jobs.
> 13. Neue Probleme werden als neue vorgeschlagene Jobs angelegt und nicht ungeplant nebenbei repariert.
> 14. Ein Job gilt erst nach Implementierung, Tests und unabhängigem Review als abgeschlossen.
> 15. Nach jedem erfolgreichen Job wird ein eigener Git-Commit erzeugt.
> 16. Ein Merge nach `main` benötigt eine ausdrückliche Benutzerfreigabe.
> 17. Behaupte niemals PASS oder Production Ready, wenn ein Test nicht tatsächlich ausgeführt wurde.
> 18. Verwende ausschließlich die Zustände `proposed`, `approved`, `queued`, `blocked`, `ready`, `running`, `validating`, `done`, `failed` und `cancelled`.

## Zentrale Regel

```text
Der Chat macht Vorschläge.
Der Orchestrator baut den Plan.
Der Job Spooler bestimmt die Reihenfolge.
Der Executor ändert Code.
Der Validator prüft.
Der Reviewer entscheidet.
```
