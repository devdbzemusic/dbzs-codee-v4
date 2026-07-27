# TODO PR #27 – Final Merge Hardening

Implementierungs-Head: `d34a49e`

Status: **ABGESCHLOSSEN — 77/100 / PARTIAL / MERGE READY / RC HARDENING**

## Erledigt

- [x] Plan und Handover vor Produktivcode erstellt.
- [x] Externe Command-Pfade und gefährliche Git-/Pytest-/UV-Optionen blockiert.
- [x] Shellfreier Argv-Parser mit Leerzeichen-/Backslash-Unterstützung eingeführt.
- [x] Fehlende Resume-Baseline explizit migrationspflichtig gemacht.
- [x] Manifest-/DB-Fehler kompensiert und Ignore-Regeln präzisiert.
- [x] Active-/Selected-/Mention-Pfade kanonisch normalisiert.
- [x] Slot-/Task-Validierung und konfigurierbare Backend-URL korrigiert.
- [x] Context zentral dedupliziert und Tokenersparnis sichtbar gemacht.
- [x] Ungenutzten parallelen Desktop-Budgetmanager entfernt; ContextSpooler ist
  alleiniger finaler Prompt-Budgetpfad.
- [x] Neun echte, persistierte Model-Certification-Fälle implementiert.
- [x] Realen Context-E2E mit Backend, Orchestrator, RAG, Spooler und Request Messages ergänzt.
- [x] 250+-Dateien-Qualitätsfixture unter Budget bestätigt.
- [x] 21 Ausgangsthreads plus drei spätere Review-Befunde fachlich geprüft.
- [x] Alle verbliebenen 13 Threads einzeln beantwortet und belegt aufgelöst.
- [x] Finaler Ubuntu-, Windows- und Playwright-Lauf grün.
- [x] Final Merge Report, Readiness und Handover aktualisiert.

## Nachweise

| Gate | Ergebnis |
|---|---|
| Typecheck | bestanden |
| Shared | 5/5 |
| Desktop | 553 bestanden, 36 übersprungen |
| Backend | 311/311 |
| Playwright | 40/40 |
| Backend-Smoke | bestanden |
| Doctor | 7/7 |
| Packaging | bestanden |
| Production-Audit | keine bekannte Schwachstelle |
| Review-Threads | 0 ungelöst |
| GitHub Ubuntu | bestanden |
| GitHub Windows | bestanden |
| GitHub Playwright | bestanden |

## Nach dem Merge / vor RC-Tag

- [x] Gate 1 Capability Suite 30/30 + lokales CI (`pnpm ci:local`) auf Feature-Branch
- [ ] PR #51 mergen; GitHub CI (ubuntu + windows) bestätigen
- [ ] Frischen Windows-Installer ohne globales Python prüfen.
- [ ] Utility-Live-Zertifizierung auf Zielhardware ausführen.
- [ ] Reale Modell-Langläufe dokumentieren.
- [ ] Vollständigen Hardware-Paralleltest durchführen.
- [ ] Node-Action-Deprecation und optionale Artifact-Warnungen bereinigen.

Keine Aussage „Production Ready“ bis diese Release-Gates belegt sind.
