# Main Readiness Audit

Datum: 2026-07-27

Geprueftes GitHub-Repository: `devdbzemusic/dbzs-codee-v4`

Remote-URL:

```text
https://github.com/devdbzemusic/dbzs-codee-v4.git
```

## Zweck

Dieses Audit friert den belegten Repair-Run-Stand fuer `main`-Readiness und GitHub-Hygiene ein. Es ersetzt keine spaetere Merge-Entscheidung, aber es ist die aktive Wahrheitsquelle fuer den Stand vom 2026-07-27.

## Baseline

- `origin/main`: `97063959fb54fbc6ba220797773174b4bf990732`
- lokaler Arbeitsbranch waehrend des Repair-Runs: `codex/godfiles-split-top3`
- Fokus: Gate-blockierende Reparaturen, Doku-Wahrheit, GitHub-Hygiene

## GitHub-Realitaet

### Pull Requests

- offene PRs im Repo `devdbzemusic/dbzs-codee-v4`: keine

### Branch Protection

- `main` ist aktuell nicht durch GitHub Branch Protection abgesichert
- REST-Abfrage auf Branch Protection liefert `404 Branch not protected`

### Workflow-Status

- `CI`: aktiv, aber nur `workflow_dispatch`
- `Live Runtime Validation`: aktiv
- `Release`: aktiv
- `Dependabot Updates`: aktiv
- `Dependency Graph`: aktiv

### Trigger-Realitaet

- `.github/workflows/ci.yml`:
  - derzeit nur manueller Trigger `workflow_dispatch`
  - Kommentar in der Datei verweist auf deaktivierte Auto-Trigger und lokalen Pflichtpfad
- `.github/workflows/release.yml`:
  - Trigger auf Tag-Pushes `v*-rc.*`

## Durchgefuehrter Repair-Run

### Vollstaendige lokale Required Gates

Erfolgreich ausgefuehrt:

```powershell
pnpm ci:local:win
```

Ergebnis:

- Shared Tests: 9/9 bestanden
- Desktop Tests: 1055 bestanden, 42 bewusst geskippt
- Desktop Testdateien: 174 bestanden, 3 geskippt
- Desktop Capability Suite: 37/37 bestanden
- Backend Pytest: 409 bestanden, 1 Warning
- Build: erfolgreich
- Packaging Smoke: erfolgreich
- Security Regression Tests: 14/14 bestanden
- Backend Smoke: erfolgreich
- Backend Doctor: 7/7 Checks OK
- Dependency Audit: keine bekannten Schwachstellen

### Separater Capability-Nachweis

Zusatzlauf:

```powershell
pnpm test:capabilities
```

Ergebnis:

- Backend Capability-/Scenario-/Tuning-Lab-Pfade: 15 Tests bestanden
- Warning: bekannte `fastapi.testclient`-Deprecation im Testkontext

Hinweis:

- Der Desktop-Capability-Nachweis wird fuer den echten Gate-Lauf ueber `RUN_CAPABILITY_SUITE=1` aktiviert.
- Der Root-Befehl `pnpm test:capabilities` wurde im Repair-Run so korrigiert, dass dieser Desktop-Nachweis jetzt ebenfalls explizit ausgefuehrt wird.

## Reparierte Gate-Blocker im Run

### Desktop

- `apps/desktop/src/services/missingInformationPolicy.ts`
  - Rueckfrage- und Akzeptanzlogik an aktuelle Conversation-/Clarification-Erwartungen angepasst
- `apps/desktop/src/services/runtimeRunFinalization.ts`
  - Nutzertext fuer `context_overflow` expliziter und konsistenter gemacht
- `apps/desktop/src/stores/runtimeChatStore.test.ts`
  - Testhelfer an den aktuellen Delta-Callback-Fluss angepasst

### Backend

- `backend/app/runtime/service.py`
  - fehlende `urllib.request`-Import-Sichtbarkeit fuer Runtime-Tests wiederhergestellt

### Skriptwahrheit

- `package.json`
- `scripts/run-desktop-capability-suite.mjs`
  - Root-Capability-Befehl fuehrt den Desktop-Anteil jetzt verifiziert mit gesetztem `RUN_CAPABILITY_SUITE=1` aus

## Doku-Wahrheit und Abgrenzung

- `README.md` wurde auf den aktuellen Repo-Namen, den bestaetigten Gate-Stand und die reale CI-Situation ausgerichtet
- `docs/STATUS_TODAY.md` wurde als aktiver Statuspfad auf den Stand vom 2026-07-27 aktualisiert
- das Papier `Pläne/01 DBZS_CODEE_GITHUB_STATUS_2026-07-27.md` wird nur als externe bzw. historische Analyse betrachtet

Warum nur historisch:

- es verweist nicht verlaesslich auf das aktive GitHub-Repository
- es arbeitet mit PR-Annahmen, die im Live-Repo am 2026-07-27 nicht bestaetigt sind
- es darf deshalb nicht als alleinige Quelle fuer `main`-Readiness verwendet werden

## Offene Restrisiken

- die Repair-Run-Fixes sind lokal bestaetigt, aber noch nicht in `main` integriert
- ohne automatische `push`-/`pull_request`-Trigger bleibt GitHub-seitige Merge-Disziplin manuell
- ohne Branch Protection kann `main` nicht auf Required Checks erzwungen werden
- eine echte Windows-Golden-Path-Abnahme auf frischer Umgebung ist durch dieses Audit nicht ersetzt

## Empfehlung

### Go

- Repair-Run als technisch belastbaren lokalen Nachweis verwenden
- aktuelle Gate-Fixes gezielt committen und fuer Merge vorbereiten
- README und Statusdoku ab jetzt nur noch gegen dieses Audit und Live-Repo pflegen

### Noch offen vor einem vollstaendig belastbaren `main`

1. aktuelle Repair-Run-Aenderungen committen
2. Branch sauber pushen
3. CI-Trigger-Strategie fuer GitHub entscheiden und dokumentieren
4. mindestens einen echten GitHub-Lauf nach Reaktivierung dokumentieren
5. Windows-Golden-Path auf frischer Umgebung separat abnehmen
