# STATUS TODAY

Stand: 2026-07-31

Repo-Wahrheit: `https://github.com/devdbzemusic/dbzs-codee-v4.git`

## Stabil

- `origin/main` zeigt auf `63a2675efbddf69a130406608bacc46869d9026a` (PR #11 gemergt: Produktionsreife-Revision
  Phase 2 — GPU-Exklusivitaet, Vision-Broker-Routing, Prozess-Supervisor)
- Produktionsreife-Revision Phase 1 (Rollenmodell-Fallback-Kette, Crash-Correlation-ID) per PR #10 in `main`
- Chat-Folgeaktionen Phase 2 (echtes Retry, `switch_model`-Aktion, Freitext-Fehlererkennung) in `main`
- voller Desktop-Vitest-Lauf (1281 Tests gruen, 42 geskippt) und voller Backend-Pytest-Lauf (446 gruen) zum
  Stand dieses Eintrags, beide Typechecks fehlerfrei — siehe `HANDOVER.md` fuer Details je Phase
- Shared-, Desktop- und Backend-Kernchecks sind belastbar nachgewiesen
- Desktop-Capability-Suite ist im Gate-Pfad mit 37/37 belegt
- Backend-Capability-/Scenario-/Tuning-Lab-Pfad ist mit 15 bestandenen Tests belegt

## Unter Beobachtung

- automatische GitHub-CI fuer `push` und `pull_request` ist weiterhin nicht reaktiviert (GitHub-Billing-Sperre,
  Reaktivierungs-Checkliste in `HANDOVER.md`)
- Branch Protection fuer `main` weiterhin nicht aktiv (dokumentierter, nicht ausgefuehrter Befehl in `HANDOVER.md`)
- mehrere Punkte der Produktionsreife-Revision (Rollenmodell-Fallback, Crash-Correlation, GPU-Exklusivitaet)
  sind nur automatisiert (gegen Fakes/Mocks) verifiziert, nicht gegen echte laufende Modelle — siehe
  `docs/audits/GOLDEN_PATH_MANUAL_VERIFICATION_SCRIPT.md`, Abschnitt D
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

- Produktionsreife-Revision Phase 1 + Phase 2 (PR #10, PR #11) vollstaendig automatisiert verifiziert und
  gemergt — siehe `HANDOVER.md` fuer die Detailliste je Phase
- voller Desktop-Vitest-Lauf (1281 Tests gruen) und voller Backend-Pytest-Lauf (446 gruen) nach jedem Merge
  wiederholt, beide Typechecks (`tsconfig.node.json`, `tsconfig.web.json`) fehlerfrei
- Sandbox-Prozessueberleben erneut getestet (Windows Task Scheduler) — bestaetigt weiterhin nicht moeglich in
  dieser Sandbox, siehe `docs/audits/GOLDEN_PATH_MANUAL_VERIFICATION_SCRIPT.md`, Abschnitt D
- Git-Backup-Branch fuer den Runtime-Chat-Umbau weiterhin vorhanden:
  `codex/backup-runtime-chat-overhaul-2026-07-27`
