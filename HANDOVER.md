# Handover

Stand: 2026-08-01

## Aktuelle Repo-/Statuslage (2026-08-01)

Frisch geprueft nach `git fetch origin --prune`: `origin/main` zeigt auf `a98e070` (Merge von PR #32).
Der lokale Branch `feature/runtime-chat-ux-overhaul` ist mit `origin/feature/runtime-chat-ux-overhaul`
synchron und gegenueber `origin/main` nur um den Merge-Commit hinterher; die fachlichen Commits
`b7bbd9b`, `1249e4c` und `b440763` sind in `main` enthalten.

Die zuvor aufgefallenen Plan-Dateien `Pläne/14 DBZS_CODEE_BACKEND_BRIDGE_REVIEW.md` und
`Pläne/Codee_Agentenmodelle_Auswahl_Liste Teil I.md` sind im aktuellen Git-Stand getrackt; es bleibt keine
separate Untracked-Entscheidung fuer diese beiden Dateien offen.

## Bugfix: `request_binding_mismatch` warf lange Warmup-Waits unnoetig weg (2026-08-01)

**Auftrag:** Nutzer meldete per echtem Run-Log einen zweiten Live-Absturz aus der gebauten App: ein
Chat-Turn brauchte 7 Minuten (Runtime-Check 246s, Kontextvorbereitung 174s — beides plausibel echte
`llama.cpp`-Modell-Warmup-Latenz auf der 4-GB-VRAM-Karte, `warmupStatus: "pending"` bestaetigt das) und
brach direkt vor dem Senden ab mit `request_binding_mismatch: settings_revision_changed old=202 new=204`.

**Untersuchung Punkt 1 (warum so langsam?):** `ensureBackendReachable()`
(`runtimeChatStoreExecutionHelpers.ts:288-301`) selbst ist schnell (max. 3 Versuche, kurze Sleeps) — die
eigentliche Wartezeit steckt in den echten Backend-Calls (`getRuntimeStatus()`/Slot-Status), waehrend
`llama-server` ein Modell laedt. Das ist **kein Code-Bug**, sondern erwartete Cold-Start-Latenz fuer ein
3B-Vision-Modell auf bescheidener Hardware — passend zum bewussten "Lazy Runtime"-Entwurf
(`runtimeChatStore.ts:946`: Arbeitsmodelle starten erst NACH Routing+Budget, nicht davor). Keine Aenderung
vorgenommen; als Hardware-/UX-Erwartung dokumentiert statt als Bug behandelt.

**Root Cause Punkt 2 (der eigentliche Bug):** `runtimeChatStore.ts:2040` verglich vor dem Senden die rohe
`settingsRevision` (bumpt bei *jeder* Settings-Aenderung, auch Theme/Editor-Schriftgroesse) gegen die beim
Routing gebundene Revision — bei jeder Abweichung wurde der komplette, bereits Minuten gelaufene Request
verworfen. Wegen des "Lazy Runtime"-Entwurfs kann zwischen Routing und tatsaechlichem Senden legitim viel
Zeit liegen (hier 3 Minuten), in der der Nutzer voellig unabhaengige Einstellungen aendern kann. Ein
bereits vorhandener, aber nie produktiv verdrahteter Helper `isDecisionStillValid()`
(`modelSelectionBroker.ts:1051`, nur in `bindingWorkflowGrounding.test.ts` benutzt) haette dasselbe Problem
gehabt (5s-Freshness plus derselbe rohe Revisionsvergleich) — fuer minutenlange Warmups ungeeignet.

**Fix:** neue, gezielte Funktion `hasRoutingRelevantSettingsChanged()` (`modelSelectionBroker.ts`, nach
`isDecisionStillValid`) leitet mit den bereits auf der Entscheidung gespeicherten Feldern
(`taskType`/`targetAgent`/`modelRole`/`configuredModelId`) per den existierenden reinen Funktionen
`selectModelForRole`/`selectModelForTask` erneut ab, welches Settings-Feld die Modellwahl aktuell liefern
wuerde, und vergleicht nur dieses eine Feld gegen den beim Binding gespeicherten Wert. `runtimeChatStore.ts`
wirft den `request_binding_mismatch`-Fehler jetzt nur noch, wenn die Revision UND dieser gezielte Vergleich
eine echte Aenderung zeigen — eine Theme-Aenderung waehrend eines Warmups bricht den Request nicht mehr ab,
eine echte Modell-/Rollen-Umstellung weiterhin schon.

**Verifiziert:**
- `npx vitest run modelSelectionBroker` in `apps/desktop` -> 53/53 gruen (4 neu fuer
  `hasRoutingRelevantSettingsChanged`: unveraendert, irrelevantes Rollenfeld geaendert, relevantes Feld
  geaendert (Chat + Coding))
- `npx vitest run runtimeChatStore` -> 52/52 gruen (keine Regression)
- `npx vitest run` (voller Desktop-Lauf) -> 1370/1370 gruen (42 bewusst uebersprungen)
- `npx tsc --noEmit` in `apps/desktop` -> gruen

## Bugfix: CLIP-Vision-Projector-Dateien faelschlich als Hauptmodell gestartet (2026-08-01)

**Auftrag:** Nutzer hat die echte gebaute App auf einem anderen Projekt laufen lassen und einen konkreten
Runtime-Absturz gemeldet: `D:\Models\GGUF_LIBRARY\phi4-multimodal-quantized-ggml\phi4-mm-vision-q8.gguf`
wurde vom Runtime-Modell-Index als normales Chat-Modell eingestuft und mit `llama-server` gestartet;
llama.cpp brach sofort ab mit `error loading model: CLIP cannot be used as main model, use it with --mmproj
instead`.

**Root Cause verifiziert:** `_infer_artifact_type()` in `backend/app/models/index_service.py:988-996` prüfte
ausschließlich den Dateinamen auf die Substrings `"mmproj"`/`"projector"`. Der Dateiname
`phi4-mm-vision-q8.gguf` enthält keinen davon (nur `"mm-vision"`), obwohl die GGUF-Datei selbst laut dem vom
Nutzer geposteten Ladelog eindeutig ein CLIP-Vision-Projector ist (`general.architecture = "clip"`, jede
Menge `clip.vision.*`-Metadaten-Keys). Diese Architektur-Metadaten wurden im selben Codepfad bereits per
`read_gguf_metadata()` gelesen (fuer die Quantisierungserkennung), aber nie fuer die Artefakt-Typ-Klassifizierung
herangezogen — ein zuverlaessiges Signal lag ungenutzt direkt daneben.

**Fix:** `_infer_artifact_type(path, architecture=None)` bekommt einen optionalen `architecture`-Parameter;
`architecture == "clip"` ist jetzt das primaere, autoritative Signal (noch vor der Dateinamen-Heuristik) fuer
`artifact_type="mmproj"`. Im Filesystem-Scan-Pfad (`_from_filesystem`, Zeile ~470) wird `read_gguf_metadata()`
jetzt vor `_infer_artifact_type()` aufgerufen und `gguf_metadata.architecture` durchgereicht. Der
Katalog-Fallback-Pfad (`_from_catalog`, Zeile 305) bleibt unveraendert (Dateiname-only), da Katalogeintraege
normalerweise bereits einen expliziten `artifact_type` mitbringen und dort kein GGUF-Header gelesen wird.

**Bekannte Einschraenkung:** bereits bestehende `model-index-cache.json`-Eintraege mit der alten,
falschen Klassifizierung werden per Datei-Signatur-Cache weiterverwendet, bis sich die Datei aendert oder
der Cache manuell/durch Neustart invalidiert wird — bei einer echten betroffenen Installation ist ein
frischer Scan noetig, damit der Fix sichtbar wird.

**Verifiziert:**
- `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_model_index.py -q` -> 28/28 gruen, davon 2 neu:
  `test_infer_artifact_type_uses_clip_architecture_over_filename` (direkter Funktionstest mit/ohne
  `architecture="clip"`) und `test_model_index_classifies_clip_projector_by_metadata_not_filename`
  (End-zu-Ende ueber `build_index()` mit einer echten, handgebauten Minimal-GGUF-Fixture mit
  `general.architecture="clip"` und irrefuehrendem Dateinamen)
- `backend\.venv\Scripts\python.exe -m pytest -q` (voller Backend-Lauf) -> 555/555 gruen

## Plan 15: Agentic Model Fleet Integration, Foundation-Slice gestartet (2026-08-01)

Branch: `codex/agentic-model-fleet-integration`. Basis ist der aktuelle Arbeitsstand inklusive der
Statusdokumente und `Pläne/15 DBZS_CODEE_AGENTIC_MODEL_FLEET_INTEGRATION_MASTERPLAN.md`.

**Umgesetzt:**
- Model Lab SQLite-Schema auf Version 3 erweitert: logische Modelle, Runtime-Adapter/-Presets,
  Hardware-Snapshots, Probe-/Benchmark-Runs, Capability Evidence, Zertifikate, Rollen-Zuweisungen,
  Failures und Agent-Execution-Policies.
- `model_variants` als eigene Masterplan-Schicht nachgezogen: Varianten werden stabil aus Bundles abgeleitet,
  ueber `/model-lab/variants` abgefragt und an `logical_model_id` gebunden.
- Plan-15-Source-Candidates umgesetzt: `/model-lab/source-candidates` prueft die bekannten Masterplan-Pfade
  (`D:\Models\Agentic` empfohlen) auf Existenz und Registrierungsstatus; die Model-Lab-UI zeigt sie direkt
  als uebernehmbare Quellen an, ohne automatisch produktive Pfade in die DB zu schreiben.
- `llama.cpp`-RuntimeAdapter-Vorstufe umgesetzt: `probeModel` baut jetzt eine bounded Command-/Validation-
  Preview mit `runtime_dir`, `endpoint`, `command_preview`, `blockers` und `warnings`, ohne breite
  Runtime-Discovery und ohne Prozessstart.
- Safety-Fix fuer Scans: `/model-lab/scan` ohne `source_id` verlangt jetzt explizit `all_sources=true`;
  die Model-Lab-UI sendet dieses Flag nur beim bewussten Button "Alle Quellen scannen".
- Plan-15-Runtime-Presets werden beim DB-Init geseedet: `cpu_fallback`, `safe_balanced`,
  `best_low_latency`, `best_throughput`, `large_context` mit den Masterplan-Achsen fuer GPU-Layer,
  Context, Batch/Ubatch, KV-Cache und Flash-Attention.
- Hardware-Snapshots werden jetzt im Model Lab persistiert: `/model-lab/hardware` bleibt kompatibel,
  schreibt aber zusaetzlich einen Snapshot; `/model-lab/hardware-snapshots` liefert die letzten Snapshots
  als Grundlage fuer Tuning-/Benchmark-Kontext.
- Benchmark-Runs schreiben flache numerische Metrics zusaetzlich in `benchmark_measurements`; der neue
  Endpunkt `/model-lab/benchmark-measurements` liefert diese normalisierte Messspur fuer Tuning Lab und
  Benchmark-UI. Echte Runtime-Messlaeufe bleiben weiterhin ein spaeteres Adapter-Gate.
- Statuskette auf die Masterplan-Stufen erweitert (`COMPATIBLE`, `LOADABLE`, `TUNED`, `BENCHMARKED`,
  `CERTIFIED`, `DEGRADED`, `QUARANTINED`), bestehende Altstatus bleiben kompatibel.
- Neue Model-Lab/Fleet-Endpunkte unter `/model-lab`: logical models, runtime adapters/presets,
  `probe`, probe-runs, benchmark-runs, certifications, role-assignments und failures.
- `DesktopBridgeV1`, Electron-IPC, Preload und `backendClient` kennen die neuen Fleet-Operationen.
  Die Bridge-Methoden bleiben optional, damit bestehende Test-/Mock-Teilbruecken kompatibel bleiben.
- `probeModel` ist im ersten Slice absichtlich ein sicheres Gate: ohne `allow_start` wird ein
  nachvollziehbarer `skipped`-Probe-Run gespeichert, aber kein lokales Modell gestartet.
- Rollen-Zuweisungen werden nicht dateinamensbasiert freigegeben, sondern verlangen die im Masterplan
  definierten Zertifikate; Schreib-/Workspace-Rollen verlangen zusaetzlich `WRITE_AGENT_VERIFIED`.
- Rollen-Zuweisungen erzwingen jetzt auch das Policy-Maximum fuer Safety-Level: eine Rolle kann nicht als
  `LEVEL_4_SHELL_AND_GIT` gespeichert werden, wenn ihre Execution-Policy maximal Read-only erlaubt.
- Fleet-Routing-Map nachgezogen: `/model-lab/routing-map` aggregiert Rollen-Zuweisung, Bundle-Metadaten
  und bestandene/fehlende Zertifikate zu einer broker-/UI-lesbaren Freigabekarte; `routing_allowed` ist
  nur bei aktivierter Zuweisung und vollstaendiger Evidence wahr.
- Model-Lab-UI laedt diese Routing-Map und zeigt sie als erste read-only `Roles & Routing`-Sektion mit
  Rolle, Modell, Safety-Level, Evidence-Zaehler und Freigabestatus.
- Execution-Policies sind jetzt offiziell lesbar: `/model-lab/execution-policies` plus Desktop-Bridge/
  IPC/Preload/`backendClient` liefern die geseedeten Rollenregeln ohne direkten SQLite-Zugriff.
- Capability Evidence ist als eigene Model-Lab-Schnittstelle verfuegbar: `/model-lab/capability-evidence`
  kann allgemeine Faehigkeitsnachweise pro Bundle speichern/listen; Zertifikate bleiben die harte
  Rollenfreigabe, Evidence ist die breitere Nachweisspur fuer UI, Tuning und Certification.
- `certifyModel` schreibt jede Zertifizierung zusaetzlich als Capability Evidence
  (`certification:<KIND>`) mit Status-Mapping `passed -> verified`, `failed -> failed`, `revoked -> revoked`.
- `probeModel` schreibt jeden Probe-Run zusaetzlich als Capability Evidence (`runtime_probe:<adapter>`);
  fehlgeschlagene Probes werden `failed`, sichere Vorpruefungen und queued Live-Probes `observed`.
- Fleet-Readiness-Map ergaenzt: `/model-lab/readiness` aggregiert pro Bundle Health/Status, letzte
  Probe/Benchmark, Zertifikats-/Evidence-/Failure-Zaehler, Rollen und Routing-Freigaben inklusive
  Blocker-Liste. Damit muessen UI und Broker keine Tabellen-Rohdaten zusammensetzen.
- Model-Lab-UI zeigt die Readiness-Map jetzt als `Readiness Gates`-Sektion mit Probe/Benchmark,
  Evidence-/Zertifikatszaehlern, Routing-Freigaben und Blockern.
- Plan 15, Phase 3 (Roles & Routing) umgesetzt: `model_role_assignments` traegt jetzt zusaetzlich
  `settings_field` (welches der 8 echten `AppSettings`-Rollenfelder ein Bundle als Routing-Ziel
  vorschlaegt) und `residency_intent` (`keep_resident | idle_evict | manual`). Ein urspruenglich
  mitgeplantes freies `taxonomy_role`-Feld wurde verworfen, da das bestehende, zertifizierungsgated
  `ModelFleetRole`-Enum (inkl. `enabled=false` fuer reine manuelle Kennzeichnung ohne Zertifikatszwang)
  dieselben Konzepte bereits abdeckt. Neue editierbare `Rollenzuordnung`-Sektion im Model-Lab-Tab
  (separat von der bestehenden read-only `Roles & Routing`-Sektion): pro Bundle Rolle/Settings-Feld/
  Residency zuweisen, Konfliktanzeige bei doppelt vergebenem Settings-Feld, sowie ein Best-effort
  "Start"-Knopf pro Zeile (funktioniert erst zuverlaessig, sobald die separate Model-Lab-Runtime-Bridge
  aus Phase 2 aktiv ist; bis dahin zeigt er einen erklaerenden Fehler statt eines stillen Fehlschlags).
- Plan 15, Phase 0/1/2 nachgezogen: Scanner-Adapter/Lora-Reihenfolge-Fix inkl. korrigiertem
  `_infer_artifact_type()`-JSON-Fall (`tokenizer`-benannte `.json`-Dateien zaehlen jetzt als `config`, echte
  `.model`-Tokenizer-Dateien bleiben `tokenizer`); die verwaiste, GET-mit-Seiteneffekt-Quellauto-Registrierung
  aus `service.py::list_source_candidates()` wurde entfernt (verletzte REST-Semantik und brach einen
  bestehenden Test); die tote, nirgends registrierte `backend/app/api/model_lab_roles.py` wurde geloescht
  (echte, verdrahtete Endpunkte bleiben in `api/model_lab.py`). Phase 2 (Model-Lab-Runtime-Bridge) echt
  implementiert: neues Settings-Feld `enableModelLabRuntimeBridge` (Default `false`, `user_tunable`,
  `restartRequirement: "runtime_restart"`) gate zusaetzlich zum bestehenden `model_lab_repository`-Opt-in
  aus Plan 14; `ModelIndexService` bekommt einen optionalen `settings_service`-Parameter, `_from_filesystem()`
  deckelt Model-Lab-Extra-Roots auf 500 Dateien/Root und ein 5s-Wall-Clock-Budget ueber die gesamte
  Extra-Roots-Runde. Kein Produktions-Call-Site uebergibt aktuell `model_lab_repository` — die Bridge bleibt
  in der echten App inaktiv, bis ein spaeterer Schritt sie an einen geteilten `ModelLabRepository` verdrahtet.

**Frisch verifiziert:**
- `backend\.venv\Scripts\python.exe -m pytest -k "model_lab or model_index" -q` -> 85/85 gruen (keine bekannten Fehlschlaege mehr offen)
- `backend\.venv\Scripts\python.exe -m pytest -q` (voller Backend-Lauf) -> 553/553 gruen
- `npx vitest run` in `apps/desktop` -> 1366/1366 gruen (42 bewusst uebersprungen)
- `npx tsc --noEmit` in `packages/shared` und `apps/desktop` -> beide gruen

**Noch offen fuer die naechsten Gates:**
- echter Scan von `D:\Models\Agentic`, Katalog-Rescan und produktive Modellreihenfolge aus Plan 15 abarbeiten
- RuntimeAdapter-Live-Probe fuer `llama.cpp` implementieren, danach GPU-Autotuning und Benchmarks
- Fleet Console UI ausbauen: Compatibility, Tuning Lab, Benchmarks, Certification, Roles & Routing, Failures
- `modelSelectionBroker` an die neue Fleet-Routing-Map anbinden; aktuell ist die Map die stabile
  Model-Lab-Schnittstelle, der Live-Broker nutzt weiterhin seine bestehende lokale Routing-Logik
- Plan-14-Folgen im selben Themengebiet weiterfuehren: haengende Backend-Tests diagnostizieren,
  `embeddingService.ts`/Model-Lab-ID-Raum endgueltig versoehnen und die zwei haengenden Testfaelle separat
  root-causen
- Model-Lab-Runtime-Bridge (Phase 2) an einen echten Produktions-Call-Site verdrahten: aktuell uebergibt
  kein `ModelIndexService(...)`-Aufruf im Backend `model_lab_repository`/`settings_service`, die Bridge ist
  also nur ueber direkte Konstruktion (Tests) erreichbar. Braucht eine geteilte `ModelLabRepository`-Dependency
  statt Pro-Aufrufstelle-Instanzierung (siehe Phase-3-Plan-Notiz zu `Grep "ModelIndexService(" backend/app`).

## Plan 14, Phase 2 Fortsetzung: `/embeddings` + `/rerank` (echten Produktionsbug behoben + Reranking) (2026-08-01)

Auftrag war "Reranking-Faehigkeit hinzufuegen". Die Recherche dafuer deckte einen wichtigeren, bereits
realen Missstand auf: `apps/desktop/src/services/embeddingService.ts` — eine AELTERE, vom ONNX-Adapter
(Phase 2 oben) komplett unabhaengige Implementierung — wird bereits **aktiv im Produktions-Chat-Flow**
aufgerufen (`runtimeChatStore.ts`, hinter `hybridRetrievalEnabled`, Default `true`). Sie ruft
`POST {backendUrl}/embeddings` (OpenAI-Vertrag) und ist fuer `POST {backendUrl}/rerank` (Cohere-Vertrag)
vorbereitet — **beide Endpunkte existierten im Backend nicht**. Jeder RAG-Chat mit fehlenden Embeddings hat
seit jeher lautlos auf rein lexikalisches Retrieval degradiert statt zu crashen (`rag/service.py` bleibt laut
eigenem Kommentar "ohne Embedding-Modell vollstaendig funktionsfaehig"). Nutzerentscheidung: beides zusammen
loesen, da strukturell dasselbe Problem und beide vom bestehenden ONNX-Adapter bedienbar.

**Umgesetzt:**
- `backend/app/rag/onnx_shared.py` (neu): `build_input_feed`/`as_int_array` aus `onnx_embedding_client.py`
  extrahiert, plus `resolve_onnx_bundle_paths(repository, bundle_id)` — von beiden Clients/Services genutzt.
- `backend/app/rag/onnx_reranker_client.py` (neu): `OnnxRerankerClient`, Cross-Encoder-Muster
  (Query+Dokument als EIN Sequenzpaar tokenisiert, Logit->Score via Sigmoid bei 1 Label / Softmax-Index-1 bei
  2 Labels), gleiches Injektions-Testmuster wie der Embedding-Client.
- `backend/app/rag/reranker_service.py` (neu): loest `AppSettings.defaultRerankerModelId` (neues Feld) ueber
  Model Lab auf, strukturelles Analog zu `EmbeddingService`.
- `POST /embeddings` (OpenAI-kompatibel) und `POST /rerank` (Cohere-kompatibel) in `rag/router.py` — beide
  ignorieren das vom Client gesendete `model`-Feld bewusst und nutzen immer das settings-konfigurierte
  Standardmodell (Response gibt das TATSAECHLICH genutzte Modell zurueck). Grund: `embeddingService.ts`
  waehlt Modelle ueber den Runtime-Modellindex (Dateiname-Filter) — ein anderer ID-Raum als Model Labs
  Bundle-IDs. Reconciliation aller drei ID-Schemata war nicht Teil dieses Schritts.
- Frontend: `defaultRerankerModelId`-Setting (neuer `model_lab_select`-Eintrag). `modelLabOptions`
  (einzelne Liste) auf `modelLabOptionsByKey: Partial<Record<keyof AppSettings, Options[]>>` generalisiert
  (`SettingField` -> `RegistrySettingsTab` -> `SettingsNotebook`), da jetzt zwei `model_lab_select`-Felder mit
  unterschiedlichen Optionslisten existieren (Embedding- vs. Reranking-Bundles, gefiltert nach
  `capabilities.includes("embedding"|"reranking")`).

Verifikation: voller Backend-Testlauf 514/514 (+18 neue; zwei bereits vor diesem Schritt bestehende,
themenfremde Tests — `test_model_profiles.py::test_profile_validation`,
`test_residency_cache.py::test_sweep_idle_slots_evicts_utility_but_not_keep_resident` — haengen in dieser
Sandbox unabhaengig von diesem Schritt bereits einzeln auf; bewusst deselektiert, nicht mein Regressionsschaden,
siehe TODO unten). Voller Desktop-Vitest-Lauf 1361/1361, beide Typechecks clean.

**Noch offen:** die zwei oben genannten haengenden Tests sind noch nicht diagnostiziert/gemeldet — sollten in
einer eigenen, fokussierten Session untersucht werden (unklar ob Sandbox-spezifisch oder echter Bug).
**Neu erledigt im Plan-15-Integrationsbranch:** `POST /rag/retrieve` berechnet optional serverseitig
`query_embedding`, wenn `defaultEmbeddingModelId` gesetzt ist; fehlt Konfiguration/ONNX-Unterstuetzung,
bleibt lexikalisches Retrieval ohne 400-Failure aktiv. Frontend-seitige Modell-Auswahl-Dropdowns in
`embeddingService.ts` bleiben kosmetisch wirkungslos
(bestehendes, nicht neu eingefuehrtes Problem — Server ignoriert das `model`-Feld).

## Plan 14, Phase 2: ONNX-Runtime-Adapter fuer Embeddings umgesetzt (2026-08-01)

Erster Runtime-Adapter neben llama-server/Ollama (Nutzerentscheidung, obwohl in Phase 0 als "spekulativ,
ohne konkreten Bedarf" zurueckgestellt). ONNX Runtime gewaehlt: reines pip-Paket, kein CUDA/natives Toolchain
noetig, CPU-only auf jedem Windows-Rechner lauffaehig.

**Wichtiger Befund vor der Umsetzung:** `backend/app/rag/` (Hybrid-Retrieval) hat bereits vollstaendige
Embedding-Infrastruktur (Cache-Tabelle, Upsert/Missing-Endpunkte, Cosine-Scoring in `retrieve()`) — aber
nichts berechnet je einen Vektor (`rag/service.py:8`: "bleibt ohne Embedding-Modell vollstaendig
funktionsfaehig"). Der neue Adapter fuellt genau diese Luecke, statt ein neues, unverbundenes Feature zu
bauen.

**Umgesetzt:**
- `backend/app/rag/onnx_embedding_client.py` (neu): in-process ONNX-Client (Tokenisieren -> Session-Run ->
  Mean-Pooling -> L2-Normalisierung). Bewusst NICHT wie `chat_clients.py`s `LlamaServerChatClient`/
  `OllamaChatClient` (HTTP-Endpoint/Chat-Message-foermig) — Embeddings laufen in-process, Text rein, Vektor
  raus. `onnxruntime`/`tokenizers` optional importiert (Muster wie `hf_integration.py`s `HfApi`-Guard),
  Session/Tokenizer injizierbar fuer Tests ohne echte Modelldatei.
- `backend/app/rag/embedding_service.py` (neu): loest `AppSettings.defaultEmbeddingModelId` (neues Feld)
  ueber `ModelLabRepository.get_model()` auf ein Bundle mit `.onnx`- und Tokenizer-Artefakt auf, cached den
  Client pro Bundle.
- `POST /rag/embeddings/generate` (`rag/router.py`) — einziger neuer HTTP-Endpunkt, bestehende
  `upsert`/`missing`/`retrieve`-Endpunkte unveraendert.
- Settings-Feld `defaultEmbeddingModelId` ist ein Text-Feld, kein `model_select`-Dropdown: dieser Control-Typ
  ist an den Runtime-Modellindex gebunden (`SettingsNotebook.tsx`s `modelOptions`), nicht an Model Labs
  Bundle-IDs — ein echter Model-Lab-Picker ist ein sinnvoller, aber bewusst nicht in diesem Schritt gebauter
  Folgeschritt.
- Nebenbei behoben: `huggingfaceApiKey` existierte seit einem frueheren Schritt dieser Session im
  Backend-Settings-Modell, war aber nie in den gemeinsamen TS-`AppSettings`-Typ gespiegelt worden.

Verifikation: voller Backend-Testlauf 501/501 (+11 neue), voller Desktop-Vitest-Lauf 1351/1351, beide
Typechecks clean.

**Noch offen:** Model-Lab-sourcierter Auswahl-Dropdown fuer das Embedding-Modell (statt Text-Feld). Reranking
(Query+Passage -> Score, anderes Schema als Embedding) als naechste Engine-Faehigkeit. RAGs `retrieve()`
automatisch `query_embedding` berechnen lassen, wenn ein Modell konfiguriert ist (aktuell generiert der
Aufrufer die Vektoren selbst und speichert sie ueber die bestehenden Endpunkte).

## Plan 14, Model-Handling-Revision, Phase 0 umgesetzt (2026-08-01)

Basis: `Pläne/14 DBZS_CODEE_MODEL_HANDLING_REVISION.md`. **Wichtigster Befund vor der Umsetzung:** das
Dokument ist gegen `dbzs-codee-project-main` geschrieben — den verschachtelten, versehentlich eingecheckten
Repo-Snapshot, der in dieser Session als Ballast entfernt wurde (PR #28). Verifikation (3 parallele
Explore-Agents + eigene Dateipruefung) bestaetigte: die meisten konkreten Fehlerbehauptungen sind gegen den
aktuellen Code falsch oder bereits erledigt (`_from_filesystem()` existiert, `build_index()` merged bereits
mit Ollama, kein UI-5-Zeilen-Limit, `--threads`-Bug existiert nicht, Tests: 70/70 statt "7 failed"). Genuine,
verifizierte Luecken: keine echte GGUF-Header-Metadaten-Extraktion, `gpu_layers=None` faellt still auf
CPU-only zurueck ohne Kennzeichnung, `isRunnableModel()` filtert ohne sichtbaren Grund, Model Lab und der
Runtime-Launcher sind komplett getrennte Systeme.

**Phase 0.1 - echter GGUF-Metadaten-Parser:** `backend/app/core/gguf_metadata.py` (neu) liest den binaeren
GGUF-KV-Metadatenblock (Magic/Version/KV-Paare, STRING-Arrays wie die Tokenizer-Vokabular-Liste werden per
Seek uebersprungen statt materialisiert) und extrahiert `general.architecture`/`general.file_type` (echte
Quantisierung)/`<arch>.context_length`. Eingebunden in `model_lab/analyzer.py` (pro Bundle) und
`models/index_service.py` (pro Artefakt) — Dateinamen-Heuristik bleibt Fallback bei Parse-Fehlern.
`MODEL_INDEX_CACHE_METADATA_VERSION` auf 2 erhoeht, damit bestehende gecachte Eintraege die echten Daten beim
naechsten Scan bekommen.

**Phase 0.2 - Model Lab <-> Runtime-Bruecke:** `backend/app/models/model_lab_bridge.py` (neu) verbindet Model
Labs bereits vorhandene Multi-Source-Registry und Health-Klassifikation additiv mit dem Runtime-Index
(zusaetzliche Scan-Wurzeln + Health-/Tag-Overlay per Pfad-Abgleich auf `IndexedModel`). **Wichtiger Fund
waehrend der Umsetzung:** ein Testlauf hing >15 Minuten, weil die Bruecke ungebremst `ModelLabRepository()`
gegen den echten Produktions-DB-Pfad aufrief und ein real registriertes, potenziell grosses Verzeichnis
rekursiv scannte — mitten im Unit-Test. Das ist kein reines Testproblem, sondern ein echtes
Performance-/Stabilitaetsrisiko fuer jeden `build_index()`-Aufruf im echten Betrieb. Fix: die Bruecke ist
jetzt **opt-in** (`ModelIndexService(model_lab_repository=...)`, Default `None` = komplett inaktiv) und
bewusst noch **nicht** in die elf echten `ModelIndexService(...)`-Konstruktionsstellen
(`api/models.py`, `api/runtime.py`, `index_startup.py`, `profile_service.py`, `runtime/doctor.py`,
`runtime/resident_model_startup.py`, `runtime/service.py`) verdrahtet — das braucht erst eine sichere
Aktivierungsstrategie (Hintergrund-Scan, Zeit-/Dateianzahl-Limit oder expliziter Settings-Schalter), bevor es
im echten App-Betrieb automatisch laeuft. Modul und Tests sind fertig und funktionieren isoliert.

**Phase 0.3 - UI-Transparenz + Tuning:**
- `apps/desktop/src/utils/modelUtils.ts`: `describeExclusionReason()` ersetzt den statischen
  "Modell nicht startbar"-Tooltip in `RuntimeModelsTab.rows.tsx` durch einen konkreten Grund
  (Kompatibilitaetsstatus-basiert).
- `isUnprofiled()` erkennt Modelle ohne `gpu_layers` (bisher stiller CPU-only-Fallback,
  `runtime/launch.py:329`); UI zeigt eine "Ungetestet (GPU)"-Badge plus "Jetzt tunen"-Button, der den
  bereits existierenden echten Probe-Pfad (`probeRuntimeModel`, startet das Modell testweise wirklich) nutzt
  — kein neuer Tuning-Algorithmus.
- Tuning-Profil-Auswahl an den echten Start-Pfad angebunden: stellte sich heraus, dass der urspruenglich
  als Ziel genannte `ProfileService` NUR vom (ungenutzten) Multi-Server-Pfad angesteuert wird — der
  tatsaechlich genutzte Single-Model-Pfad hat sein EIGENES, echtes, hardware-bewusstes Profil-System
  (`resource_planner.py`s `fast`/`balanced`/`large_context`/`hybrid`/`cpu_safe`, bereits ueber
  `StartModelRequest.profile` erreichbar, nur nie vom Frontend genutzt). `startModel`/`startRuntimeModel`
  bekommen additiv ein optionales `profile`-Argument, durchgereicht bis zum bestehenden Backend-Feld — keine
  Backend-Signaturaenderung noetig. Neues `<select>` in `RuntimeModelsTab.rows.tsx` fuer ungetestete Modelle.

Verifikation: voller Backend-Testlauf 482/482 (vorher 460, +22 neue), voller Desktop-Vitest-Lauf 1346/1346
(vorher 1324, +22 neue), beide Typechecks (`tsconfig.node.json`/`tsconfig.web.json`) clean.

**Noch offen aus dem Dokument (bewusst nicht Teil dieses Schritts):** Adapter fuer weitere Runtimes
(vLLM/ONNX/TensorRT/Diffusers/Whisper) — die App nutzt aktuell nur llama-server/Ollama, spekulativer
Vorabaufwand ohne konkreten Bedarf. Volle GPU-Tuning-Automatik (binaere Suche ueber Batch/UBatch/KV-Cache/
Flash-Attention). Reale VRAM-/RAM-Telemetrie im Benchmark. Zertifizierung/dynamisches Routing (Phase 6).
Siehe `Pläne/14 DBZS_CODEE_MODEL_HANDLING_REVISION.md`, Abschnitt 12, fuer die volle Roadmap.

## Plan 12, Etappe 2, Punkte 4-7: model_lab-Testabdeckung, Sicherheits-/Konventions-Abgleich (2026-08-01)

Basis: `Pläne/12 DBZS_CODEE_V4_VERBESSERUNGSPLAN_2026-07-31.md`, Etappe 2. Vorher musste erst der lange
uncommittete `backend/app/model_lab/`-Stand committet werden (separater Commit/PR #26) - siehe unten.

**Punkt 4 (Testabdeckung erhoeht) - umgesetzt:** `backend/tests/test_model_lab_repository.py` (neu, 7 Tests)
prueft die Repository-Schicht direkt (ohne echtes Datei-Scanning, dadurch <1s statt ~250s): Re-Scan
aktualisiert bestehende Bundles/Artefakte in-place statt sie zu duplizieren (ON-CONFLICT-Upsert-Verhalten),
`mark_source_failed` setzt Status/Fehler korrekt, `update_model_metadata`/`add_to_collection` lehnen unbekannte
IDs mit `ValueError` ab, `create_collection` mit doppeltem Namen aktualisiert die bestehende Zeile statt eine
zweite anzulegen, `remove_from_collection` entfernt die Mitgliedschaft tatsaechlich, `find_duplicates` liefert
bei eindeutigen Modellen eine leere Liste.

**Punkt 5+6 (Sicherheitsregeln / Konventions-Abgleich) - umgesetzt, aber bewusst anders als im Original-Entwurf
formuliert:** Der Entwurf verlangt "API-Tokens nur im Windows Credential Manager" - **so ein Mechanismus
existiert nirgendwo im Backend**, waere komplett neue Infrastruktur. Stattdessen: `hf_integration.py`s
HuggingFace-Token folgt jetzt demselben, bereits etablierten Muster wie `openaiApiKey`/`anthropicApiKey`
(`runtime/cloud_client.py`): neues `AppSettings.huggingfaceApiKey`-Feld, in `SettingsService.SECRET_KEYS`
aufgenommen (also in `/settings/diagnostics` redigiert wie die anderen Cloud-Keys), Aufloesung via
`_resolve_hf_token()` in `hf_integration.py`: Settings zuerst, `HF_TOKEN`-Env-Var als Fallback - genau die
Prioritaet, die `cloud_client.py` fuer OpenAI/Anthropic bereits nutzt. Das erfuellt Punkt 6 (Konventions-
Abgleich) direkt und adressiert den Kern von Punkt 5 (Token nicht mehr nur als nackte, unredigierte
Env-Variable) ohne eine Parallel-Infrastruktur zu bauen, die sonst niemand im Projekt verwendet.
Die zweite Entwurfsregel ("externe Metadaten nie ungeprueft uebernehmen") ist fuer den aktuellen Umfang
(Suche/Anzeige only) bereits erfuellt - `hf_integration.py` gibt nur typisierte Pydantic-Modelle zurueck, keine
Stelle nutzt Suchergebnisse als Pfad-/Shell-Parameter. Bei Phase 2+ ("Download & direkt laden") erneut pruefen.

**Punkt 7 (Migrations-Frameworks konsolidieren) - NICHT umgesetzt, bewusst zurueckgestellt:** `repository.py`s
`_init_db()` ist bestaetigt ein drittes, Ad-hoc-Migrationsmuster (eigener `SCHEMA_VERSION`-Zaehler + manueller
`_ensure_column()`-Helfer fuer ALTER TABLE), unabhaengig von `app/core/migrations.py`s `MigrationManager` und
`app/settings/migrations.py`s Dict-Ansatz - der von Plan 12 befuerchtete Fall ist eingetreten. Eine Umstellung
auf `MigrationManager` waere aber ein invasiver Umbau der Schema-Init-Logik in einer aktiven, gerade erst
stabilisierten ~800-Zeilen-Datei - das verdient einen eigenen, dedizierten Durchlauf mit voller Testabdeckung
vorher/nachher, nicht einen Seitenschritt hier. Empfehlung fuer die naechste Session: erst `repository.py`
weiter stabil laufen lassen, dann gezielt migrieren.

Verifikation: `pytest tests/test_model_lab.py tests/test_model_lab_repository.py` (13/13), voller Backend-Lauf
`pytest` (467/467, vorher 460 + 7 neue).

## Plan 12, Etappe 4, Punkt 17: Pläne/-Nummern-Kollisionschecker (2026-08-01)

`scripts/check-plaene-numbering.mjs` (`pnpm docs:check-plaene-numbering` bzw.
`node scripts/check-plaene-numbering.mjs [--strict]`), analog zu `check-docs-drift.mjs`: liest alle
Dateinamen in `Pläne/` mit fuehrendem zweistelligem Nummern-Praefix (auch mehrstellig wie `"03 04 05"`) und
meldet, wenn dieselbe Nummer von mehr als einer Datei beansprucht wird. Nicht-blockierend per Default (Exit 0
trotz Kollisionen), `--strict` fuer harten Exit 1.

Reiner Checker, kein Auto-Renumberer: welche von zwei kollidierenden, laengst abgeschlossenen Plaenen eine
neue Nummer bekommen sollte, ist eine Entscheidung, keine Ableitung — daher wurden die beim ersten Lauf
gefundenen historischen Kollisionen (`02`, `03`/`04`/`05`, `07`, jeweils doppelt beansprucht, alle aus
laengst abgeschlossenen paralellen Plan-Phasen) bewusst NICHT automatisch bereinigt, nur der Checker selbst
geliefert.

## Plan 12, Etappe 2, Punkt 9: Dependency-Audit nachgeholt + `pnpm` in der Sandbox doch nutzbar (2026-08-01)

`pnpm audit` (workspace-weit, `pnpm-lock.yaml`/`pnpm-workspace.yaml`) ergab: **keine bekannten
Schwachstellen**. Wichtiger Nebenbefund: `pnpm` ist zwar weiterhin nicht global installiert, aber
`npx --yes pnpm@11.7.0 <befehl>` (die in `package.json`s `packageManager`-Feld gepinnte Version) laedt und
fuehrt echtes `pnpm` on-demand aus, ohne Installation. Das relativiert die bisherige, in mehreren frueheren
Sessions dokumentierte Einschraenkung "pnpm/uv nicht installiert, `pnpm`-Befehle muessen durch ihre direkten
Aequivalente ersetzt werden" — zumindest fuer `pnpm` gilt das nicht mehr uneingeschraenkt. Insbesondere der
BLOCKED-Status von SV-02 im Abnahme-Run `docs/audits/runs/2026-07-31_21-43/` (die zusammengesetzte
`pnpm ci:local:win`-Pruefung war blockiert, weil `pnpm` fehlte, obwohl alle Einzelschritte direkt liefen)
sollte in einem kuenftigen Abnahme-Lauf mit `npx --yes pnpm@11.7.0 ci:local:win` erneut versucht werden. `uv`
wurde nicht erneut getestet, die urspruengliche Einschraenkung dafuer bleibt bis auf Weiteres bestehen.

## Plan 12, Etappe 1: Session-Koordination umgesetzt, Branch Protection braucht manuellen Schritt (2026-08-01)

Basis: `Pläne/12 DBZS_CODEE_V4_VERBESSERUNGSPLAN_2026-07-31.md`, Etappe 1, Punkte 2+3.

**Session-Koordinationsmechanismus (Punkt 3) - umgesetzt:** `scripts/session-touch.mjs` (neu, `pnpm session:touch
"<Aufgabe>"` bzw. `node scripts/session-touch.mjs "<Aufgabe>"`) schreibt/prueft `.codee/session-registry.json`
(gitignored — live lokaler Zustand, kein Projektverlauf, siehe `.gitignore`-Kommentar). Meldet, falls eine
andere Session in den letzten 6h aktiv war, insbesondere auf einem anderen Branch. Manuell aufzurufen (kein
automatischer Hook) — am Sessionstart und vor riskanten Git-Operationen (`checkout`/`reset`/Force-Push), um
die in dieser Session mehrfach aufgetretenen Parallel-Session-Kollisionen frueher sichtbar zu machen.

**Branch Protection fuer `main` (Punkt 2) - NICHT ausgefuehrt, braucht den Nutzer:** Der Versuch, die in einer
frueheren Session dokumentierte `gh api ... branches/main/protection`-PUT-Anfrage auszufuehren, wurde vom
Claude-Code-Auto-Mode-Classifier blockiert (Aenderungen an GitHub-Repo-Einstellungen zaehlen als
Berechtigung, die der Nutzer selbst erteilen/ausfuehren muss). Zusaetzlich wurde beim Versuch festgestellt,
dass der in `HANDOVER.md` dokumentierte Befehl so nicht mehr passt: er verlangt zwei benannte
Status-Checks (`Required gates (ubuntu-latest)`/`(windows-latest)`), aber `gh run list --workflow=ci.yml`
zeigt **null** bisherige Laeufe dieses Workflows — die Checks haben noch nie einen Status gemeldet. Mit
`enforce_admins=true` und diesen Required-Checks waere **main sofort fuer jeden Merge blockiert**, auch fuer
den Repo-Owner. Empfohlener, angepasster Befehl (ohne Required-Status-Checks, bis CI/Billing-Sperre
(Etappe 3, Punkt 16) geloest ist):

```bash
gh api -X PUT repos/devdbzemusic/dbzs-codee-v4/branches/main/protection --input - <<'EOF'
{
  "required_status_checks": null,
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null
}
EOF
```

Muss der Nutzer selbst ausfuehren (Terminal mit `gh`-Login) oder Claude Code explizit die Berechtigung dafuer
erteilen. Sobald CI wieder laeuft, die beiden `required_status_checks.checks[]`-Eintraege aus dem
urspruenglichen, weiter oben nicht mehr vorhandenen Befehl wieder ergaenzen.

## Model Lab: Electron statt WinUI entschieden, Phase 1 umgesetzt (2026-07-31)

**Entscheidung (verbindlich):** Das Model Operations Center (`Pläne/11 DBZS_CODEE_MODEL_OPERATIONS_CENTER_IMPLEMENTIERUNGSPLAN.md`)
wird als Erweiterung der bestehenden Electron/React-App gebaut, nicht als WinUI3-App. `apps/model-ops-winui/`
bleibt bewusst unangetastet (nicht geloescht, nicht weiterentwickelt) — beide Oberflaechen sprechen gegen
dasselbe FastAPI-Backend (`/model-lab/*`, Port 8876 per Default), sodass kein Datenverlust entsteht, falls
die WinUI-App spaeter doch noch gebraucht wird. Neue Model-Lab-Arbeit findet ab sofort ausschliesslich im
Electron-Frontend statt.

**Wichtiger Befund:** Das Backend-Modul `backend/app/model_lab/` (`models.py`, `repository.py`, `scanner.py`,
`service.py`, `analyzer.py`, `hf_integration.py`) und der Router `backend/app/api/model_lab.py` existierten
bereits vollstaendig und getestet (aus einer parallelen Session, urspruenglich fuer die WinUI-App gebaut) —
Plan 11s Annahme eines komplett neu zu bauenden Backends (`registry.py`/`identity.py`) war durch die
Zwischenzeit ueberholt. Phase 1 wurde daher als reine Frontend-Erweiterung umgesetzt, die den real
existierenden Endpunkten folgt, nicht Plan 11s hypothetischem Schema.

**Umgesetzt (Phase 1 - Inventory MVP, Frontend):**
- `apps/desktop/electron/modelLabIpc.ts` (neu): registriert alle `/model-lab/*`-IPC-Handler
  (`sources`, `scan`, `jobs`, `models`, `models/{id}/metadata`, `collections`, `duplicates`, `hf/search`,
  `hf/repos/{id}`, `hardware`), analog zu `runtimeAndJobIpc.ts`. In `main.ts` per
  `registerModelLabIpcHandlers({ requestBackend })` eingehaengt.
- `packages/shared/src/index.ts`: TS-Typen fuer das gesamte Model-Lab-Schema (`ModelLabSource`,
  `ModelLabArtifact`, `ModelLabBundle`, `ModelLabModel`, `ModelLabScanJob`, `ModelLabHardwareProfile`, etc.),
  1:1 gespiegelt von `backend/app/model_lab/models.py`.
- `preload.ts` / `global.d.ts` / `backendClient.ts`: neue Bridge-Methoden fuer alle oben genannten Endpunkte,
  nach demselben optionalen Muster wie die uebrigen `BackendBridge`-Methoden.
- Neue Komponentenfamilie `apps/desktop/src/components/notebook/ModelLabTab.*`
  (`.controller.ts`, `.primitives.tsx`, `.rows.tsx`, `.sections.tsx`, `.tsx`), modularisiert nach dem Vorbild
  von `RuntimeModelsTab.*`. Umfang: Quellenverwaltung (Ordner hinzufuegen, pro Quelle scannen), Modell-
  Bibliothekstabelle (Status, Quantisierung, Groesse, Capabilities), einfaches Inspector-Detailpanel
  (Health, Capabilities, Artefaktliste).
- Neuer Notebook-Tab `model-lab` in `notebookStore.ts` / `OperationsNotebook.tsx` / `App.tsx`, neben (nicht
  anstelle von) dem bestehenden Runtime-Models-Tab.
- Tests: `ModelLabTab.controller.test.tsx` (Laden/Quelle-anlegen/Scan-Fehlerpfad/Auswahl),
  `ModelLabTab.primitives.test.ts` (formatBytes, Status-Ton-Zuordnung), `notebookStore.test.ts` angepasst
  auf die neue Tab-Reihenfolge.
- Nachgezogen (PR #19): Collections-Verwaltung (anlegen, Modelle im Inspector-Panel zuordnen/entfernen) und
  eine echte HuggingFace-Such-UI (`ModelLabCollectionsSection`, `ModelLabHuggingFaceSearchSection`) — beide
  nutzen ausschliesslich bereits verdrahtete Backend-Endpunkte, keine Backend-Aenderung noetig.

**Noch offen (nicht Teil dieses Schritts):** Model Inspector als vollwertiges Tab-Panel (Benchmarks/Quality/
Certification folgen erst Phase 2+), SSE-basierter Scan-Fortschritt (aktuell synchroner Scan-Request). Siehe
`Pläne/11 DBZS_CODEE_MODEL_OPERATIONS_CENTER_IMPLEMENTIERUNGSPLAN.md`, Abschnitt 3, fuer die weiteren Phasen.

## Abnahme-Test-Playbook umgesetzt (2026-07-31)

Basis: `Pläne/10 DBZS_CODEE_V4_ABNAHME_TEST_PLAYBOOK.md` (48 Test-IDs über `SERVICE_VERIFIED` →
`UI_VERIFIED` → `INSTALLER_VERIFIED` → `PERSONAL_STABLE`). Gebaute Infrastruktur plus ein echter, vollständig
ausgeführter `SERVICE_VERIFIED`-Lauf — kein reines Gerüst.

- **`pnpm acceptance:new-run`** (`scripts/new-acceptance-run.ps1`, neu): legt
  `docs/audits/runs/<timestamp>/` mit der im Playbook vorgegebenen Struktur an (`screenshots/`, `logs/`,
  `diffs/`, `test-output/`, `backups/`, `crash/`), schreibt `environment.txt`/`git-status.txt` automatisch
  und erzeugt `RUN_SUMMARY.md` mit allen 48 Test-IDs vorbefüllt (Status `NOT_RUN`) — ein Lauf muss nur noch
  ausgefüllt, nicht mehr strukturiert werden.
- **`node scripts/generate-verification-run-json.mjs`** (neu): liest genau dieselbe `RUN_SUMMARY.md`-
  Übersichtstabelle und schreibt eine maschinenlesbare `verification-run.json` daneben (Commit, Branch,
  Test-ID-Liste mit Status) — Abschnitt-14-Wunsch aus dem Playbook.
- **Diagnosepaket um Process-Supervisor-Telemetrie erweitert**: `diagnosticsZipExport.ts`s
  `buildFullDiagnosticsZip()` nimmt jetzt optional `slotHealthStates` entgegen (vom Renderer per
  `getAllSlotHealthStates()` ermittelt, da der Supervisor-Zustand nur dort im Speicher liegt) und legt sie als
  `slot-health.json` ins ZIP — `RuntimeSlotPanel.tsx` liefert sie beim Export automatisch mit.
- **Vorher-/Nachher-Hashes für Patch und Rollback**: `fileChangeService.ts`s `createDiff()`/`applyChange()`
  liefern jetzt `beforeHash`/`afterHash` (SHA-256), und `applyChange()` verifiziert nach dem Schreiben durch
  Zurücklesen, dass der Inhalt tatsächlich angekommen ist (wirft sonst). `restorePointService.ts`s
  `restorePoint()` macht dieselbe Rücklese-Verifikation je wiederhergestellter Datei und liefert
  `restoredFileHashes` — schließt die Beweisanforderung aus UI-19–UI-24 direkt im Code statt nur in der
  manuellen Prüfung.
- **`pnpm docs:check-drift`** (`scripts/check-docs-drift.mjs`, neu): vergleicht die `Stand:`-Zeilen und
  `origin/main`-Commit-Referenzen in README/TODO/HANDOVER/STATUS_TODAY und warnt bei Abweichung — bewusst
  kein Auto-Rewrite (würde die von Hand gepflegte Nuance in diesen Dateien zerstören), nicht-blockierend
  (`--strict` für einen harten Exitcode). Im ersten echten Lauf sofort einen berechtigten Fund geliefert:
  HANDOVER.md trägt in einem als "historischer Kontext" markierten Abschnitt bewusst einen alten
  `origin/main`-Commit — der Checker meldet das korrekt als Abweichung, ein Mensch muss weiterhin
  entscheiden, ob das echte Drift oder Absicht ist.
- **Echter `SERVICE_VERIFIED`-Lauf durchgeführt**: `docs/audits/runs/2026-07-31_21-43/` — SV-01, SV-03…SV-09
  PASS, SV-02 (der `pnpm ci:local:win`-Wrapper selbst) BLOCKED, weil `pnpm`/`uv` in dieser Sandbox gar nicht
  installiert sind (nur `node`/`npx` und das Backend-`.venv`) — alle darin enthaltenen Teilschritte wurden
  einzeln direkt ausgeführt und sind grün, inklusive eines echten PyInstaller-Backend-Builds (SV-08, ~18 MB
  `dbzs-backend.exe`, real auf der Festplatte erzeugt und verifiziert). Volle Details in
  `docs/audits/runs/2026-07-31_21-43/RUN_SUMMARY.md`.
- **Bewusst nicht in dieser Sandbox versucht:** alle UI-01…UI-28, IN-01…IN-07, PS-01…PS-04 (Kategorie C —
  braucht eine echte interaktive Session; diese Sandbox hat Hintergrundprozesse in dieser Session bereits
  zweimal mit unterschiedlichen Techniken nachweislich nicht am Leben erhalten können, kein dritter Versuch).
  `RUN_SUMMARY.md` bleibt für diese 39 Test-IDs auf `NOT_RUN` — direkt einsatzbereit für eine echte Session.

Geänderte/neue Dateien: `scripts/new-acceptance-run.ps1`, `scripts/generate-verification-run-json.mjs`,
`scripts/check-docs-drift.mjs` (alle neu, mit `package.json`-Aliassen `acceptance:new-run`/`docs:check-drift`),
`apps/desktop/electron/diagnosticsZipExport.ts` (+Test), `apps/desktop/electron/{main,preload}.ts`,
`apps/desktop/src/services/backendClient.ts`, `apps/desktop/src/types/global.d.ts`,
`apps/desktop/src/components/RuntimeSlotPanel.tsx`, `apps/desktop/electron/fileChangeService.ts` (+Test),
`apps/desktop/electron/patchPipelineService.ts`, `apps/desktop/electron/restorePointService.ts` (+Test),
`packages/shared/src/index.ts`, `docs/audits/GOLDEN_PATH_MANUAL_VERIFICATION_SCRIPT.md`, neuer
`docs/audits/runs/2026-07-31_21-43/` (echter SV-Lauf).

## Produktionsreife-Revision Phase 4 umgesetzt (2026-07-31) — Installer & Updatefähigkeit

Basis: `Pläne/09 DBZS_CODEE_V4_REPOSITORY_URTEIL_2026-07-31.md`, Umsetzungsplan Phase 4. Wie im Plan
angekündigt bewusst Grundgerüst-Charakter (aktuell kein echter Migrationsschritt noetig, kein echtes
Zertifikat vorhanden) — aber jeweils vollstaendig funktionsfaehig und getestet, kein totes Geruest.

- **Diagnose-ZIP-Export** (`apps/desktop/electron/diagnosticsZipExport.ts`, neu): buendelt `crash.log`,
  redigierte Settings und den Modellindex-Snapshot in ein ZIP. Bewusst **ohne neues npm-Package** — ein
  minimaler ZIP-Writer (STORE-Methode, unkomprimiert) ueber Node's eingebautes `zlib.crc32` reicht fuer eine
  Handvoll kleiner Diagnosedateien. Neuer IPC-Handler `dbzs:diagnostics:export-full-zip` plus Button
  "📦 Vollpaket exportieren" in `RuntimeSlotPanel.tsx`. **Bewusst nicht enthalten:** Trace-Events pro Lauf —
  die brauchen eine Run-ID-Auswahl, fuer die dieser globale Export keinen Kontext hat; das waere ein
  separater, Run-bezogener Export.
- **Repair-Mode-Grundgerüst**: `RestorePointService.rebuildIndexFromDisk()` (neu) behebt genau den in der
  Leck-Audit-Session gefundenen Bug — ein korruptes `index.json` machte bisher alle existierenden Restore
  Points unsichtbar, obwohl die einzelnen `<id>.json`-Punktdateien unangetastet blieben. Die neue Funktion
  baut den Index direkt aus den vorhandenen Punktdateien neu auf (defekte Dateien werden uebersprungen und
  gemeldet, nicht stillschweigend verworfen). Neuer IPC-Handler `dbzs:restore-points:repair-index` plus
  "🔧 Reparieren"-Button in `FileToolsPanel.tsx`.
- **Settings-Migrations-Framework** (`backend/app/settings/migrations.py`, neu): versionierter Runner statt
  des bisherigen Ad-hoc-Inline-Sonderfalls ("schemaVersion fehlt" in `service.py`). Migrationen werden nach
  Zielversion registriert (`MIGRATIONS: dict[int, MigrationFn]`) und der Reihe nach angewendet; eine Luecke
  in der Kette stoppt den Runner statt stillschweigend vorzuspringen. `SettingsService.load()` sichert
  `settings.json` **vor** einer echten Migration (`settings.json.pre-migration-v{X}-to-v{Y}.<timestamp>`) —
  nicht fuer den trivialen "Feld fehlt komplett"-Fall, nur wenn tatsaechlich Inhalte transformiert wurden.
  Aktuell `CURRENT_SCHEMA_VERSION == 1`, keine echte Migration registriert. **Bewusst nicht enthalten:** eine
  Modellindex-Migration — der Modellindex wird bei jedem Boot frisch aus dem Dateisystem aufgebaut
  (`ModelIndexService.build_index()`), nicht als versioniertes Dokument persistiert und vorwaerts migriert,
  daher passt dasselbe Framework dort nicht direkt.
- **Code-Signing-Grundgerüst**: `electron-builder.yml` bekommt erklaerende Kommentare bei `win:`/`mac:`, wo
  Signierung/Notarisierung ansetzen wuerde (`CSC_LINK`/`CSC_KEY_PASSWORD`-Env-Vars fuer beide Plattformen,
  zusaetzlich `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` fuer macOS-Notarisierung) —
  electron-builder erkennt diese automatisch, sobald sie gesetzt sind, ohne YAML-Aenderung. `signAndEditExecutable: false`
  bleibt bewusst unveraendert. **Checkliste, sobald ein echtes Zertifikat vorhanden ist:**
  1. Zertifikat als `.pfx` (Windows) / `.p12` (macOS) sicher ablegen (nicht im Repo).
  2. `CSC_LINK` (Pfad oder base64) und `CSC_KEY_PASSWORD` als Umgebungsvariablen im Build-Kontext setzen.
  3. Fuer macOS zusaetzlich `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` setzen.
  4. `signAndEditExecutable: true` in `electron-builder.yml` setzen (win-Sektion).
  5. Einen Test-Build fahren und die Signatur pruefen (`signtool verify` / `codesign --verify`).

Geänderte/neue Dateien: `apps/desktop/electron/diagnosticsZipExport.ts` (+Test), `apps/desktop/electron/main.ts`,
`apps/desktop/electron/preload.ts`, `apps/desktop/src/services/backendClient.ts`,
`apps/desktop/src/types/global.d.ts`, `apps/desktop/src/components/RuntimeSlotPanel.tsx`,
`apps/desktop/electron/restorePointService.ts` (+Test), `apps/desktop/src/stores/gitStore.ts`,
`apps/desktop/src/components/FileToolsPanel.tsx`, `backend/app/settings/migrations.py` (+Test),
`backend/app/settings/service.py` (+2 neue Tests in `test_settings.py`), `apps/desktop/electron-builder.yml`.

Frisch verifiziert in dieser Session (2026-07-31):

- `backend\.venv\Scripts\python.exe -m pytest backend\tests\test_settings.py backend\tests\test_settings_migrations.py -q`
  - 18 Tests gruen, 1 bekannte `StarletteDeprecationWarning`
- `.\node_modules\.bin\vitest.CMD run electron/diagnosticsZipExport.test.ts electron/restorePointService.test.ts`
  in `apps/desktop`
  - 2 Testdateien / 18 Tests gruen
- `.\node_modules\.bin\vitest.CMD run src/components/RuntimeSlotPanel.test.tsx` in `apps/desktop`
  - 1 Testdatei / 5 Tests gruen
- `.\node_modules\.bin\tsc.CMD --noEmit -p tsconfig.node.json` in `apps/desktop`
  - fehlerfrei
- `.\node_modules\.bin\tsc.CMD --noEmit -p tsconfig.web.json` in `apps/desktop`
  - fehlerfrei

Hinweis: globales `pnpm` war in dieser Shell nicht im PATH; Desktop-Checks wurden deshalb ueber die lokalen
`apps/desktop/node_modules/.bin`-Binaries ausgefuehrt.

## Produktionsreife-Revision Phase 3 vorbereitet (2026-07-31) — Release-Gates

Basis: `Pläne/09 DBZS_CODEE_V4_REPOSITORY_URTEIL_2026-07-31.md`, Umsetzungsplan Phase 3 ("Release-Gates").
Diese Phase ist **code-/dokuseitig vollständig vorbereitet**, aber bewusst nicht selbst ausgeführt — beide
Punkte sind eure Entscheidung (Kategorie B: externe Konto-/Repo-Einstellung, kein Code-Problem):

- **CI-Reaktivierung**: `.github/workflows/ci.yml` bleibt `workflow_dispatch`-only (GitHub-Billing-Sperre
  seit 2026-07-23, siehe Kommentar im File). Eine fertige, auskommentierte `on: push/pull_request`-Sektion
  liegt direkt über der aktiven `on:`-Zeile. **Reaktivierungs-Checkliste, sobald das Billing gelöst ist:**
  1. Auskommentierten Block einkommentieren, `workflow_dispatch:`-Zeile darunter entfernen (oder als
     zusätzlichen Trigger behalten, falls manuelles Auslösen weiter gewünscht ist).
  2. Einen Push machen und **bestätigen, dass tatsächlich ein Run startet** — eine Billing-Sperre kann
     Trigger stillschweigend ignorieren statt einen Fehler zu zeigen.
  3. Nach einem grünen Lauf: Required-Status-Checks (siehe unten) aktivieren.
- **Branch Protection für `main`**: aktuell keine aktiv. Dokumentierter, **nicht ausgeführter** Befehl für
  Required-Status-Checks (erst nach einem grünen CI-Lauf sinnvoll, sonst blockiert er jeden Merge):

  ```bash
  gh api -X PUT repos/devdbzemusic/dbzs-codee-v4/branches/main/protection \
    -f required_status_checks.strict=true \
    -f 'required_status_checks.checks[][context]=Required gates (ubuntu-latest)' \
    -f 'required_status_checks.checks[][context]=Required gates (windows-latest)' \
    -f enforce_admins=true \
    -f 'required_pull_request_reviews.required_approving_review_count=0' \
    -f restrictions=null
  ```

  Das ändert Push-Rechte auf `main` — bewusst nicht ohne expliziten Auftrag ausgeführt. Nach Aktivierung:
  direkte Pushes auf `main` sind nicht mehr möglich, nur noch über PR mit grünem CI-Lauf.

## Produktionsreife-Revision Phase 2 umgesetzt (2026-07-31)

Basis: `Pläne/09 DBZS_CODEE_V4_REPOSITORY_URTEIL_2026-07-31.md`, Umsetzungsplan Phase 2 ("Runtime-Härtung").
Voller Desktop-Vitest-Lauf (1281 Tests grün, 42 geskippt), voller Backend-Pytest-Lauf (446 grün), beide
Typechecks fehlerfrei.

- **Vision-GPU-Exklusivität** (`backend/app/runtime/gpu_exclusivity.py`, neu): `fast_gpu` und `vision_gpu`
  teilen sich eine GPU und dürfen nie gleichzeitig ein Modell resident halten. `RuntimeService.start_model()`
  ruft vor dem tatsächlichen Prozessstart `_enforce_gpu_exclusivity()` auf, die den jeweils anderen GPU-Slot
  sauber stoppt — mit begrenztem Warten auf laufende Requests (`wait_for_slot_drain`, Default 10s) statt
  Hard-Kill. CPU-Slots (`quality_cpu`, `orchestrator_cpu`, `utility`) sind unbetroffen.
- **Vision-Broker-Routing** (`modelSelectionBroker.ts`): ein Modell, das strikt einen Vision-Projector
  benötigt (`modelRequiresVisionProjector`), wird jetzt zwingend auf `vision_gpu` geroutet statt auf
  `quality_cpu`/`fast_gpu` (die den Projector nie laden). Ein Dual-Chat+Vision-Modell, das als normales
  Rollenmodell läuft, bleibt bewusst auf seinem Slot — nur echte Vision-only-Modelle werden umgeleitet.
  `defaultVisionModelId` wird jetzt tatsächlich für die vier Vision-Task-Typen
  (`image_analysis`/`ui_analysis`/`visual_debugging`/`document_vision`) konsultiert und ist damit kein
  `orphaned`-Setting mehr (`settingsRegistry.ts`: `user_tunable`/`model_select`). Die dafür nötige Verbreiterung
  des `contextSlotId`-Typs (3 → 4 Slot-IDs) wurde in allen 4 betroffenen Store-Dateien konsistent nachgezogen.
- **Prozess-Supervisor mit Health-Heartbeat + Restart-Budget** (`apps/desktop/src/services/runtimeProcessSupervisor.ts`,
  neu): periodischer Check (60s-Intervall, analog zum bestehenden Idle-Watcher in `lazyRuntimePolicy.ts`)
  erkennt einen Slot, der von "running" auf "error" gewechselt hat, und startet ihn mit dem zuletzt bekannten
  Modell neu — begrenzt auf 3 Versuche pro 5-Minuten-Fenster, danach manuelle Intervention nötig (keine
  Neustart-Stürme). Ein deliberater Stop (Idle-Eviction, manueller Stop → state "stopped") wird nie als Absturz
  interpretiert. `restartSlot()` in `runtimeSlotManager.ts` hat damit erstmals einen echten Aufrufer.
  Health-Zustand pro Slot ist in `RuntimeSlotPanel.tsx` sichtbar (Restart-Versuche, Budget erschöpft).

Geänderte Dateien: neue `backend/app/runtime/gpu_exclusivity.py` (+`tests/test_gpu_exclusivity.py`, +4 neue
Integrationstests in `test_runtime_service.py`), `apps/desktop/src/services/modelSelectionBroker.ts` (+Test),
neue `apps/desktop/src/services/runtimeProcessSupervisor.ts` (+Test), `apps/desktop/src/components/RuntimeSlotPanel.tsx`,
`apps/desktop/src/settings/settingsRegistry.ts` (+Test), `apps/desktop/src/stores/runtimeChatStore.ts`,
`apps/desktop/src/stores/runtimeChatStoreRoutingPhase.ts`, `apps/desktop/src/stores/runtimeChatStoreOnDemandPreparation.ts`,
`apps/desktop/src/stores/runtimeChatStoreOnDemandExecution.ts`.
**Noch offen:** manuelle Bestätigung in einer echten Session mit zwei geladenen Modellen (siehe
`docs/audits/GOLDEN_PATH_MANUAL_VERIFICATION_SCRIPT.md`, Abschnitt D.3) — GPU-Exklusivität und der Supervisor
wurden nur gegen Fakes verifiziert, nie gegen einen echten llama-server-Prozess.

## Produktionsreife-Revision Phase 1 umgesetzt (2026-07-31)

Basis: `Pläne/09 DBZS_CODEE_V4_REPOSITORY_URTEIL_2026-07-31.md`, Umsetzungsplan Phase 1 ("Stabilitäts-Sprint").
Voller Desktop-Vitest-Lauf (1267 Tests grün, 42 geskippt), voller Backend-Pytest-Lauf (437 grün), beide
Typechecks (`tsconfig.node.json`, `tsconfig.web.json`) fehlerfrei.

- **Rollenmodell-Fallback-Kette** (`modelSelectionBroker.ts`): der bisherige harte `role_model_missing`-Abbruch,
  wenn kein `default*ModelId` gesetzt ist, versucht jetzt zuerst ein passendes **laufendes** Modell (mit
  Slot-Umzug der Entscheidung) und danach das beste **installierte** Modell, bevor er endgueltig mit
  `role_model_missing_no_fallback` abbricht. Vision-Sicherheit bleibt an jeder Stufe ein harter Filter (kein
  Text-Turn faellt je auf ein Vision-only-Modell zurueck und umgekehrt). Neuer Export
  `hasConfiguredRoleModelForTask()` laesst `runtimeChatStoreRoutingPhase.ts` den Slot-Status nur dann abfragen,
  wenn er tatsaechlich gebraucht wird. Aus Vorsicht bewusst auf `quality_cpu`/`fast_gpu`/`utility` beschraenkt —
  `vision_gpu`/`orchestrator_cpu`-Fallback wuerde am `contextSlotId`-Clamp in `runtimeChatStoreRoutingPhase.ts`
  scheitern (der nur die drei erstgenannten Slot-IDs kennt); das faellt in die geplante
  Vision-Broker-Routing-Phase, die diesen Clamp ohnehin erweitern muss.
- **Crash-Correlation-ID**: `RuntimeChatRun.id` (dem Nutzer bereits als "Diagnose-ID" bekannt) laeuft jetzt als
  neues optionales Feld `run_id` durch `RuntimeChatRequest` bis ins Backend (`service.py` loggt `run_id` beim
  Eintritt in `chat()`/`chat_stream()` — Backend hatte bis dahin kein Logging-Setup) und wird im Electron-
  Main-Process per neuem `activeRunTracker.ts` (Set aktiver Run-IDs, mehrfenstertauglich) getrackt. Jede
  `crash.log`-Zeile (`flushPendingState()` in `main.ts`) enthaelt jetzt `activeRuns=<ids-oder-"none">`.
- **Sandbox-Prozessueberleben (Phase 0, erneuter Versuch)**: zwei technisch unterschiedliche Techniken
  getestet (Bash/PowerShell-Hintergrundprozess — bereits zweimal gescheitert; Windows Task Scheduler
  `schtasks` — neu). Ergebnis: `schtasks` scheiterte sogar **schneller** (~25-30s statt ~2-3min) und der
  gestartete Prozess zeigte trotzdem `claude.exe` als Elternprozess — spricht gegen klassisches
  Job-Object-Reaping und fuer eine sandbox-weite Prozessueberwachung unabhaengig von der tatsaechlichen
  Prozess-Elternschaft. Als endgueltig nicht loesbar in dieser Sandbox dokumentiert (Details:
  `docs/audits/GOLDEN_PATH_MANUAL_VERIFICATION_SCRIPT.md`, Abschnitt D) — die Kategorie-C-Punkte
  (Rollenmodell-Fallback, Crash-Correlation, GPU-Exklusivitaet) bleiben manuelle Verifikation.

Geaenderte Dateien: `apps/desktop/src/services/modelSelectionBroker.ts` (+Test), neue
`apps/desktop/electron/activeRunTracker.ts` (+Test), `apps/desktop/src/stores/runtimeChatStoreRoutingPhase.ts`
(+Test), `apps/desktop/electron/{main,runtimeAndJobIpc}.ts`, `apps/desktop/src/stores/runtimeChatStore.ts`,
`packages/shared/src/index.ts`, `backend/app/runtime/{schemas,service}.py` (+Test),
`docs/audits/GOLDEN_PATH_MANUAL_VERIFICATION_SCRIPT.md`.

## Chat-Folgeaktionen Phase 2 umgesetzt (2026-07-31)

Die vier in `TODO.md` offenen Phase-2-Punkte zu den Chat-Folgeaktionen (Basis:
`Pläne/06 DBZS_CODEE_CHAT_FOLLOW_UP_ACTIONS_DIAGNOSE_PLAN.md`, Phase 1 bereits per PR #5/Merge-Commit `210f0ff`
in `main`) sind umgesetzt und automatisiert getestet (voller Desktop-Vitest-Lauf: 1250 Tests gruen, 42 geskippt,
0 Failures; `packages/shared`- und `apps/desktop`-Typecheck fehlerfrei):

- **echtes Retry mit Run-Kontext**: `retry_run` sendet den woertlichen urspruenglichen Nutzerprompt (statt einer
  festen Platzhalterformulierung) und reicht `taskType`/`provider`/`agentMode`/`forceUseResidentModel` als
  `sendOptions` durch. Bewusst kein hartes Modell-/Slot-Pinning — dafuer fehlt in `RuntimeChatSendOptions` ein
  `forcedModelId`-Feld, das tiefer in `modelSelectionBroker.ts` eingreifen wuerde.
- **Modellwechsel-Angebot nach Fehlschlag**: neuer Action-Kind `switch_model`, erscheint zusaetzlich zu
  `retry_run` bei `run.resourceRisk` `"high"`/`"unsupported"` oder gesetztem `run.fallbackRejection`. Klick
  navigiert per `useNotebookStore.setActiveTab("runtime")` zum Model Control Center statt ein Modell zu erraten.
- **Fehlererkennung aus Freitext**: `hasErrors` prueft jetzt zusaetzlich zu `toolCalls[].status` den
  Antworttext auf starke Fehlerindikatoren (Stacktrace-Muster, `isGenericRuntimeErrorSentinel` aus
  `runtimeRunFinalization.ts`), bewusst ohne generisches `/fehler/i`-Matching gegen Fehlalarme.
- **persistierte Folgeaktionen**: bereits durch die bestehende `messages`-Synchronisierung in
  `runtimeChatSync.ts` (localStorage-Roundtrip inkl. `message.actions`) abgedeckt — kein zusaetzlicher Code
  noetig.

Geaenderte Dateien: `packages/shared/src/index.ts` (neuer `ChatActionKind` `switch_model`),
`apps/desktop/src/services/runtimeChatFollowUpActions.ts`, `apps/desktop/src/stores/runtimeChatStoreInteractionActions.ts`,
plus Tests (`runtimeChatFollowUpActions.test.ts`, `apps/desktop/src/testing/chatActions.test.ts`).
**Noch offen:** manuelle Bestaetigung in einer echten Desktop-Session (siehe `TODO.md`) — insbesondere die
`switch_model`-Navigation und der tatsaechliche Retry-Prompt-Inhalt wurden nur automatisiert, nicht interaktiv
getestet.

## Aktueller Arbeitsbranch

- aktiver Arbeitsbranch: `feature/runtime-chat-ux-overhaul` (lokaler Arbeitsstand dieser Session; die `main`-Zusammenfassung unten bleibt als historischer Kontext bestehen)
- Sicherheits-Backup-Branch: `codex/backup-runtime-chat-overhaul-2026-07-27`
- physischer Snapshot:
  `C:\Users\ralle\source\repos\_backups\dbzs-codee-project-backup-2026-07-27-runtime-chat-overhaul`

## Repo-Wahrheit

- aktiver GitHub-Remote: `https://github.com/devdbzemusic/dbzs-codee-v4.git`
- lokaler Ordnername bleibt aktuell `dbzs-codee-project`
- historischer Merge-Stand fuer [PR #6](https://github.com/devdbzemusic/dbzs-codee-v4/pull/6): `f909fd9`
- offene Pull Requests im Live-Repo: keine
- Branch Protection fuer `main`: aktuell nicht aktiv
- der Feature-Branch `feature/runtime-chat-ux-overhaul` ist nach dem PR-#6-Merge sauber (keine losen
  Aenderungen mehr); er wurde bewusst nicht geloescht, falls dort weitergearbeitet wird

## PR #6 gemergt (2026-07-29)

[PR #6](https://github.com/devdbzemusic/dbzs-codee-v4/pull/6) ("Vision slot foundation, workflow-audit fixes,
runtime-ui module split") wurde per Merge-Commit `f909fd9` in `main` gemergt — 4 Commits: Vision-Slot-Grundlage
Phase 1, Workflow-Audit-P0-Fixes, die zugehoerigen Doku-Updates sowie ein vorbestehender, unabhaengiger
`RuntimeModelsTab`-Refactor (Zeilenkomponenten in ein eigenes Modul ausgelagert) plus eine PDF-Verschiebung nach
`Pläne/`. Vor dem Merge war die PR `MERGEABLE`/`CLEAN`, keine automatischen CI-Checks (weiterhin
`workflow_dispatch`-only, siehe unten).

## PR #5 gemergt (2026-07-29)

[PR #5](https://github.com/devdbzemusic/dbzs-codee-v4/pull/5) ("Runtime Chat overhaul: attachments, model control center,
follow-up actions") wurde per Merge-Commit `210f0ff` in `main` gemergt — 42 Commits, Themen: generische
Runtime-Chat-Dateianhaenge, Model Control Center/MMProj-Pairing, sowie die generischen Post-Response-Folgeaktionen
im Chat (Phase 1, siehe `Pläne/06 DBZS_CODEE_CHAT_FOLLOW_UP_ACTIONS_DIAGNOSE_PLAN.md`). Vor dem Merge war die PR
`MERGEABLE`/`CLEAN` und es gab keine automatischen CI-Checks (weiterhin `workflow_dispatch`-only, siehe unten).

## PR #4 gemergt + Folgearbeit direkt auf `main`

[PR #4](https://github.com/devdbzemusic/dbzs-codee-v4/pull/4) (Runtime-Chat-Overhaul + Personal Production Stabilization) ist gemergt. Danach wurden die aus der Verifikation vom 2026-07-28 (`Pläne/DBZS_CODEE_PERSONAL_PRODUCTION_VERIFICATION_2026-07-28.md`) und aus diesem Handover offenen Restpunkte direkt auf `main` abgearbeitet (Commits `8f06ef8`, `dd31610`, `2d211cf`, `acca3bf`):

- **`atomicFileWrite.ts`-Typfehler behoben**: `AtomicWriteFs.mkdir` war gegen Nodes echte Recursive-Overload-Signatur zu eng typisiert. `npm run typecheck` ist seitdem erstmals vollstaendig fehlerfrei.
- **Vier lose Altaenderungen committet**: `skillRunPersistenceService.ts` (nutzt jetzt `writeFileAtomic`), `executionHandoff.ts`/`executionIntent.ts(.test)` (Intent-Klassifikation erkennt jetzt "Implementierungsplan"/"Umsetzungsplan"/"Fix-Plan"-Formulierungen als `plan_only`).
- **Vite-Importwarnungen aufgeloest**: zwei redundante dynamische Imports in `runtimeChatStoreRuntimeHelpers.ts` (`backendClient`, `providerRuntimeEvents`) waren bereits ueber Sibling-Stores statisch im selben Chunk — auf statische Imports umgestellt, `electron-vite build` ist jetzt warnungsfrei.
- **Repository-Review-Fehlerklassifikation**: neuer `RepositoryReviewOutcome`-Wert `"empty_plan"` ersetzt die generische `"failed"`-Klassifikation, wenn ein nicht-leeres Inventar auf null Batches faellt (z. B. `selectedPaths` matcht nichts oder keine Datei passt zum unterstuetzten Format-Filter). Grund wird jetzt in `review-state.json` persistiert (`ReviewStateFile.detail`) und im Chat ueber `currentBatchTitle` angezeigt. Neuer Regressionstest fuer den vorher ungetesteten Zweig.
- **Golden-Path-Verifikation konsolidiert**: siehe [docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md](C:/Users/ralle/source/repos/dbzs-codee-project/docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md) — wichtigster neuer Fund: **`env -u ELECTRON_RUN_AS_NODE` erlaubt einen echten Electron-GUI-Start in dieser Sandbox** (vorher als unmoeglich angenommen). `boot.spec.ts` und die UI-Chrome-Specs (`command-palette`, `job-monitor`, `mission-control`) laufen damit gruen; die vier Specs, die eine tatsaechlich verbundene lokale Modell-Runtime brauchen (`agent-capabilities`, `coding-assistant`, `context-integration`, `runtime-chat`), scheitern hier einheitlich mangels geladenem Modell — das ist Golden-Path-Kriterium 3 selbst, das die echte Maschine braucht.

### Personal Production Stabilization (PR #4) — zur Erinnerung

- **Runtime-Pfad**: Default-Bug in `backend/app/models/discovery_mode.py` behoben; `backend/app/runtime/doctor.py` prueft Ollama nicht mehr im Strict-Mode; G:/D:-Pfad-Fallbacks verifiziert; toter Ollama/Cloud-Code gekennzeichnet.
- **Review-/Index-Inventar**: gemeinsamer Exclude-Contract (`.cache`, `playwright-report`, `test-results`, `*.log`, `.env`) auf sieben Konsumenten migriert.
- **Diff/Snapshot/Rollback**: Freigabepflicht im `"full"`-Profil, `dbzs:fs:*`-IPC-Handler abgesichert, Crash-Flush-Hooks ergaenzt.
- **Automatisches Backup**: `backupService.ts` (Settings, Codee-DBs ohne `rag.sqlite3`, Workspace-`.codee` ohne Restore-Points, Modellprofile), Diagnostics-Tab-UI.
- **`.gitignore`-Bugfix**: `backend/app/models/` war versehentlich komplett ignoriert (8 Dateien nie versioniert), per Negation gefixt.

## Neu uebernommen: Konsolidierter MMProj-/Model-Control-Plan

Quelle: `Pläne/03 04 05 DBZS_CODEE_CONSOLIDATED_MODEL_CONTROL_MM_PAIRING_PLAN.md`
plus `Pläne/03 04 05 DBZS_CODEE_ADAPTED_MODEL_CONTROL_MM_PLAN_CURRENT_REPO.md`

Die Planbasis ist gelesen und fuer die naechste Umsetzungssession in eine klare Reihenfolge verdichtet. Kerngedanke:
`mmproj-*.gguf` ist **kein** startbares Modell, sondern ein Support-Artefakt, das erst zusammen mit einem kompatiblen
Basismodell und nach erfolgreicher Runtime-Probe als routbares multimodales Paar gelten darf. Der bestehende Integrationspunkt
`runtime={<RuntimeModelsTab />}` bleibt unveraendert; die Erweiterung ist additiv.

Stand im aktuellen Branch nach dem naechsten sicheren Slice:

- additive Vertragsfelder `multimodal_pairs` (Backend + Shared + Store) sind vorhanden
- erste Same-Folder-Heuristik erzeugt rein diagnostische Pair-Zustaende `candidate`, `ambiguous` und `missing_base`
- Kataloghinweise haben jetzt Vorrang: explizite Zuordnungen aus `models.catalog.json` koennen MMProj-Paare stabil als `source="catalog"` binden
- persistierbare manuelle Zuordnung ist vorhanden: `POST /models/multimodal-pairings/manual` schreibt `pairing.source = "manual"` in den Katalog und wird vom Index bevorzugt wieder eingelesen
- kontrollierte MMProj-Probe ist vorhanden: `probeRuntimeModel` akzeptiert `projector_artifact_id`, startet das Basismodell
  bei erfolgreichem Pairing mit `--mmproj`, persistiert erfolgreiche Proben als `routing_allowed = true` im Katalog
  und der `RuntimeModelsTab` aktualisiert den Index danach sofort auf `verified`
- die Probe haertet den Nachweis jetzt weiter: Basis-Endpoint und `/v1/models` muessen erfolgreich antworten, bevor
  ein Paar als verifiziert markiert wird; fehlende Endpoint-Nachweise blockieren die Freigabe weiterhin
- fuer MMProj-Paare gibt es jetzt zusaetzlich einen kleinen echten Bildtest ueber `/v1/chat/completions`; auch dieser
  muss erfolgreich sein, bevor `routingAllowed` gesetzt wird. Fehlerursachen aus dem Vision-Test werden als Probe-Evidenz
  bis in den `RuntimeModelsTab` durchgereicht
- `RuntimeModelsTab` zeigt fuer MMProj-/Hilfsartefakte jetzt explizite Statushinweise statt nur generischem `support_artifact`
- `RuntimeModelsTab` arbeitet jetzt als eigenes MM-Pairing-Control-Center: separate Paarliste, Risiko-Sortierung,
  Status-Summary, direkte Probe und manuelle Neu-Zuordnung; gekoppelte MMProj-Artefakte tauchen nicht mehr doppelt
  in den generischen Hilfsartefakten auf
- im aktuellen Branch ist der `RuntimeModelsTab` jetzt zusaetzlich als kompaktes Runtime-Model-Control-Dashboard verdichtet:
  Startmodelle werden nach Laufstatus und Routing-Nutzen priorisiert sortiert; fuer startbare Modelle, multimodale Paare
  und sichtbare Hilfsartefakte gibt es jetzt getrennte Rollen-, Routing-, Aktions- und Status-Summaries direkt ueber den
  Tabellen. Die Detailtabellen bleiben erhalten, sind aber schneller scanbar und auf direkte Steuerung ausgelegt
- `runtimeChatStoreRoutingPhase` reicht `multimodal_pairs` jetzt in den `modelSelectionBroker` durch; projector-pflichtige
  Visionmodelle werden ohne verifiziertes `routing_allowed = true` sauber blockiert statt blind gestartet
- fuer Screenshot-Coding/-Review mit Bildinput gilt jetzt zusaetzlich ein Capability-Gate:
  das gewaehlte Visionmodell muss im Modellindex explizit `code` tragen; vision-only/chat-only Visionmodelle werden
  fuer diese Pfade mit klarer Broker-Diagnose blockiert
- MMProj bleibt strikt nicht startbar; nur verifizierte Paare werden jetzt als `routingAllowed = true` sichtbar
- Nebenfund behoben: Dateinamen-Heuristiken bewerten jetzt den Dateinamen statt des ganzen Pfads, damit Ordnernamen wie `...mmproj...` keine Fehlklassifikation ausloesen

### Naechste Umsetzungsreihenfolge

- **1. Index-Haertung zuerst**: `index.models` nur fuer runnable Modelle; neue additive Sammlungen fuer
  `supportArtifacts` und spaeter `multimodalPairs`. MMProj muss sichtbar bleiben, aber nie startbar/routbar sein.
- **2. Paarungslogik danach**: Katalog-/manuelle Zuordnung, Same-Folder-Heuristik, Namensnormalisierung und
  Metadatenvergleich; uneindeutige Faelle bewusst als `ambiguous`/`missing_base`/`missing_projector`/`orphan`
  stehen lassen statt aggressiv zu auto-koppeln.
- **3. Runtime-Probe als Gate weiterhaerten**: `--model` + `--mmproj` und persistente Verifikation sind vorhanden; offen
  bleibt vor allem ein weiter verfeinerter Ergebnisverlauf fuer fehlgeschlagene versus erfolgreiche Proben.
  Endpoint-, `/v1/models`- und kleiner Bildtest-Nachweis sind jetzt Teil des Gates. Erst `verified`-Paare duerfen
  Routing freigeben.
- **4. Dann UI/Control Center**: dieser Block ist jetzt weit fortgeschritten; offen bleiben vor allem weitere
  Routing-/Capability-Ansichten und Ergebnis-Feinschliff.
- **5. Routing zuletzt anschliessen**: erstes Broker-Gate fuer projector-pflichtige Visionmodelle ist aktiv.
  Das erste Screenshot-Coding/Review-Capability-Gate (`vision + code`) ist ebenfalls aktiv.
  Offen bleiben die produktive Screenshot-Coding/Review-Kette und weitere Routing-/Capability-Regeln.
- **6. Capability-Zertifizierung getrennt**: direkte Vision-Coding-/Review-Ausfuehrung erst nach expliziter
  Zertifizierung von `code_generation`, `code_review`, `structured_output`, `instruction_following`, `tool_calling`.

### Wichtig fuer die naechste Session

- zuerst Datenvertrag/Index aendern, **nicht** mit UI oder Broker anfangen
- keine automatische Freigabe mehrdeutiger MMProj-Paare
- keine Modellgewichte beim App-Start laden; Probing nur kontrolliert und temporaer
- Regressionen von Anfang an mitsichern: MMProj nie startbar, nie `primaryCodingModel`, nie Text-Chat-Default

### Verifikation (kumulativ)

- `npm run typecheck` (apps/desktop) — **vollstaendig fehlerfrei**
- `electron-vite build` — erfolgreich, keine Warnungen mehr
- Backend-Pytest + Frontend-Vitest auf allen betroffenen Suiten — gruen
- Playwright-E2E (mit `ELECTRON_RUN_AS_NODE` unset): 11/41 automatisiert bestanden (Boot + UI-Chrome); Rest erfordert echte Modell-Runtime — siehe Verifikationsdokument

## Echter interaktiver Golden-Path-Durchlauf mit echtem lokalem Modell

Diese Maschine hat echte GGUF-Modelldateien unter `D:\Models`. Damit wurde ein
echter, interaktiver Durchlauf gefahren (isolierte App-Data/Userdata/Workspace,
`gemma-3-1b` als Testmodell) — Details und vollstaendige Checkliste in
[docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md](C:/Users/ralle/source/repos/dbzs-codee-project/docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md).

**Echt verifiziert**: App startet, Projekt oeffnet sich und bleibt ueber
Neustarts gespeichert, lokales Modell verbindet sich automatisch, Chat
beantwortet eine echte Projektfrage mit echter LLM-Inferenz.

**Zwei echte Bugs gefunden und behoben** (nur durch den echten Durchlauf
sichtbar, kein Mock haette das gezeigt):

- `e9c1e54` — `ModelIndexService._from_catalog()` uebernahm `models.catalog.json`s
  `runtime_dir`-Feld unvalidiert; war auf dieser Maschine veraltet
  (`D:/win_runtimes/llama.cpp-win-runtime`, leer) statt der echten Binaries
  unter `D:/win_runtimes/llama/`. Faellt jetzt bei Bedarf auf
  `first_win_llama_runtime_dir()`-Discovery zurueck.
- `9aba315` — **Regression aus PR #4**: der `dbzs:fs:stat`-Guard von heute
  frueh band Existenz-Checks an Workspace/userData, aber
  `pathValidatorService.ts` prueft Modell-Dateien legitim ausserhalb des
  Workspace (`D:\Models\...`). `dbzs:fs:stat` ist jetzt wieder ungeschuetzt
  (nur Metadaten, kein Content-Leak); `read-file`/`write-file`/`file:save`
  bleiben korrekt beschraenkt.

**Noch nicht abgeschlossen in diesem Lauf**: vollstaendiger Review-Abschluss,
Diff/Apply, Rollback, Testlauf aus Codee, Backup/Restore-Klick, Crash-Recovery
— siehe Checkliste im Verifikationsdokument fuer den Rest. Auf Service-Ebene
sind genau diese Punkte inzwischen verifiziert — siehe
[docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-service-level.md](C:/Users/ralle/source/repos/dbzs-codee-project/docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-service-level.md)
(`SERVICE_VERIFIED`; `UI_VERIFIED` steht fuer diese Punkte noch aus).

## Zusaetzlich umgesetzt (Runtime-Chat-Overhaul, aus der vorherigen Session, Teil von PR #4)

- [apps/desktop/src/components/RuntimeChatTab.tsx](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/components/RuntimeChatTab.tsx)
  - Hauptansicht auf `conversation first` umgestellt und in kleinere Einheiten zerlegt
- [apps/desktop/src/components/runtime-chat/RuntimeChatHeader.tsx](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/components/runtime-chat/RuntimeChatHeader.tsx)
  - kompakter Header mit Workspace-Kontext und sekundaeren Panel-Toggles
- [apps/desktop/src/components/runtime-chat/RuntimeChatConversationFeed.tsx](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/components/runtime-chat/RuntimeChatConversationFeed.tsx)
  - natuerlicher Leerzustand, ruhigerer Nachrichtenfluss, kompakter Run-Block
- [apps/desktop/src/components/runtime-chat/RuntimeChatComposer.tsx](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/components/runtime-chat/RuntimeChatComposer.tsx)
  - freierer Composer mit klarer Fortsetzungslogik fuer kurze Antworten
- [apps/desktop/src/components/runtime-chat/RuntimeChatSecondaryPanels.tsx](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/components/runtime-chat/RuntimeChatSecondaryPanels.tsx)
  - Diagnose, Slots, Approvals und Panels explizit in die Sekundaerebene verschoben
- [apps/desktop/src/services/conversationMetaIntent.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/services/conversationMetaIntent.ts)
  - Statusfragen wie `Wie weit bist du?` und `Wo stehen wir?` werden direkt als Meta-Intent erkannt
- [apps/desktop/src/services/workflowContinuation.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/services/workflowContinuation.ts)
  - `weiter` wird als natuerliche Fortsetzung eines aktiven Workflows behandelt

## Neu im Arbeitsbranch: generische Runtime-Chat-Dateianhaenge

Stand im Branch `feature/runtime-chat-ux-overhaul` nach Commit `71d3706`:

- der bisherige bildspezifische Attachment-Pfad ist zu einer generischen Datei-Attachment-Pipeline erweitert
  (`image`, `document`, `archive`, `text`, `code`)
- der Composer akzeptiert jetzt Bilder weiterhin, zusaetzlich aber auch `pdf`, `zip`, `md`, `json`, `js`,
  `ts`, `tsx`, `py`, `txt`
- Einfuegen funktioniert ueber den gemeinsamen Anhaengen-Button mit Mehrfachauswahl und ueber `Strg+V`
  fuer Clipboard-Datei-Items
- die Turn-UI rendert dateitypspezifische Vorschauen fuer Bilder, Text/Code, PDF und ZIP
- Text-/Code-Dateien werden vor dem Request als strukturierte Attachment-Bloecke in den User-Turn eingebracht
- PDF wird lokal ueber den Backend-Pfad zu Text extrahiert
- ZIP wird lokal ausserhalb des Workspace temporaer entpackt, rekursiv inventarisiert und nur fuer erlaubte
  Text-/Code-Dateien inline in den Turn uebernommen
- nicht-bildliche Dateianhaenge setzen weder automatisch Vision-Flags noch `requiresVision`; bestehende
  Vision-Gates bleiben auf echte Bildpayloads begrenzt
- neue Backend-Dependency: `pypdf`

Frisch verifiziert fuer diesen Slice:

- `npm run typecheck` in `apps/desktop`
- fokussierter Desktop-Vitest-Lauf: 58 Tests gruen
- Backend-Pytest fuer Runtime-API plus Attachment-Aufbereitung: 14 Tests gruen

## Neu im Arbeitsbranch: generische Post-Response-Folgeaktionen im Chat (Phase 1)

Basis: `Pläne/06 DBZS_CODEE_CHAT_FOLLOW_UP_ACTIONS_DIAGNOSE_PLAN.md` — Diagnose war: normale, erfolgreich
abgeschlossene Chat-/Planungs-/Debug-Antworten bekamen `actions: []`, weil die vorhandene Action-Infrastruktur
nur Patch-Approval/Rollback/Tests/Terminal-/Web-Freigaben und Review-Findings abdeckt; `confirm_continue` war
zu eng auf "Tests starten nach Patch-Apply" verdrahtet. Der Chat wirkte deshalb subjektiv, als wuerde er nach
jeder normalen Antwort "einfach enden".

Phase-1-Umsetzung (kein Phase-2-Umbau):

- neuer deterministischer (nicht LLM-gesteuerter) Builder
  [apps/desktop/src/services/runtimeChatFollowUpActions.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/services/runtimeChatFollowUpActions.ts):
  `buildFollowUpActions()`/`attachFollowUpActionsToMessages()`, max. 3 Vorschlaege pro Antwort
- sechs additive `ChatActionKind`-Werte in `packages/shared/src/index.ts`
  (`continue_task`, `implement_plan`, `show_next_steps`, `retry_run`, `inspect_result`, `new_task`);
  `confirm_continue` bleibt unveraendert dem echten Patch-Approval-Flow vorbehalten
- Gating: `needs_user_input`/`cancelled`/`repositoryReview`/offene Plan- oder Patch-Proposal unterdruecken
  Vorschlaege komplett (Review-Findings-Aktionen in `CodeeRunLiveBlock` bleiben der einzige Weg fuer Reviews);
  echter Fehlschlag → `Erneut versuchen`/`Ergebnis pruefen`; Tool-Call mit `status: "error"` → `Fehler beheben`
  (selbes `continue_task`-Kind wie `Vertiefen`, nur anderer Titel/Prompt); `taskType` `planning`/`architecture`
  → `Plan umsetzen`; Standardfall → `Vertiefen`/`Naechste Schritte`/`Neue Aufgabe`
- Verdrahtung an beiden Stellen, die eine Assistentenantwort tatsaechlich abschliessen, in
  `apps/desktop/src/stores/runtimeChatStore.ts` (Agent-Turn-Loop-Pfad und Streaming-Pfad)
- Klick dispatcht ueber die bestehende Pipeline (`handleChatAction` → `handleChatActionAction` in
  `runtimeChatStoreInteractionActions.ts`) und sendet einen festen Prompt ueber die vorhandene `sendMessage()` —
  keine neue Sonder-Pipeline
- `RuntimeChatMessageCard.tsx` zeigt jetzt zwei getrennte Bloecke: bestehende Pflicht-Freigaben unveraendert,
  neuer "Vorgeschlagene Folgeaktionen"-Block ohne Risiko-Styling, waehrend `isSending` deaktiviert
- "nur die letzte Assistentenantwort zeigt aktive Vorschlaege" ist reine Renderzeit-Logik
  (`isLatestAssistantMessage` aus `findLastAssistantMessageIndex()` in `RuntimeChatConversationFeed.tsx`) —
  keine neue Invalidierungslogik noetig, weil jede neue Turn-Runde ohnehin eine frische Platzhalter-Nachricht
  anlegt; Workspace-Wechsel (`clear()`) entfernt stale Folgeaktionen automatisch mit, weil sie Teil von
  `message.actions` sind

Bewusst zurueckgestellt (Phase 2, siehe Diagnoseplan): echtes Retry mit demselben Run-Kontext,
Modellwechsel-Angebot nach Fehlschlag, Fehlererkennung aus Freitext (aktuell nur ueber
`toolCalls[].status === "error"`), persistierte Folgeaktionen ueber Sessions hinweg.

Verifikation:

- `npx tsc --noEmit -p tsconfig.web.json` und `-p tsconfig.node.json` (apps/desktop) — beide fehlerfrei
- voller Desktop-Vitest-Lauf: 194 Testdateien / 1223 Tests gruen, keine Regressionen
- vier neue/erweiterte Testdateien: `runtimeChatFollowUpActions.test.ts` (neu), `runtimeChatActionSelectors.test.ts`
  (erweitert), `RuntimeChatMessageCard.test.tsx` (neu, `createRoot`/`act`-Harness), `chatActions.test.ts`
  (Dispatch- und Workspace-Clear-Regression ergaenzt)
- **noch offen:** manueller Durchklick in einer echten Desktop-Session (Vorschlaege erscheinen nur unter der
  letzten Antwort, Klick sendet richtigen Prompt, Buttons werden waehrend Senden inaktiv) — siehe TODO.md

## Neu im Arbeitsbranch: vertieftes Runtime Model Control Center

Stand im Branch `feature/runtime-chat-ux-overhaul` nach Commit `1865dc3`:

- [apps/desktop/src/components/notebook/RuntimeModelsTab.tsx](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/components/notebook/RuntimeModelsTab.tsx)
  - `Startbare Modelle` zeigen jetzt zusaetzlich Rollen-, Routing- und Aktions-Summaries (`Laufend`, `Ladbar`, `Blockiert`)
  - die Modellliste wird nach aktivem Laufstatus und Routing-Nutzen sortiert, damit `Vision + Code`- und `Text + Code`-
    Kandidaten vor rein informativen Eintraegen landen
  - `Multimodale Paare` haben jetzt getrennte Source- und Action-Summaries (`Probe bereit`, `Zuordnung noetig`,
    `Erledigt`, `Blockiert`)
  - `Hilfsartefakte` zeigen jetzt Typ-, Aktions- und Status-Summaries (`MMProj`, `Adapter/LoRA`, `Verifiziert`,
    `Candidate`, `Orphan`, `Nur Hinweis`) und werden handlungsorientiert sortiert
- [apps/desktop/src/components/notebook/RuntimeModelsTab.test.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/components/notebook/RuntimeModelsTab.test.ts)
  - gezielte Regressionsabdeckung fuer die neuen Dashboard-Helfer: Startmodell-Sortierung, Modell-Aktionssummary,
    MM-Pair-Aktionssummary sowie Support-Artefakt-Typ-, Status- und Aktionssummaries

Frisch verifiziert fuer diesen Slice:

- `npm run test -- src/components/notebook/RuntimeModelsTab.test.ts src/services/modelSelectionBroker.test.ts`
  - 87 Tests gruen
- `npm run typecheck` in `apps/desktop`

## Vision-Slot-Grundlage Phase 1 (Teil von PR #6)

Basis: `Pläne/07 CODEE_MODELL_ROLLEN_MATRIX.md`. Umgesetzt ist ausschliesslich die additive, risikoarme
Phase 1 — ein neuer `vision_gpu`-Slot existiert typisiert und contract-valide, aber **nichts routet heute echte
Anfragen dorthin**. Kein bestehender Anfragepfad aendert Verhalten.

- neuer `RuntimeSlotId`-Wert `vision_gpu` (Port 8085) plus vier neue `RuntimeTaskType`-Werte
  (`image_analysis`, `ui_analysis`, `visual_debugging`, `document_vision`) in
  [packages/shared/src/runtime/runtimeSlots.ts](C:/Users/ralle/source/repos/dbzs-codee-project/packages/shared/src/runtime/runtimeSlots.ts) —
  die `satisfies Record<RuntimeSlotId, RuntimeSlotDefinition>`-Constraint erzwingt Vollstaendigkeit
- Slot-ID war in vier Stellen dupliziert, alle synchron aktualisiert: `packages/shared/runtime-slots.json`,
  `backend/app/runtime/schemas.py`, `backend/app/runtime/slot_contract.py` (Contract-Validierung),
  `apps/desktop/src/services/runtimeSlotManager.ts` (`ALL_SLOTS`, Scoring, Default-Modell-Aufloesung)
- `backend/app/runtime/residency.py`: `vision_gpu` bekommt `IDLE_EVICT` (nie resident halten, wenn keine
  Bildanalyse laeuft); `lazyRuntimePolicy.ts`: `vision_gpu` ist jetzt Teil der Idle-Eviction-Watch-Liste
- neues, bewusst noch `orphaned`/`readonly` Setting `defaultVisionModelId` (Schema in `appContracts.ts`,
  Registry-Eintrag in `settingsRegistry.ts`, Backend-Pendant in `backend/app/settings/models.py`) — wird erst
  in Phase 3 (Broker-Routing) auf `user_tunable` umgeschaltet
- ein echter, vom Compiler gefundener Nebenfund behoben: `runtimeChatStoreOnDemandExecution.ts`s
  Resident-Fallback-Logik schloss bisher nur `orchestrator_cpu` von ihrem engen Slot-Typ aus, jetzt auch
  `vision_gpu`
- **bewusst zurueckgestellt** (siehe Plandokument): GPU-Exklusivitaet zwischen `fast_gpu`/`vision_gpu` (Phase 2,
  echte Hardware-Verhaltensaenderung, gehoert serverseitig in `RuntimeService.start_model()`), Broker-Routing
  fuer Bildeingaben (Phase 3), FunctionGemma-Routing-Integration und Yi-Coder-9B-„Advisor“-Rolle (beide separat)

Frisch verifiziert fuer diesen Slice:

- `packages/shared`- und `apps/desktop`-Typecheck (beide TS-Projekte) fehlerfrei
- voller Desktop-Vitest-Lauf: 1226 Tests gruen (neue Faelle fuer `scoreModelForSlot`/`configuredModelForSlot`
  auf `vision_gpu` sowie die Settings-Registry-Erweiterung eingeschlossen)
- Backend-Pytest fuer die betroffenen Suiten (`test_runtime_slot_contract`, `test_residency_cache`,
  `test_settings`, `test_context_rc_acceptance_fixtures`) sowie eine breitere `runtime`/`slot`/`residency`/
  `process_cleanup`-Filterauswahl (153 Tests) gruen; ein voller Backend-Lauf zeigte einen einzelnen,
  unabhaengigen Windows-Datei-Lock-Flake in `test_task_manifest.py` (bestaetigt als vorbestehend, isoliert
  reproduzierbar gruen)
- **noch offen**: nichts in Phase 1 startet `vision_gpu` real, daher kein Hardware-Nachweis noetig — einzige
  sinnvolle manuelle Stichprobe waere ein `previewResourcePlan()`-Aufruf gegen ein echtes Qwen2.5-VL-GGUF auf
  `vision_gpu`, um zu bestaetigen, dass der Resource-Planner eine 5. Slot-ID ohne Sonderbehandlung akzeptiert

## Workflow-Audit P0-Fixes (Teil von PR #6)

Basis: `Pläne/08 CODEE_V4_WORKFLOW_AUDIT.md` — ein real reproduzierter Bug: bei "Zähle alle GGUF Modelle im
Workspace" routet Codee auf ein Visionmodell, das Modell erzeugt einen rohen `<CODEE_TOOL_CALL>`-Envelope mit
falschem Pfad (`/models` statt Workspace-relativ), das Tool liefert `[]`, keine natuerlichsprachliche Endantwort
entsteht, der Lauf gilt trotzdem als erfolgreich abgeschlossen. Alle 6 technischen Einzelbehauptungen des Audits
wurden gegen den echten Code verifiziert (5 vollstaendig bestaetigt, 1 mit Nuance). Umgesetzt sind die P0-Fixes
fuer genau diesen Bug:

- **Ursache genauer als im Dokument**: nicht "kein weiterer Turn interpretiert das Ergebnis" (der Agent-Turn-Loop
  fragt durchaus erneut nach), sondern `finalContent = stripToolCallBlocks(rawContent) || rawContent` in
  [agentTurnEngine.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/runtime/agent/agentTurnEngine.ts)
  holt den rohen Envelope zurueck, sobald ein Turn nur Tool-Call-Markup enthaelt und das Strippen leer laesst.
  Der `|| rawContent`-Fallback ist entfernt; ein reiner Tool-Call-Turn liefert jetzt `""`, was ueber die bereits
  vorhandene, korrekte `inferFailureOutcome()`-Logik zu `empty_final_answer` fuehrt — kein neuer Outcome-Typ noetig
- neue, exportierte `isToolOnlyAnswer()` in `runtimeRunFinalization.ts`, in `isValidFinalAnswer()` verdrahtet —
  zusaetzliches Sicherheitsnetz fuer beide Finalisierungspfade (Agent-Turn-Loop und Streaming)
- `runtimeChatStoreAgentTurnFinalization.ts`: `agentLoopCompleted` wird jetzt aus `terminalReason` abgeleitet
  (`false` nur bei `budget_exceeded`/`cancelled`) statt hart `true` — bewusst nicht auf `tool_calls_executed`
  angewendet, da das der normale, gesunde Abschluss fuer den ueberwiegenden Teil erfolgreicher Tool-Nutzung ist
  (der Zaehler ist kumulativ ueber den ganzen Lauf); der Streaming-Pfad bleibt unangetastet, da er echt
  einstufig ist und kein `terminalReason`-Konzept hat
- neue `normalizeWorkspaceToolPath()` in `toolAdapterBridge.ts`: ein fuehrender Slash (`/models`) gilt jetzt als
  workspace-root-verankert statt als absoluter Pfad; echte absolute Windows-Pfade und `..`-Segmente werden mit
  klarer Tool-Fehlermeldung abgelehnt statt still `[]` zurueckzugeben
- `RuntimeChatMessageCard.tsx`: das lange-System-Nachrichten-Einklappen (`isCollapsedSystem`) war an die
  `compact`-Prop gebunden, die an keiner echten Aufrufstelle von `RuntimeChatTab` je gesetzt wird — Bedingung
  entfernt, Tool-Result-Systemnachrichten klappen jetzt tatsaechlich im Hauptchat ein
- **bewusst zurueckgestellt**: neue deterministische `search_workspace_files`/`count_workspace_files`-Tools
  (Punkt D im Audit) und aufgabenabhaengiges Routing weg von Visionmodellen fuer reine Text-/Dateianfragen
  (Punkt F, ueberschneidet sich mit der bereits zurueckgestellten FunctionGemma-Routing-Untersuchung)

Frisch verifiziert fuer diesen Slice:

- beide TS-Projekte (`packages/shared`, `apps/desktop` web+node) fehlerfrei
- voller Desktop-Vitest-Lauf: 1237 Tests gruen (11 neue Faelle in `agentTurnEngine.execution.test.ts`,
  `runtimeRunFinalization.test.ts`, `toolAdapterBridge.test.ts`, `RuntimeChatMessageCard.test.tsx`), keine
  Regressionen im bestehenden erfolgreichen Tool-Call-/Patch-Pfad
- **noch offen**: manueller Smoke-Test in einer echten Desktop-Session gegen ein echtes, gelegentlich
  degradierendes lokales Modell — automatisiert nicht nachstellbar ohne echte Modell-Inferenz

## Aktive offene Aufgaben

### P0

Statusvokabular (projektweit): `SERVICE_VERIFIED` → `UI_VERIFIED` → `INSTALLER_VERIFIED` → `PERSONAL_STABLE`.

Ein automatisiert getriebener UI-Fortsetzungslauf (per Playwright, echtes lokales Modell) hat Kriterium 12
(Backup/Restore) neu auf `UI_VERIFIED` gehoben und einen echten Bug in Kriterium 4 (Chat) gefunden und gefixt
(`a5171b7` — aufeinanderfolgende `system`-Rollen-Nachrichten liessen Gemmas Chat-Template scheitern). Kriterien
5/7/9/10/11 waren blockiert, weil die "canonical workflow assignment"-Schicht bei Review-/Coding-Anfragen
`targetAgent` nicht auf `"reviewer"` aufloeste — **behoben und real durch die UI bestaetigt** (`inferWorkflowKind()`
in `workflowStateResolver.ts` bevorzugte faelschlich den `workflowKind` eines aelteren, noch offenen Task-Contracts
vor der korrekt klassifizierten Review-Absicht; ein zweiter UI-Lauf hat das exakte Regressionsszenario
reproduziert und bestaetigt, dass das `.codee/reviews/rev-*`-Artefakt jetzt korrekt entsteht). **Neuer,
separater Blocker fuer 7/9/10/11:** das kleine lokale Modell (`gemma-3-1b-it-qat-q4-0`, auch getestet mit
`qwen2.5-coder-7b-instruct`) liefert bei strukturierter Review-/Coding-Analyse keine parsbare Ausgabe
(`no_json_array`). Details: [docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-ui.md](C:/Users/ralle/source/repos/dbzs-codee-project/docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-ui.md).
**Ursache gefunden und behoben (2026-07-29):** kein Modell-Faehigkeitsproblem — trat identisch bei einem 1B-
*und* einem 7B-Modell auf (beide ~70 Zeichen Antwort). Der Review-System-Prompt in
[llmBatchAnalyzer.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/services/repositoryReview/llmBatchAnalyzer.ts)
sagte nie, was bei *keinen* Findings zurueckzugeben ist — ein Modell ohne Befund auf einem kleinen/sauberen
Batch antwortet dann nachvollziehbar mit einem kurzen Prosa-Satz statt `[]`. System- und Repair-Prompt
verlangen jetzt explizit `[]` bei keinen Findings; zusaetzlich wird die redigierte Rohantwort bei
Parser-Fehlschlag jetzt persistiert (`rawResponsePreview` in `ReviewBatchAnalyzerDiagnostics`, vorher gab es
nur die Zeichenlaenge). Typecheck fehlerfrei, voller Vitest-Lauf 1239 Tests gruen. **Noch offen:** echte
End-to-End-Bestaetigung mit laufendem lokalem Modell — in dieser Agent-Sandbox nicht verifizierbar (siehe
Prozess-Lebenszeit-Limit weiter unten), braucht eine echte interaktive Session.

**Wichtige Korrektur:** Bei der Code-Vertiefung stellte sich heraus, dass der Service-Level-Bericht fuer 2.6
(Tests) und 2.7 (Rollback) auf nicht-kompilierbarem, nirgendwo verdrahtetem Code beruhte (`patchValidationService.ts`/
`patchRollbackService.ts`, aus demselben Commit wie der Bericht selbst) — entfernt, Bericht korrigiert,
`npm run typecheck` war dadurch seit heute frueh kaputt und ist jetzt wieder sauber. Siehe Korrekturhinweis in
[docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-service-level.md](C:/Users/ralle/source/repos/dbzs-codee-project/docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-service-level.md).

- Rest des Golden-Path (Diff/Apply/Rollback/Tests, harter Abbruch + Neustart) bis `UI_VERIFIED` abschliessen,
  jetzt wo der Routing-Blocker behoben ist; 2.6/2.7 dabei gegen den echten Pfad
  (`patchPipelineService.ts`/`restorePointService.ts`) neu pruefen — siehe [docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md](C:/Users/ralle/source/repos/dbzs-codee-project/docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md) und [docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-ui.md](C:/Users/ralle/source/repos/dbzs-codee-project/docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-ui.md)
- generische Datei-Anhaenge in einer echten Desktop-Session manuell gegen die neuen Dateitypen durchklicken:
  Mehrfachauswahl, `Strg+V`, Senden ohne manuell geschriebenen Prompt, PDF-/ZIP-Hinweise und Turn-Payload
- gepacktes-Build-Userdata-Verzeichnis fuer `backupService.ts` an einem echten Installer-Build verifizieren (`INSTALLER_VERIFIED`; bisher nur Dev-Pfad `%TEMP%\dbzs-codee-dev-user-data` bestaetigt)
- Modell-Katalog auf dieser Maschine neu scannen/regenerieren (`models.catalog.json`s `runtime_dir` war veraltet — auch wenn der Code das jetzt abfaengt, lohnt sich ein frischer Scan)

### P1 — bewusst zurueckgestellt

Konsistent mit der Personal-Production-Plan-Philosophie ("vorerst nicht noetig", kein oeffentlicher Release, kein Team) bewusst nicht aktiv verfolgt:

- GitHub-CI-Strategie entscheiden/reaktivieren (ohnehin durch GitHub-Billing-Sperre blockiert; `ci.yml`/`live-runtime-validation.yml` bleiben absichtlich `workflow_dispatch`-only)
- Branch Protection / Merge-Gates fuer `main`
- Grosse strukturelle Backlog-Punkte ("weitere Zerlegung grosser Runtime-/Store-Dateien", "Contract-Parity zwischen Shared und Backend weiter haerten") — bleiben unpriorisierter Backlog

## Wichtige Hinweise

- Historische Papiere unter `Pläne/` oder `docs/archive/` koennen falsche Repo- oder PR-Annahmen enthalten.
- Die aktuellen Wahrheitsquellen sind `README.md`, `TODO.md`, `docs/STATUS_TODAY.md` und die Audits unter `docs/audits/`.
- Im Worktree liegen generierte Artefakte unter `.cache/backend-build/`; diese gehoeren nicht automatisch in den naechsten Commit.
- `.gitignore` hatte einen blinden Fleck bei Verzeichnissen namens `models/` egal wo im Baum — vor weiteren pauschalen Ignore-Regeln kurz mit `git status --ignored` gegenpruefen, ob echter Source darunter faellt.
- **Diese Sandbox kann einen echten Electron-GUI-Start**, wenn `ELECTRON_RUN_AS_NODE` fuer den Kindprozess entfernt wird (`env -u ELECTRON_RUN_AS_NODE ...`). Backend/Renderer-Dev-Server muessen dafuer manuell vorgestartet werden, da `uv` in dieser Shell fehlt (venv-Python direkt nutzen: `backend/.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8876`).
- **Aber: selbst gestartete Hintergrundprozesse (Backend, Electron) werden von dieser Sandbox nach ca. 2-3
  Minuten Laufzeit beendet** — bestaetigt am 2026-07-29 mit zwei unabhaengigen Versuchen (Bash-Hintergrundprozess
  und PowerShell `Start-Process` detached, mit und ohne vorgewärmtem Modell). Ein echter, interaktiver
  Chat-Smoke-Test gegen ein lokales Modell (Modell-Ladezeit + Antwortzeit ueberschreitet dieses Fenster fast
  immer) ist in dieser Agent-Sandbox daher **nicht zuverlaessig moeglich** — dafuer braucht es eine echte
  interaktive Session (z. B. `start-dev.ps1`), keinen erneuten Agent-Versuch mit denselben Mitteln. App-Boot,
  Modell-Routing-Konfiguration, Settings-Persistenz und Runtime-Slot-Start ueber die API funktionieren dagegen
  auch in der Sandbox nachweislich korrekt (innerhalb des Zeitfensters bestaetigt).
