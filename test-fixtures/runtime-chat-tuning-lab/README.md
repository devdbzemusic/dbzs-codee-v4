# Runtime Chat Tuning Lab

Anspruchsvolleres Mehrzweck-Fixture fuer Runtime-Chat-, Review-, Refactor-, Debugging-,
Intent-, Pipeline- und Workflow-Tests.

## Ziel

Dieses Projekt ist absichtlich nicht "einfach kaputt", sondern enthaelt gemischte
Problemklassen:

- echte Logikfehler
- Review-relevante Sicherheits- und Architekturprobleme
- Refactor-Kandidaten
- Performance-Gerueche
- Workflow-Mehrdeutigkeiten
- Recovery-/Runtime-Pfade
- direkte Workspace-Queries ohne Modellbedarf

## Wichtige Bereiche

- `src/core/priceEngine.ts`
  Enthaeelt einen VIP-Discount-Bug, fehlende Validierungen und unklare Rabattlogik.
- `src/core/reportFormatter.ts`
  Funktioniert nur teilweise, ist aber bewusst zu gross und zu stark gekoppelt.
- `src/services/cacheRegistry.ts`
  Enthaeelt TTL-/Purge-Probleme und unnoetige lineare Scans.
- `src/api/reviewController.ts`
  Enthaelt unsicheren Command-Building- und Path-Handling-Code.
- `src/workflows/syncUsers.ts`
  Enthaeelt race-/summary-nahe Logik- und Dedupe-Probleme.
- `src/runtime/runtimeProbe.ts`
  Simuliert Runtime-Pfad-, Fallback- und Diagnoseprobleme.
- `src/legacy/normalizeOwner.ts`
  Altlogik mit Sonderregeln; gute Approval-/Scope-Falle.
- `models/`
  Enthaeelt drei `.gguf`-Dateien fuer direkte Workspace-Intents wie `count_files`.

## Typische Anwendungsfaelle

- `Zaehle alle gguf Modelle im Workspace`
- `Reviewe das ganze Projekt auf High-Risks`
- `Finde die Ursache fuer falsche VIP-Preise`
- `Refactore reportFormatter ohne Verhaltensaenderung`
- `Debugge die Runtime-Probe und schlage Recovery vor`
- `Fixe nur sichere Teile und frage vor Legacy-Aenderungen nach`
- `Mach weiter`
- `Wie ist der Status?`

## Erwartete Goldpfade

- Workspace-Queries laufen ohne LLM-Interview und ohne Runtime-Start.
- Status- und Meta-Fragen werden direkt beantwortet.
- Review findet Sicherheits-, Logik- und Testluecken.
- Refactor bleibt auf `reportFormatter` begrenzt, wenn so gewuenscht.
- Debugging trennt Ursache, Reproduktion, Risiko und Fix.
- Legacy-Aenderungen unter `src/legacy/` loesen einen Approval-/Scope-Hinweis aus.

## Hinweis

Die Fehler sind absichtlich eingebaut. Das Projekt ist ein Trainings- und
Abnahme-Fixture, keine produktive Referenzimplementierung.
