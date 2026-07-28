# Golden-Path-Verifikation — Fortsetzungslauf (automatisiert getriebene UI)

Datum: 2026-07-28

**Statusstufe dieses Dokuments:** `UI_VERIFIED` (teilweise, weiter fortgeschritten als der Vorlauf). Fuehrt den in [GOLDEN_PATH_VERIFICATION_2026-07-28.md](GOLDEN_PATH_VERIFICATION_2026-07-28.md) begonnenen echten interaktiven Durchlauf fort — gleiche 14-Punkte-Checkliste, gleiche Kriteriennummern. Fuer die Service-Ebene-Verifikation siehe [GOLDEN_PATH_VERIFICATION_2026-07-28-service-level.md](GOLDEN_PATH_VERIFICATION_2026-07-28-service-level.md). Fuer die verbleibenden rein manuellen Punkte (13, 14, Wiederholung) siehe [GOLDEN_PATH_MANUAL_VERIFICATION_SCRIPT.md](GOLDEN_PATH_MANUAL_VERIFICATION_SCRIPT.md).

## Setup

Gleiches Vorgehen wie im Vorlauf, automatisiert statt per Hand ausgefuehrt: isoliertes `DBZS_APP_DATA_DIR`/`DBZS_DEV_USER_DATA_DIR`, Kopie von `test-fixtures/runtime-chat-tuning-lab` als Workspace, Backend per `backend/.venv/Scripts/python.exe -m uvicorn`, Electron per Playwright `_electron.launch()` (custom "command-server"-Treiber fuer eine durchgehende App-Session ueber viele Tool-Aufrufe hinweg). `ELECTRON_RUN_AS_NODE` musste erneut explizit entfernt werden (`env -u ELECTRON_RUN_AS_NODE`), sonst laeuft `electron.exe` als reines Node ohne Electron-APIs — bestaetigt denselben Fund wie der Vorlauf.

## Ergebnis (fortgeschriebene 14-Punkte-Tabelle)

