# Context Intelligence RC Hardening – Ausführungsplan

## Ausgangslage

- Ausgangsbranch: `origin/main`
- Ausgangscommit: `acd0862d` (Merge von PR #26)
- Zielbranch: `feat/context-intelligence-rc-hardening`
- Produktstatus: `PARTIAL — Release Candidate Hardening`
- Lokaler Hinweis: `apps/desktop/electron/workspaceService.ts` ist ausschließlich wegen
  Zeilenenden als geändert markiert; `git diff` enthält keine inhaltliche Änderung. Die
  unversionierte Auftragsdatei bleibt unangetastet.

## Bekannte Blocker und Konsolidierung

- PR #26 ist gemergt; sein Playwright-Job scheiterte, weil
  `apps/desktop/scripts/dev-renderer.mjs` fehlte.
- PR #21 und #22 sind offen, veraltet und nicht vollständig grün.
- PR #23 ist offen und enthält relevante Context-/Runtime-Arbeit, sein E2E-Job ist rot.
- Vorhandene Context-Pack-, Retrieval-, Code-Index-, Context-Spooler- und
  Agent-Workbench-Systeme werden erweitert. Es entsteht keine Parallelarchitektur.
- CI führt derzeit nur zwei Backend-Testdateien aus. Backend-Build und Electron Builder
  verwenden unterschiedliche Ausgabepfade.

## Abschlussstand und Alt-PR-Entscheidung (2026-07-13)

Der Plan wurde auf Head `5cd6568` ausgeführt. PR #27 ist konfliktfrei; Ubuntu-,
Windows- und Playwright-Gates sind grün. Die ursprünglichen CI-, E2E-, Workspace-,
Terminal-, Context-Integration- und Resume-Blocker sind geschlossen.

| PR | Entscheidung | Begründung |
|---|---|---|
| #21 | bewusst nicht übernommen | Konfliktbehafteter Mix aus Provider-, Storybook- und Conversation-Control-Arbeit; Ubuntu/Windows rot; außerhalb des RC-Scopes |
| #22 | bewusst nicht übernommen | Konfliktbehafteter Draft; Ubuntu rot, E2E übersprungen; Slot-/Conversation-Grundlage im aktuellen Stand bereits neuer abgebildet |
| #23 | Systeme wiederverwendet, kein Blind-Cherry-pick | RAG, Hybrid Retrieval, Cache und Runtime-Ressourcen sind bereits auf `main` vorhanden und wurden erweitert; PR bleibt konfliktbehaftet, E2E rot |

Die PRs bleiben offen, bis eine separate Anweisung zum Schließen vorliegt. Details und
Nachweise stehen in `CONTEXT_INTELLIGENCE_FINAL_REPORT.md`.

## Phasen und Abhängigkeiten

1. **Stabilisierung:** Workspace-Grenzen, E2E-Start, vollständige Backend-Suite,
   Packaging und strukturierte Terminalausführung. Voraussetzung für alle Release-Gates.
2. **Context Core:** gemeinsame Contracts, Backend-Orchestrator und Desktop-Adapter.
3. **Repository Intelligence:** inkrementelle Repo Map, Symbolindex und Relevanzgraph.
4. **Retrieval:** Hybrid Scoring, begründetes Reranking und Retrieval Trace.
5. **Budget/Cache:** modellabhängige Budgets, nachvollziehbare Kompression und
   hashbasierte Invalidierung.
6. **Planner/Resume:** Agent Workbench erweitern, portable Task-Manifeste und
   Workspace-Revalidierung.
7. **Routing/Diagnostik:** feste Slots, typisierte Fehler und Context-Metriken.
8. **Akzeptanz/Release:** Fixtures, Pflicht-Gates, Dokumentation und Readiness-Berichte.

## Risiken und Gegenmaßnahmen

- Contract-Drift zwischen TypeScript und Python: additive, versionierte Wire-Modelle und
  Contract-Tests.
- Indexkosten bei großen Repositories: Datei-Hashes, inkrementelle Aktualisierung und
  harte Scan-/Tokenlimits.
- Veralteter Kontext nach externen Änderungen: Workspace-/Datei-Hash bei Cache-Lookup
  und Resume prüfen.
- Plattformabhängige Pfade: identische Testmatrix auf Windows und Ubuntu.
- Packaging-Smokes können lokal zeitintensiv sein: gezielte Tests zuerst, vollständige
  Gates vor dem Abschlussbericht.

## Testmatrix und Definition of Done

| Phase | Pflichtnachweis |
|---|---|
| Stabilisierung | Workspace-Security-Tests, komplette Backend-Suite, E2E, Packaging-/Health-Smoke |
| Context Core | Shared-Typecheck, Python-/TS-Contract- und Orchestrator-Tests |
| Repository/Retrieval | inkrementeller Index, TS/JS/Python-Symbole, Ranking- und Large-Repo-Fixture |
| Budget/Cache | Overflow-, Deduplizierungs-, Kompressions- und Invalidierungstests |
| Planner/Resume | Approval-, Manifest-, Workspace-Changed- und Resume-Fixture |
| Routing/Diagnostik | Slot-Matrix, kein implizites Fallback, Trace-/Coverage-Metriken |
| Abschluss | `pnpm typecheck`, `pnpm test`, `uv run pytest -q`, `pnpm build`, `pnpm e2e`, Smokes und Audit |

Eine Phase ist abgeschlossen, wenn ihre Tests grün sind, der Diff geprüft wurde, die
Dokumentation dem Iststand entspricht und offene Einschränkungen festgehalten sind.

## Rollback

Änderungen bleiben thematisch getrennt. Jede Phase muss ohne Datenverlust einzeln
rücknehmbar sein. Persistierte Formate tragen eine `schemaVersion`; neue Felder sind
additiv. Feature Flags schützen neue Laufzeitpfade bis zur erfolgreichen Abnahme. Es
erfolgen in diesem Auftrag keine automatischen Commits, Pushes, Merges oder PR-Schließungen.
