# Teststrategie und Abnahme

## Testpyramide

### Unit Tests

Backend:

- Run-State-Transitions
- Step-State-Transitions
- Event Sequence
- Repository Migration
- Host Action Idempotenz
- Workspace Path Validation
- Before-Hash-Konflikt
- Retry Limits
- Recovery nach Neustart

Desktop:

- Host Executor Dispatch
- Apply-Patch-Resultat
- Command Action
- SSE Reducer
- Workbench Stores
- Dirty-File-Konflikt

### Integration Tests

1. Run erstellen und Plan speichern.
2. Worker startet Read-only-Step.
3. Tool Call erzeugt Events.
4. Patch Proposal erzeugt Review Gate.
5. Approve erzeugt Host Action.
6. Simulierter Desktop Executor meldet Apply.
7. Command Result wird verarbeitet.
8. Step wird abgeschlossen.
9. Run wird abgeschlossen.

### E2E

Mit kleinem Fixture-Workspace.

Fixture:

```text
fixtures/agent-workbench-demo/
  package.json
  src/math.ts
  src/math.test.ts
```

Aufgabe:

`Ergänze eine divide-Funktion mit Fehlerbehandlung und Tests.`

Erwartung:

- Plan mit Analyse, Implementierung und Test
- Datei lesen
- zwei Patch-Proposals
- Review
- Apply
- Test
- Abschluss

## Recovery-Test

1. Run bis `waiting_review`.
2. Backend stoppen.
3. Backend starten.
4. Run bleibt `waiting_review`.
5. Eventfolge bleibt vollständig.
6. Host Action wird nicht doppelt ausgeführt.

## Fehler-Test

1. Patch mit absichtlich fehlerhaftem Test.
2. Test schlägt fehl.
3. Diagnose wird erzeugt.
4. Debug-Step wird angelegt.
5. maximaler Retry wird beachtet.
6. kein Endlosloop.

## Reale Abnahmecommands

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:backend
pnpm doctor:backend
pnpm e2e
```

Zusätzlich neue gezielte Commands:

```powershell
cd backend
uv run pytest tests/test_agent_workbench_*.py -q

cd ../apps/desktop
pnpm vitest run src/components/agent-workbench src/services/agentHostExecutor.test.ts
```

## Wahrheitsregel

Ein Gate darf nur als grün dokumentiert werden, wenn der Command im aktuellen Lauf tatsächlich ausgeführt wurde.

Nicht ausgeführte manuelle Tests müssen als `NOT RUN` markiert werden.
