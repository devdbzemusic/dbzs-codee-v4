# Cursor Auftrag — Phase 3E: Geschlossener Patch-, Review- und Test-Loop

## Voraussetzung

3A–3D sind grün.

## Ziel

Ein Step kann einen Patch vorschlagen, Review anfordern, über Electron sicher anwenden und anschließend echte Tests ausführen.

## Integration

Wiederverwenden:

- `ReviewGateService`
- `PatchPipelineService`
- `FileChangeService`
- `RestorePointService`
- Safe Commands
- Project Adapter

## Ablauf

1. strukturierter Patch Proposal
2. Before Hash berechnen
3. Diff und Line Stats
4. AgentFileChange speichern
5. Review Gate erstellen
6. Run auf `waiting_review`
7. Approve erzeugt HostAction `apply_patch`
8. Host erzeugt Restore Point und Apply
9. Backend erhält Resultat
10. Adapter empfiehlt Checks
11. HostAction `run_command`
12. Resultat auswerten
13. grün: Step complete
14. rot: echter Debug-Step

## Verboten

- direkte Patch-Anwendung aus `AutonomousSessionPanel`
- Erfolg simulieren
- alten Teststatus als neuen Test ausgeben
- Catch-Block, der Fehler nur loggt und Erfolg zurückgibt
- Auto-Apply im supervised mode

## Review UI

Noch nur minimale funktionsfähige Review-Ansicht nötig:

- Diff
- Risiko
- Approve
- Reject
- Status

Die große Workbench kommt in 3F.

## Tests

- Hash Mismatch
- Reject
- Apply
- Restore Point
- Command grün
- Command rot
- Debug-Step
- Retry Limit
- Rollback
- App-/Backend-Restart in waiting_review
