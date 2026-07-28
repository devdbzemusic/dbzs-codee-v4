# Handover

Stand: 2026-07-28

## Aktueller Arbeitsbranch

- aktiver Arbeitsbranch: `main` (Feature-Branch `codex/runtime-chat-overhaul-conversation-first` ist gemergt und geloescht)
- Sicherheits-Backup-Branch: `codex/backup-runtime-chat-overhaul-2026-07-27`
- physischer Snapshot:
  `C:\Users\ralle\source\repos\_backups\dbzs-codee-project-backup-2026-07-27-runtime-chat-overhaul`

## Repo-Wahrheit

- aktiver GitHub-Remote: `https://github.com/devdbzemusic/dbzs-codee-v4.git`
- lokaler Ordnername bleibt aktuell `dbzs-codee-project`
- `origin/main` zeigt auf `d6c56c4` (Folgearbeit nach PR #4 + echter Golden-Path-Durchlauf, direkt auf `main` committet)
- offene Pull Requests im Live-Repo: keine
- Branch Protection fuer `main`: aktuell nicht aktiv

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

## Aktive offene Aufgaben

### P0

Statusvokabular (projektweit): `SERVICE_VERIFIED` → `UI_VERIFIED` → `INSTALLER_VERIFIED` → `PERSONAL_STABLE`.

Ein automatisiert getriebener UI-Fortsetzungslauf (per Playwright, echtes lokales Modell) hat Kriterium 12
(Backup/Restore) neu auf `UI_VERIFIED` gehoben und einen echten Bug in Kriterium 4 (Chat) gefunden und gefixt
(`a5171b7` — aufeinanderfolgende `system`-Rollen-Nachrichten liessen Gemmas Chat-Template scheitern). Kriterien
5/7/9/10/11 bleiben blockiert durch ein neues, noch ungeloestes Problem: die "canonical workflow assignment"-
Schicht loest bei Review-/Coding-Anfragen `targetAgent` nicht auf `"reviewer"` auf, obwohl die Intent-Klassifikation
korrekt ist. Details, inkl. genauer Codepfade: [docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-ui.md](C:/Users/ralle/source/repos/dbzs-codee-project/docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-ui.md).

- Blocker fuer Kriterien 5/7/9/10/11 loesen (siehe oben), dann Rest des Golden-Path (Diff/Apply/Rollback/Tests,
  harter Abbruch + Neustart) bis `UI_VERIFIED` abschliessen — siehe [docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md](C:/Users/ralle/source/repos/dbzs-codee-project/docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md) und [docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-ui.md](C:/Users/ralle/source/repos/dbzs-codee-project/docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-ui.md); dieselben Punkte sind bereits `SERVICE_VERIFIED` — siehe [docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-service-level.md](C:/Users/ralle/source/repos/dbzs-codee-project/docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-service-level.md)
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
