# PR Review Deep Pass (30 Minuten)

## Ziel
Gruendliche technische Validierung mit Fokus auf Sicherheit, Wartbarkeit und Architekturtreue.

## A. Architektur und Modulgrenzen (5 Min)
- Trennung eingehalten zwischen:
  - UI (React Komponenten)
  - State (Zustand Stores)
  - Bridge (Preload/Main IPC)
  - Backend API (FastAPI Router)
  - Backend Services (Businesslogik + Persistenz)
- Keine unnoetige Kopplung oder Umgehung der Bridge durch den Renderer.

## B. API und Typvertraege (5 Min)
- Shared Types stimmen mit Backend-Modellen ueberein.
- Feldnamen/Kardinalitaet korrekt:
  - Agent-Status, Logs, Start/Stop
  - Project Memory (`workspace`, `memory_key`, `tags`)
  - Task Board (`status`, `priority`)
  - Docs Analysis Summary/Generate Response
- Fehlerpfade liefern erwartete und stabile Responses.

## C. Sicherheit und Prozesskontrolle (5 Min)
- Allowlist-Pruefung fuer Agent-Commands robust.
- Eingabevalidierung fuer Args (Laenge, verbotene Zeichen) robust.
- Prozess-Lifecycle sauber:
  - Start nur wenn erlaubt/aktiviert
  - Stop mit Timeout + Kill-Fallback
  - Logging fuer Start/Stop/Error vorhanden
- Keine offensichtliche Secret-Leakage in Logs.

## D. Datenpersistenz und Integritaet (5 Min)
- SQLite Tabellen/Constraints sinnvoll (PK/UNIQUE, Zeitstempel).
- Upsert/Delete verhalten sich deterministisch.
- Keine inkonsistenten Zustaende zwischen in-memory und DB nach Fehlern.

## E. UI/UX und Fehlerverhalten (5 Min)
- Loading/Mutating/Error-States in allen neuen Panels konsistent.
- Leere Listen, fehlende Auswahl, invalid inputs verursachen keine Crashes.
- Layout-Resizing/Kollapsen funktioniert weiterhin stabil.

## F. Testabdeckung und Build-Gesundheit (5 Min)
- Backend:
  - API Tests fuer Agent Registry
  - API Tests fuer Project Memory/Task Board/Docs Analysis
- Frontend:
  - Store Tests fuer neue Stores
  - Bestehende Store-Mocks fuer erweiterte Bridge aktualisiert
- Tooling:
  - `pnpm typecheck` gruen
  - `uv run pytest` gruen

## Review-Output Template

### Findings (nach Prioritaet)
1. [Severity] Kurztitel - Datei/Scope - Impact
2. [Severity] Kurztitel - Datei/Scope - Impact

### Open Questions
1. Offene Annahme/Frage
2. Offene Annahme/Frage

### Decision
- `APPROVE`
- `REQUEST_CHANGES`

### Follow-ups
1. Optionales Hardening
2. Optionales Refactoring
