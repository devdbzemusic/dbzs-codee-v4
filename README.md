# DBZS Codee V4

Aktiver Remote: [devdbzemusic/dbzs-codee-v4](https://github.com/devdbzemusic/dbzs-codee-v4)

Lokaler Ordnername und einige historische Dokumente verwenden noch `dbzs-codee-project`. Fuer den aktuellen Projektstatus gilt der GitHub-Remote `dbzs-codee-v4` als Quelle der Wahrheit.

## Aktueller Stand

Stand: 2026-07-27

- Repo-Readiness auf lokalem Repair-Stand nachgewiesen.
- Vollstaendige Windows-Required-Gates liefen lokal gruen ueber `pnpm ci:local:win`.
- GitHub-CI ist derzeit nicht automatisch an `push` oder `pull_request` gebunden.
- `origin/main` zeigt auf `97063959fb54fbc6ba220797773174b4bf990732`.
- Offene Pull Requests im Repo `devdbzemusic/dbzs-codee-v4`: keine.
- Branch Protection fuer `main`: aktuell nicht aktiv.

Der Repair-Run vom 2026-07-27 wurde bewusst auf Nachweis, Doku-Wahrheit und GitHub-Hygiene ausgerichtet, nicht auf neue Features.

## Bestaetigte Nachweise

### Required Gates

Der lokale Spiegel der Required Gates lief erfolgreich durch:

```powershell
pnpm ci:local:win
```

Enthaltene Bloecke:

- Dependency-Install und Backend-Sync
- Repo-Health
- Contract Verification
- Shared- und Desktop-Typecheck
- Shared- und Desktop-Tests
- Desktop-Capability-Suite
- Backend-Pytest
- Desktop-Build
- Packaging-Smoke
- Security-Regression-Tests
- Backend-Smoke
- Backend-Doctor
- Dependency-Audit

### Capability-Pfad

Der kombinierte Capability-Nachweis besteht aus Desktop- und Backend-Teil:

```powershell
pnpm test:capabilities
```

Bestaetigt am 2026-07-27:

- Desktop Capability Suite: 37/37
- Backend Capability-/Scenario-/Tuning-Lab-Fixtures: 15 Tests bestanden

## CI-Realitaet

Aktuell gilt:

- `.github/workflows/ci.yml` laeuft nur per `workflow_dispatch`
- `.github/workflows/release.yml` reagiert auf Tag-Pushes `v*-rc.*`
- der lokale Qualitaets-Gate-Spiegel bleibt `pnpm ci:local:win`

Solange automatische GitHub-Trigger nicht wieder aktiviert sind, ist lokales Required-Gate-Passing vor Merge Pflicht.

## Quickstart

```powershell
git clone https://github.com/devdbzemusic/dbzs-codee-v4.git
cd dbzs-codee-v4
pnpm install
cd backend
uv sync
cd ..
pnpm dev
```

## Wichtige Befehle

```powershell
pnpm ci:local:win
pnpm test:capabilities
pnpm build
pnpm smoke:packaging
pnpm smoke:backend
pnpm doctor:backend
```

## Aktive Statusdokumente

- [docs/STATUS_TODAY.md](docs/STATUS_TODAY.md)
- [docs/audits/MAIN_READINESS_AUDIT_2026-07-27.md](docs/audits/MAIN_READINESS_AUDIT_2026-07-27.md)
- [HANDOVER.md](HANDOVER.md)
- [TODO.md](TODO.md)

## Wichtige Einschraenkungen

- Der lokale Readiness-Nachweis ersetzt keinen echten GitHub-Run auf `push` oder `pull_request`, solange `ci.yml` nur manuell ausloesbar ist.
- Die aktuelle Arbeitskopie enthaelt neben Quellcodeaenderungen auch generierte Packaging-Artefakte unter `.cache/backend-build/`; diese gehoeren nicht automatisch in einen Commit.
- Historische Statuspapiere unter `Pläne/` oder `docs/archive/` koennen veraltete Repo-, PR- oder Gate-Annahmen enthalten und muessen gegen die aktiven Audit-Dokumente geprueft werden.