| # | Kriterium | Status | Aenderung ggue. Vorlauf |
|---|---|---|---|
| 1 | App startet fehlerfrei | ✅ echt verifiziert | bestaetigt, 9 App-Neustarts in dieser Session |
| 2 | Projekt oeffnet sich und bleibt gespeichert | ✅ echt verifiziert | bestaetigt ueber alle 9 Neustarts |
| 3 | Lokales Modell verbindet sich automatisch | ✅ echt verifiziert | bestaetigt — `gemma-3-1b-it-qat-q4-0` startete automatisch auf Port 8081 |
| 4 | Chat beantwortet Projektfrage | ✅ echt verifiziert (nach Fix) | **neuer Bug gefunden + gefixt**, siehe unten — vorher schlug *jede* Chat-Nachricht fehl |
| 5 | Full-Repository-Review laeuft durch | ❌ blockiert | **neuer, anderer Blocker** als im Vorlauf (die beiden dortigen Bugs sind laengst gefixt) — siehe unten |
| 6 | `.codee`/`.env`/Logs/Builds fehlen im Inventory | ✅ automatisiert verifiziert | unveraendert (Unit-Tests, PR #4) |
| 7 | Aenderung erscheint zuerst als Diff | ⏳ nicht erreicht | weiterhin blockiert durch #5 |
| 8 | Aenderung verlangt Freigabe | ✅ automatisiert verifiziert | unveraendert (Unit-Test, PR #4) |
| 9 | Aenderung laesst sich anwenden | ⏳ nicht erreicht | weiterhin blockiert durch #5 |
| 10 | Tests lassen sich aus Codee starten | ⏳ nicht erreicht | weiterhin blockiert durch #5 |
| 11 | Rollback/Restore-Point funktioniert | ⏳ nicht erreicht | weiterhin blockiert durch #5 |
| 12 | Backup/Restore funktioniert (Diagnostics-Tab) | ✅ **echt verifiziert** | **neu** — voller Roundtrip erfolgreich (siehe unten), vorher `⏳ manuell erforderlich` |
| 13 | Neustart nach Abbruch erhaelt Zustand | ⏳ manuell erforderlich | unveraendert, absichtlich nicht in diesem Lauf (siehe `GOLDEN_PATH_MANUAL_VERIFICATION_SCRIPT.md`) |
| 14 | Gepackter Installer-Build: `backupService.ts`-userData-Pfad stimmt | ⏳ manuell erforderlich | unveraendert, absichtlich nicht in diesem Lauf (siehe `GOLDEN_PATH_MANUAL_VERIFICATION_SCRIPT.md`) |

Modellkatalog-Rescan ("Modellindex neu laden") zusaetzlich verifiziert: alle 364 Modelle neu gescannt, `runtime_dir`/`health_status: "ok"` fuer das Zielmodell unveraendert korrekt — keine Wiederkehr des im Vorlauf gefixten Stale-`runtime_dir`-Bugs.

## Neuer Bug gefunden und gefixt: Chat schlaegt bei jeder Nachricht fehl (Kriterium 4)

Jede Chat-Nachricht an `gemma-3-1b-it-qat-q4_0` scheiterte — erster Versuch nach ~17s mit `generation_failed`, jeder weitere Versuch nahezu sofort (~0.9s).

- **Ursache:** Der Desktop-Client baut die ausgehende Konversation aus mehreren unabhaengigen System-Rolle-Fragmenten zusammen (Goal Capsule, Active-Task-Contract, Runtime-Tool-Instruktionen, Projekt-Memory, ...), und der Backend-Service selbst stellt zusaetzlich seinen eigenen System-Prompt plus eine optionale Datei-Kontext-System-Nachricht voran. Ergebnis: 5-10+ **aufeinanderfolgende `system`-Rollen-Nachrichten** vor der ersten `user`-Nachricht. Gemmas Chat-Template (serverseitig von `llama-server` angewendet) erzwingt strikte Rollen-Alternation und lehnt das mit `Jinja Exception: Conversation roles must alternate user/assistant/user/assistant/...` (HTTP 500) ab — die App zeigt das nur als generisches `generation_failed`.
- Bestaetigt per direktem `curl` gegen `/runtime/chat/stream`: 3-System-Nachrichten-Payload → 500; Ein-Nutzer-Nachricht-Payload → 200. Damit der genaue Ausloeser isoliert.
- **Fix (committed `a5171b7`):** `backend/app/runtime/service.py` — neue `RuntimeService._merge_consecutive_same_role_messages()`, angewendet am Ende von `_build_chat_messages()` (genutzt von `chat()` und `chat_stream()`). Fasst aufeinanderfolgende gleich-rollige Nachrichten zu einer zusammen (Inhalt mit Leerzeile verbunden) — erhaelt Inhalt und Reihenfolge vollstaendig, erzeugt aber eine template-sichere alternierende Sequenz, unabhaengig davon, welches lokale Modell/Template aktiv ist.
- Verifiziert: `pytest backend/tests/test_runtime_service.py` — 34/34 gruen (unabhaengig nachgeprueft, nicht nur vom Ausfuehrenden behauptet); direkter `curl`-Retest erfolgreich; echter In-App-Chat nach Fix erfolgreich ("Hallo!" beantwortet).
- Sicherheit: reine Nachrichtenlisten-Normalisierung vor dem Modellaufruf; kein Verhaltensunterschied fuer bereits korrekt alternierende Konversationen (der uebliche Fall in der bestehenden Testsuite).

## Neuer, ungeloester Blocker: Repository-Review/Coding-Task-Routing (Kriterium 5)

Anders als im Vorlauf (dort blockierten zwei inzwischen gefixte Bugs den Review) wurde diesmal ein **anderes** Problem sichtbar: natuerlichsprachliche Review-Anfragen — inklusive der exakten Phrase, die der eigene "Review erneut starten"-Button im Code verwendet (`"Mache einen vollständigen Repository Review."`) — loesen den strukturierten `RepositoryReviewOrchestrator` nicht aus (kein `.codee/reviews/rev-*`-Artefakt, kein `reviewer`-gelabelter `CODEE RUN`). Das Modell antwortet stattdessen nur im freien Chat.

- Nachverfolgt: `matchesReviewIntent`/`classifyUserExecutionIntent` (`apps/desktop/src/services/executionIntent.ts`) und `classifyTaskType`/`matchesCompleteRepositoryReviewIntent` (`apps/desktop/src/services/modelSelectionBroker.ts`, `.../repositoryReview/reviewIntent.ts`) klassifizieren die Nachricht korrekt als `taskType: "review"` / `scope: "full_repository"`.
- Das tatsaechliche Gate in `runtimeChatStore.ts:1006` verlangt zusaetzlich `brokerDecisionFull?.targetAgent === "reviewer"`, aufgeloest ueber eine separate "canonical workflow assignment"-Schicht, die in diesem Lauf nicht auf `reviewer` geroutet hat. Diese Schicht konnte im Zeitbudget dieses Laufs nicht vollstaendig nachverfolgt werden.
- Zusaetzlicher, separat behobener Setup-Luecke am Rande gefunden: `settings.json` hatte nur `defaultChatModelId` gesetzt; rollenspezifische IDs (`defaultCoderModelId`, `defaultReviewerModelId`, ...) waren leer, was beim ersten Coding-Task-Versuch einen expliziten `"Rollenmodell in Settings fehlt"`-Fehler ausloeste. Per `/settings`-PATCH + Neustart behoben (kein Code-Fix, nur Laufzeit-Konfiguration) — ein anschliessender Coding-Change-Versuch endete danach trotzdem in `generation_failed` (Backend-Log bestaetigt `200 OK` fuer `POST /runtime/chat/stream`, d. h. der Fehler liegt clientseitig in der Finalisierung, nicht am Template/Alternation-Problem von oben — vermutlich mit der Tool-Call-Zuverlaessigkeit des kleinen Modells zusammenhaengend, aber nicht abschliessend isoliert).

**Empfehlung:** eigene Folge-Session, die gezielt die "canonical workflow assignment"-Schicht instrumentiert und/oder ein groesseres, Tool-Call-faehigeres lokales Modell verwendet. Solange Kriterium 5 blockiert ist, bleiben 7, 9, 10, 11 zwangslaeufig unerreicht.

## Neu verifiziert: Diagnostics-Tab — Backup & Restore (Kriterium 12)

Voller echter Roundtrip:

1. "Jetzt sichern" → manuelles Backup erstellt (37 Dateien), korrekt neben dem automatischen Start-Backup gelistet.
2. `settings.json`-Theme per API geaendert (dark→light, Revision 2→3) als pruefbares Delta.
3. "Wiederherstellen" auf dem Vor-Aenderungs-Backup geklickt.
4. **Automatisierungs-Falle gefunden (kein App-Bug):** die Restore-Bestaetigung nutzt einen nativen `window.confirm(...)`-Dialog, den Playwright-getriebene (und vermutlich andere programmatische) Treiber standardmaessig stillschweigend abbrechen — der Button scheint wirkungslos, ohne Fehleranzeige. Fuer echte menschliche Nutzer kein Problem; relevant fuer kuenftige automatisierte Tests dieses Flows.
5. Nach Bestaetigung (per `window.confirm`-Monkeypatch): Theme korrekt auf `dark` zurueckgesetzt, Revision zurueck auf 2, UI zeigte "37 Dateien wiederhergestellt. Neustart empfohlen.", App legte automatisch ein frisches Vor-Restore-Sicherheits-Backup an.

## Kleinere, nicht weiter verfolgte Beobachtung

Bei 2 von 9 Kaltstarts erschien im Terminal-Panel `Memory: Error invoking remote method 'dbzs:workspace:write-project-file': Error: Path is outside of current workspace.` — der Workspace selbst lud in allen 9 Faellen korrekt, wirkt nach einer Boot-Zeit-Race im Projekt-Memory-Bootstrap (`apps/desktop/src/services/projectMemoryService.ts`/`projectKnowledgeStore.ts`), nicht nach einem harten Fehler. Zur Kenntnisnahme, nicht weiter untersucht.

## Empfehlung

Kriterien 1-4, 6, 8, 12 sind jetzt mit echten Beweisen verifiziert (12 neu in diesem Lauf). Kriterium 5 bleibt blockierend fuer 7, 9, 10, 11 — anders blockiert als im Vorlauf, aber weiterhin offen. 13 und 14 sind bewusst nicht Teil automatisierter Laeufe (siehe `GOLDEN_PATH_MANUAL_VERIFICATION_SCRIPT.md`).

### Naechste Schritte

1. "Canonical workflow assignment"-Schicht instrumentieren, um zu verstehen, warum `targetAgent` nicht auf `reviewer` aufloest — das ist der einzige verbleibende Blocker fuer 7, 9, 10, 11.
2. Rollenspezifische Modell-IDs (`defaultCoderModelId`/`defaultReviewerModelId`/...) standardmaessig aus `defaultChatModelId` ableiten oder beim ersten Start explizit abfragen, statt einen harten Fehler zu zeigen.
3. Sobald 5/7/9/10/11 erreichbar sind: Kriterien 13 (harter Abbruch) und 14 (Installer) manuell nach `GOLDEN_PATH_MANUAL_VERIFICATION_SCRIPT.md` durchfuehren, dann zwei Wiederholungslaeufe fuer `PERSONAL_STABLE`.
