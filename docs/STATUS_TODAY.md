# STATUS TODAY

Stand: 2026-08-01

Repo-Wahrheit: `https://github.com/devdbzemusic/dbzs-codee-v4.git`

## Stabil

- `origin/main` zeigt nach frischem `git fetch` auf `a98e070` (PR #32 gemergt: Desktop-Bridge-Contracts,
  IPC-Regressionstests, `POST /embeddings`, `POST /rerank` und die Plan-14-Fortsetzung fuer
  ONNX-/Model-Lab-basierte Embeddings/Reranking)
- `feature/runtime-chat-ux-overhaul` ist mit `origin/feature/runtime-chat-ux-overhaul` synchron und gegenueber
  `origin/main` nur um den Merge-Commit von PR #32 hinterher; die fachlichen Commits sind in `main`
- PR #14 ist weiterhin der dokumentierte Abnahme-Test-Playbook-Stand: echter SERVICE_VERIFIED-Lauf unter
  `docs/audits/runs/2026-07-31_21-43/`, Vorher-/Nachher-Hashes fuer Patch/Rollback, Doku-Drift-Checker, plus
  drei begleitende Runtime-Chat-Fixes
- PR #31 ist gemergt: Model-Lab-sourcierter Embedding-Modell-Picker und konkretere Runtime-Exclusion-Gruende
  in der UI
- Produktionsreife-Revision Phase 1-4 (Rollenmodell-Fallback-Kette, Crash-Correlation-ID, GPU-Exklusivitaet,
  Vision-Broker-Routing, Prozess-Supervisor, Release-Gates-Vorbereitung, Diagnose-ZIP-Export, Repair-Mode,
  Settings-Migrations-Framework, Code-Signing-Grundgerüst) per PR #10-#13 in `main`
- Chat-Folgeaktionen Phase 2 (echtes Retry, `switch_model`-Aktion, Freitext-Fehlererkennung) in `main`
- juengster dokumentierter Plan-14-Nachweis: Backend 514/514 mit zwei bewusst deselektierten,
  vorbestehend haengenden Fremdtests; Desktop-Vitest 1361/1361; beide Typechecks fehlerfrei — siehe
  `HANDOVER.md` fuer Details je Phase
- Plan 15 Agentic Model Fleet Integration ist auf Branch `codex/agentic-model-fleet-integration` gestartet:
  Model-Lab-Schema v3, Fleet-Endpunkte, Zertifikats-/Rollen-Gates und optionale Desktop-Bridge-Vertraege
  sind implementiert; `model_variants`, Plan-15-Source-Candidates (`D:\Models\Agentic` empfohlen) und eine
  bounded `llama.cpp`-Probe-Preview sind nachgezogen; frische Checks: Backend 25/25, Desktop-Fokus 88/88,
  Desktop-Typecheck gruen
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
- Plan 15 braucht als naechste Gates echte lokale Modellarbeit: `D:\Models\Agentic` scannen, `llama.cpp`
  RuntimeAdapter live verdrahten, GPU-Autotuning/Benchmarks und Fleet Console UI ausbauen
- Vite meldet weiterhin Warnungen bei gemischten statischen/dynamischen Imports
  rund um `backendClient.ts` und `providerRuntimeEvents.ts`
- die zuvor aufgefallenen Plan-Dateien `Pläne/14 DBZS_CODEE_BACKEND_BRIDGE_REVIEW.md` und
  `Pläne/Codee_Agentenmodelle_Auswahl_Liste Teil I.md` sind im aktuellen Git-Stand getrackt

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

- Git-Remote frisch abgeglichen: `origin/main` ist `a98e070`, `origin/feature/runtime-chat-ux-overhaul` ist
  `b440763`
- die beiden Plan-Dateien unter `Pläne/` sind nicht mehr als unversionierter Sonderfall offen
- Plan 14 Phase 2 Fortsetzung ist dokumentiert: `/embeddings` und `/rerank` schliessen den bereits vom
  Desktop-RAG-Flow erwarteten Backend-Vertrag
