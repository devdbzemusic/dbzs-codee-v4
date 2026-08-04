# STATUS TODAY

Stand: 2026-08-04

Repo-Wahrheit: `https://github.com/devdbzemusic/dbzs-codee-v4.git`

## Stabil

- `origin/main` zeigt auf `27a89cf`. Seit dem vorherigen Stand (`a98e070`, PR #32) sind 16 weitere PRs
  gemergt (#33-#48) — im Kern Plan 15 "Agentic Model Fleet Integration" (Model-Lab-Schema v3, Fleet-Routing/
  -Readiness-Maps, Rollen-/Workflow-Modell-Matrix vollstaendig verdrahtet, RAM-Pressure-Schutz, Dual-Mode
  Vision Phase 5). Volle PR-fuer-PR-Historie in `TODO.md`.
- **2026-08-03/04: Stufe 6 (Agentic-Fleet-Abschlussverifikation) durchgefuehrt.** Erster vollstaendiger
  Testlauf seit dem PR-#48-Merge deckte zwei echte Regressionen auf, die seit Tagen unbemerkt geblieben
  waren, weil zuvor immer nur gezielte Testteilmengen liefen: (1) fehlendes `await` machte die
  Vision-Context-Pack-Pipeline funktionslos; (2) der "Übernehmen"-Button (Review→Apply, Kern der sicheren
  Aenderungskette) warf seit dem 2026-08-02-Sicherheits-Hardening bei jedem Klick einen Fehler. Beide
  behoben. Mehrere als "bekannt/vorbestehend" abgestempelte Test-Flakes waren ebenfalls echte Bugs
  (unconditional reale Produktions-Singletons statt Test-Isolation) — root-caused und behoben, Backend-Suite
  dadurch 250s→170s schneller. Details: `HANDOVER.md`.
- **2026-08-04: Nacharbeiten.** 13 offene Dependabot-Findings behoben (Versions-Overrides + `cryptography`-
  Upgrade in `uv.lock`); Dev-Bootstrap automatisiert (`pnpm bootstrap`, `postinstall`-Hook behebt einen
  zuvor stillen Ausfall des Electron-Binary-Downloads); Fixture-Vollstaendigkeits-Check und
  Doku-Drift-Check jetzt in `pnpm repo:health`/`ci-local` eingehaengt statt ungenutzt danebenzuliegen.
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
- PR #35 ist gemergt: Plan 15 Agentic Model Fleet Integration (Model-Lab-Schema v3, Fleet-Endpunkte,
  Zertifikats-/Rollen-Gates, optionale Desktop-Bridge-Vertraege, `model_variants`, Plan-15-Source-Candidates,
  bounded `llama.cpp`-Probe-Preview, Runtime-Presets, Hardware-Snapshots, normalisierte
  Benchmark-Measurements, Fleet-Routing-/Readiness-Maps, Execution-Policies mit Safety-Max-Gate, Capability
  Evidence, read-only Roles-&-Routing-/Readiness-UI, die Plan-14/Fleet-RAG-Folge fuer serverseitiges
  `query_embedding` in `POST /rag/retrieve`, sowie Plan 15 Phase 3: bearbeitbare `Rollenzuordnung`-Sektion
  im Model-Lab-Tab mit `settings_field`/`residency_intent`, Konfliktanzeige und Best-effort Start-Aktion) in `main`
- PR #36 ist gemergt: Plan 15, Phase 0/1/2 (Scanner-Adapter/Lora-Reihenfolge-Fix inkl. korrigiertem
  JSON/Tokenizer-Klassifizierungsfall; verwaiste GET-mit-Seiteneffekt-Quellauto-Registrierung entfernt; tote
  `model_lab_roles.py` geloescht; `enableModelLabRuntimeBridge`-Setting plus gedeckelter (500 Dateien/Root, 5s
  Budget) Model-Lab-Extra-Roots-Scan in `ModelIndexService`, noch an keinem Produktions-Call-Site verdrahtet)
  in `main`
- PR #37 ist gemergt: CLIP-Vision-Projector-GGUF-Dateien (z. B. `phi4-mm-vision-q8.gguf`) wurden mangels
  `"mmproj"`/`"projector"` im Dateinamen faelschlich als Hauptmodell eingestuft und stuerzten beim Start ab;
  `_infer_artifact_type()` nutzt jetzt `general.architecture == "clip"` aus den ohnehin gelesenen
  GGUF-Metadaten als primaeres, autoritatives Signal; frische Checks: `test_model_index.py` 28/28 (2 neu),
  voller Backend-Lauf 555/555
- Bugfix auf Branch `codex/agentic-model-fleet-integration` nachgezogen (noch nicht gemergt):
  `request_binding_mismatch: settings_revision_changed` warf lange Modell-Warmup-Waits unnoetig weg, weil
  eine rohe, bei jeder beliebigen Settings-Aenderung bumpende Revision verglichen wurde statt nur der
  routing-relevanten; neue `hasRoutingRelevantSettingsChanged()` in `modelSelectionBroker.ts` vergleicht
  gezielt nur das Feld, das die aktuelle Modellwahl tatsaechlich speist; frische Checks:
  `modelSelectionBroker`-Suite 53/53 (4 neu), `runtimeChatStore`-Suite 52/52, voller Desktop-Lauf 1370/1370,
  Desktop-Typecheck fehlerfrei
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
