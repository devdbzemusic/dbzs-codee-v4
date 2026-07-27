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

- der aktuelle Runtime-Chat-Overhaul ist lokal bestaetigt, aber noch nicht in `main` integriert
- automatische GitHub-CI fuer `push` und `pull_request` ist noch nicht reaktiviert
- weitere Zerlegung von Runtime-/Store-Godfiles bleibt sinnvoll
- Contract-Parity zwischen Shared und Backend soll weiter gehaertet werden
- Vite meldet weiterhin Warnungen bei gemischten statischen/dynamischen Imports
  rund um `backendClient.ts` und `providerRuntimeEvents.ts`

## Experimentell

- komplexere Runtime-Routing- und Tool-Flows
- neue modulare Shell-/Panel-Aufteilung
- Conversation-First-Runtime-Chat mit aggressiverer Fortsetzung kurzer Antworten
- neue sekundaere Panel-/Diagnoseebene fuer Runtime-Chat

## Bewusst degradiert

- Branch Protection fuer `main` ist aktuell nicht aktiv
- es existieren keine offenen PRs; Merge-Hygiene muss deshalb ueber Audit und gezielte Branch-Freigabe gesteuert werden
- `ci.yml` ist nur manuell per `workflow_dispatch` aktiv
- historische Papiere unter `Pläne/` und `docs/archive/` koennen falsche oder ueberholte Repo-Annahmen enthalten

## Frisch bestaetigt heute

- Git-Backup-Branch fuer den Runtime-Chat-Umbau vorhanden:
  `codex/backup-runtime-chat-overhaul-2026-07-27`
- physischer Snapshot vorhanden:
  `C:\Users\ralle\source\repos\_backups\dbzs-codee-project-backup-2026-07-27-runtime-chat-overhaul`
- Runtime-Chat-Typecheck und gezielte Desktop-Tests gruen
- Desktop-Tuning-Lab und Backend-Tuning-Lab gruen
- lokaler App-Start ueber `start-dev.ps1` erfolgreich
