# PR #27 – Finaler Merge-Blocker-Plan

Datum: 2026-07-13

Ausgangs-Head: `1bc4c59d75f7330ba690c1cb30b51cc815bebc47`

Branch: `feat/context-intelligence-rc-hardening`

Status: **74/100 — PARTIAL / Final Merge Hardening**

## Fehlerbilder und betroffene Systeme

1. Strukturierte Git-/Pytest-Argumente können trotz sicherem `cwd` auf externe
   Pfade zeigen. Freie Terminalzeilen verlieren außerdem Argumentgrenzen bei
   Leerzeichen.
2. Ein fehlendes Task-Manifest wird beim Resume aktuell still aus dem veränderten
   Workspace neu erzeugt. DB- und Dateimanifest sind bei Schreibfehlern nicht als
   gemeinsame Operation kompensiert.
3. Active-, Selected- und Mention-Pfade werden zwischen Desktop, Repo-Map und RAG
   nicht einheitlich workspace-relativ normalisiert.
4. Orchestrator-, RAG-, Active-Task-, Relevant-Code- und Memory-Kontext kann vor dem
   Prompt mehrfach vorkommen; belastbare Dedupe-Metriken fehlen.
5. Der Certification-Code aggregiert vorgegebene Booleans, führt aber noch keine
   realen Modellfälle aus.
6. PR #27 enthält auf Head `1bc4c59` 21 ungelöste Review-Threads, darunter zusätzliche
   Befunde zu Slotvalidierung, Backend-URL, Ignore-Regeln und Manifest-Synchronität.

## Geplante Änderungen

- Zentrale shellfreie Command-Policy mit kanonischer Workspace-Prüfung aller
  pfadtragenden Git-/Pytest-Argumente und gemeinsamer Argv-Zerlegung.
- Expliziter Run-Status `migration_review_required`, HTTP-409-Resume-Block und
  bestätigungspflichtige Baseline-API mit Stage/Promote/Rollback für Manifeste.
- Kanonische Context-Pfadnormalisierung über Electron und erneute Backend-Prüfung;
  Slot-/Task-Paar und Backend-URL werden gegen die bestehenden Verträge korrigiert.
- Priorisierte, symbol- und excerpt-sensitive Deduplizierung vor der Spooler-
  Lane-Zuweisung mit Tokenersparnis im Manifest.
- Reale Model-Certification-Runs über den vorhandenen Runtime-Pfad, persistierte
  Messergebnisse und additive Read-APIs.
- Context-E2E mit realem Backend-/Retrieval-/Spooler-Aufbau und gemockter LLM-Antwort.

## Sicherheitsrisiken und Gegenmaßnahmen

- Path-Optionen können implizite Dateien laden: pro Command gilt eine positive
  Options-/Operand-Policy; unbekannte oder externe Pfade werden blockiert.
- Filesystem und SQLite besitzen keine gemeinsame native Transaktion: Manifeste werden
  gestaged, atomar promoted und bei DB-Fehlern durch Backup/Entfernung kompensiert.
- Renderer-Pfade sind nicht vertrauenswürdig: Electron prüft kanonisch, das Backend
  validiert erneut.
- Certification darf keine Secrets persistieren: gespeichert werden Prompts aus dem
  versionierten Fixture-Katalog, redigierte Antworten, Messwerte und Hardwaredaten.

## Regressionstests

- Git-/Pytest-/UV-Matrix für Windows, POSIX, UNC, Parent, Symlink/Junction, Quotes,
  Leerzeichen, Plugin-/Config- und Output-Optionen.
- Resume ohne Manifest, 409, Status/Event, explizite Baseline-Akzeptanz,
  spätere Drift und kompensierte Manifestfehler.
- Context-Pfade absolut/relativ, Separatoren, Case, Space, Escape, Active-/Selected-
  Boost, Slot-Mismatch und konfigurierbare Backend-URL.
- Dedupe über Quellen/Lanes, Symbole, absolute/relative Pfade, überlappende Excerpts
  und ausgewiesene Tokenersparnis.
- Neun Certification-Kategorien, fehlende Runtime, Teilfehler, Persistenz und
  Hardware-Fingerprint.
- Vollständige lokale und GitHub-Gates gemäß `TODO-PR27.md`.

## Rollback

Jeder Themenblock landet in einem separaten Commit. Neue API- und Contract-Felder sind
additiv. Die Resume-Migration verändert keine vorhandene Baseline ohne explizite
Bestätigung. Jeder Block kann einzeln revertiert werden; persistierte Certification-
Reports und portable Task-Manifeste tragen eine Schema-Version.

## Definition of Done

- Vier Merge-Blocker und alle gültigen Review-Befunde sind durch Code und Tests
  geschlossen.
- Context-E2E und 250+-Dateien-Akzeptanzmetriken sind grün.
- Alle 21 Threads wurden einzeln fachlich beantwortet; nur nachgewiesen erledigte
  Threads wurden aufgelöst.
- Typecheck, Unit-/Backend-/E2E-, Build-, Smoke-, Doctor-, Packaging- und Audit-Gates
  sind lokal und auf finalem Ubuntu-/Windows-/Playwright-Head grün.
- `PR27_FINAL_MERGE_REPORT.md`, Readiness, Handover und TODO stimmen mit dem finalen
  Head überein; Status bleibt `75+/100 — PARTIAL / Merge Ready / RC Hardening`.
