# STATUS TODAY

Stand: 2026-07-27

Repo-Wahrheit: `https://github.com/devdbzemusic/dbzs-codee-v4.git`

## Stabil

- lokaler Required-Gate-Spiegel `pnpm ci:local:win` lief am 2026-07-27 vollstaendig gruen
- Shared-, Desktop- und Backend-Kernchecks sind belastbar nachgewiesen
- Desktop-Capability-Suite ist im Gate-Pfad mit 37/37 belegt
- Backend-Capability-/Scenario-/Tuning-Lab-Pfad ist mit 15 bestandenen Tests belegt
- `origin/main` zeigt auf `97063959fb54fbc6ba220797773174b4bf990732`

## Unter Beobachtung

- die aktuellen Repair-Run-Fixes sind lokal bestaetigt, aber noch nicht in `main` dokumentiert integriert
- automatische GitHub-CI fuer `push` und `pull_request` ist noch nicht reaktiviert
- weitere Zerlegung von Runtime-/Store-Godfiles bleibt sinnvoll
- Contract-Parity zwischen Shared und Backend soll weiter gehaertet werden

## Experimentell

- komplexere Runtime-Routing- und Tool-Flows
- neue modulare Shell-/Panel-Aufteilung
- groessere Conversational-/Runtime-Chat-Umbauten im Umfeld des laufenden Refactorings

## Bewusst degradiert

- Branch Protection fuer `main` ist aktuell nicht aktiv
- es existieren keine offenen PRs; Merge-Hygiene muss deshalb ueber Audit und gezielte Branch-Freigabe gesteuert werden
- `ci.yml` ist nur manuell per `workflow_dispatch` aktiv
- historische Papiere unter `Pläne/` und `docs/archive/` koennen falsche oder ueberholte Repo-Annahmen enthalten
