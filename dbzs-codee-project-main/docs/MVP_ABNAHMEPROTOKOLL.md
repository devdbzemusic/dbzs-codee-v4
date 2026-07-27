# MVP Abnahmeprotokoll

Datum: 2026-05-10
Branch: feature/phase-1-foundation

## Scope

Gepruefte Prioritaeten:
1. Projektordner oeffnen
2. Projektdateien scannen und anzeigen
3. Datei oeffnen, bearbeiten und speichern
4. Settings-Fenster ueber Menue Datei -> Einstellungen und Shortcut Ctrl+,
5. Default-Agenten in der Agent Registry anzeigen

## Evidenz

### Automatisierte Validierung

- Typecheck: PASS
  - `pnpm typecheck`
- Desktop Tests: PASS
  - `pnpm --filter @dbzs/desktop test -- --run`
  - 11 Test Files, 20 Tests gruen
- Backend Tests: PASS
  - `uv run pytest`
  - 23 Tests gruen
- API Sanity: PASS
  - `/settings` enthaelt erweitertes Schema inkl. `modelsPath`, `backendUrl`
  - `/agents` liefert 6 Default-Agenten mit Rollen: planner, coder, tester, reviewer, debugger, docs

### Implementierungsnachweise nach Prioritaet

1. Projektordner oeffnen: PASS
- Electron IPC: `dbzs:workspace:select-project-directory`
- Store/UI Wiring vorhanden

2. Projektdateien scannen und anzeigen: PASS
- Sicherer rekursiver Scan mit Ignore-Regeln
- Ignore-Liste enthaelt: node_modules, .git, dist, build, .next, out, coverage, __pycache__

3. Datei oeffnen, bearbeiten, speichern: PASS
- Read/Write nur innerhalb des aktiven Workspace
- Editor Store unterscheidet Dialog-Dateien und Workspace-Dateien

4. Settings-Fenster + Shortcut: PASS
- Menue Datei -> Einstellungen vorhanden
- Shortcut CommandOrControl+, vorhanden
- Hash-Route fuer separates Settings-Fenster vorhanden

5. Default-Agenten in Registry: PASS
- Seeder fuer planner/coder/tester/reviewer/debugger/docs vorhanden
- Rollenmodell in Shared + Backend aktiv

## Sichtpruefung UI (manuell)

Status: OFFEN (nicht per CLI automatisierbar)

Empfohlene manuelle 2-Minuten-Pruefung:
1. App starten (`pnpm run dev`)
2. Projekt oeffnen
3. Projektdatei aus Liste oeffnen
4. Inhalt editieren und speichern
5. Settings via Menue und via Ctrl+, oeffnen
6. Agent Registry auf 6 Default-Agenten pruefen

## Risiken / Hinweise

- Historisch liefen lokale Altprozesse auf Port 8765. Der App-Default wurde auf 8876 isoliert, um Konflikte zu vermeiden.
- Untracked im Repo (bewusst nicht Teil der Commits):
  - Prompt 3 mvp.txt
  - workspace Prompt.md

## Gesamtbewertung

Technische Abnahme: PASS
Manuelle UI-Sichtpruefung: noch ausstehend
