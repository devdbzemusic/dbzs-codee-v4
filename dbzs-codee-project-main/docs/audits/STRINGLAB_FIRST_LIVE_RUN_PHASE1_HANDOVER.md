# StringLab First Live Run – Phase 1 Handover

Stand: 2026-07-22
Branch: `fix/stringlab-first-live-run-boundaries`
Ausgangs-Head: `c3b6d297b68cb06852cb73850dfa45ce03a72b42` (`origin/main`)
Arbeitsstand-Head: `c3b6d297b68cb06852cb73850dfa45ce03a72b42` (keine Commits erzeugt)

## Ergebnis

Phase 1 des Reparaturlaufs ist umgesetzt. Workspace-Grenzen werden jetzt an CodeIndex,
Workspace-Scan, Context Sampling, Context Orchestrator, Backend-RAG, Dateitools,
Review-Gates sowie Runtime-Chat-Freigaben technisch erzwungen.

Phase 2 (`Clarify Before Context`, FunctionGemma-Routing, Vision-/Slot-Korrektur,
Warnbutton und First-Token-SLO) wurde nicht vorgezogen.

## Behobene Ursachen

1. `CodeIndexService` hielt einen global mutierten Datei-Map ohne Generation-Token.
2. Ein fehlender, beschädigter oder workspace-fremder persistierter Index leerte den
   vorherigen Bestand nicht zuverlässig.
3. Alte Builds konnten nach einem Workspacewechsel weiter mutieren oder über den
   inzwischen geänderten globalen Root persistieren.
4. Desktop und Backend verwendeten voneinander abweichende Exclude-Listen.
5. Python `_normal()` entfernte mit `lstrip("./")` auch den führenden Punkt von
   `.codee` und konnte dadurch Policy-Prüfungen umgehen.
6. Review-Gates hatten keine Workspace-Zuordnung; Runtime Chat fragte global ab und
   Approve/Reject enthielten keinen Workspace-Scope.
7. Tool-Approvals, Takeovers und Conversation-State waren nicht vollständig an den
   aktiven Workspace gebunden.
8. Der Windows-RAG-AST-Chunker dekodierte Node-Ausgabe implizit als CP1252 statt UTF-8.

## Implementierung

### Gemeinsame Context-Policy

- Kanonischer Vertrag: `packages/shared/src/context-excludes.json`
- TypeScript-Adapter: `packages/shared/src/contextPolicy.ts`
- Python-Adapter: `backend/app/core/context_policy.py`
- Standardmäßig ausgeschlossen:
  `.codee`, `restore-points`, `node_modules`, `.git`, `dist`, `build`, `target`, `coverage`
- Explizite interne Mentions bleiben ohne bestätigten Zugriff fail-closed.
- Der Vertrag wird in den PyInstaller-Build aufgenommen.

### CodeIndex

- normalisierter Workspacevergleich und monotones `indexGeneration`;
- lokaler Build-Snapshot statt paralleler globaler Mutation;
- Generation-/Workspaceprüfung nach allen relevanten `await`-Grenzen;
- atomare Veröffentlichung und root-gebundene Persistenz;
- Schema-, Root-, Pfad- und Exclude-Validierung persistierter Indizes;
- leerer aktueller Index bei fehlender, beschädigter oder falscher Persistenz.

### Review-Gates und Approvals

- additive SQLite-Migration um `workspace_root` und `workspace_id`;
- `scope_status`: `scoped` oder `legacy_unscoped`;
- `GET /review-gates/pending?workspace_id=...` filtert exakt;
- falscher oder fehlender Scope bei gescoptem Approve/Reject ergibt HTTP 409;
- Legacy-Gates bleiben im globalen Review-/Jobs-Kontext sichtbar, nicht im Runtime Chat;
- Tool-Approvals und Takeovers tragen Workspace-ID und blockieren fremde Freigaben;
- strukturierte Plan-, Patch-, Command-, Web- und Continue-Aktionen tragen ebenfalls
  Workspace-Root und Workspace-ID; Anzeige und Ausführung filtern bzw. prüfen den Scope;
- Workspacewechsel bricht laufenden Chat ab, leert Conversation-/Action-State und
  löst alte Tool-Approval-Promises mit Ablehnung auf.

## Tests und Checks

- `pnpm typecheck`: grün
- Shared: 9/9 Tests grün
- Desktop vollständig: 563 bestanden, 36 übersprungen
- Backend vollständig: 333/333 bestanden
- `pnpm build`: grün
- zusätzliche A→B-Verifikation gegen reales
  `C:\Users\ralle\source\repos\dbzssl`: grün
- Electron-Desktop über `pnpm dev` gestartet: Build und Prozessstart grün
- echter lokaler `llama-server`-Lauf mit
  `Qwen2.5-Coder-7B-Instruct-Q4-K-M-GGUF` im Slot `fast_gpu`: grün
- Live-Latenz des schlanken Abnahmerequests: First Token 9,557 s,
  Gesamtdauer 12,498 s (243 Prompt-/25 Completion-Tokens)
- Modellantwort stellte zuerst eine Rückfrage und enthielt weder `.codee` noch
  `src/test_file.py` oder `DBZS-StringLab-Workbench-main`
- frisches Phase-1-Backend lieferte für `dbzssl` 0 pending Review-Gates; zwei
  vorhandene `src/test_file.py`-Gates blieben ausschließlich im globalen Kontext
  und waren ihren temporären Fremd-Workspaces zugeordnet

Hinweise aus den Testläufen:

- Pytest meldet lokal einen nicht beschreibbaren `.pytest_cache`; Tests selbst sind grün.
- FastAPI meldet die bestehende `TestClient`-/`httpx`-Deprecation.
- Vitest meldet bestehende Node-`localStorage`-Experimental-Warnungen.

## A→B-Nachweis

Workspace A enthielt gezielt:

- `src/test_file.py`
- `.codee/resources/DBZS-StringLab-Workbench-main/src/App.tsx`

Danach wurde Workspace B (`dbzssl`) mit derselben RAG-Instanz indiziert und nur über
seine Workspace-ID abgefragt.

Ergebnis:

- Workspace A ID: `9321b59559a0178e456a9e28` (temporärer Test-Root)
- Workspace B ID: `e2b8f3d4d0fa230262bb2154`
- B: 105 indizierte Dateien
- B enthält `.codee`: nein
- B enthält `src/test_file.py`: nein
- alle 8 Retrieval-Auswahlen gehörten zum B-Index

Die temporäre A-ID ändert sich bei einer Wiederholung erwartungsgemäß mit dem
temporären Verzeichnis. Entscheidend sind getrennte IDs und die B-exklusive Auswahl.

## Hardware-/Runtime-Live-Nachweis

Die Desktop-App wurde aus dem aktuellen Arbeitsstand gestartet. Ein bereits vor dem
Start laufendes Backend verwendete zunächst noch den alten Prozessstand und lieferte
die zwei globalen `src/test_file.py`-Gates auch bei der gescopten Abfrage. Nach dem
kontrollierten Backend-Neustart aus dem Phase-1-Arbeitsstand war die identische
`dbzssl`-Abfrage leer, während die Gates global weiterhin korrekt sichtbar blieben.

Der lokale Qwen-Coder lief danach real über `llama-server` auf Port 8082. Der
erfolgreiche Abnahmerequest antwortete nach 9,557 Sekunden mit der ersten Ausgabe und
war nach 12,498 Sekunden abgeschlossen. Antwort und Context-Auswertung enthielten
keinen der verbotenen Altpfade.

Während der Abnahme wurden zwei Runtime-Randfälle sichtbar:

- Ein von der laufenden Desktop-App erzeugter Request umfasste 6.271 Tokens und wurde
  vom 4.096-Token-Slot abgewiesen. Das gehört zum offenen Context-/SLO-Hardening aus
  Phase 2, nicht zur Workspace-Grenze aus Phase 1.
- Beim ersten Request nach dem Slot-Neustart wurde die Verbindung einmal mit WinError
  10054 geschlossen. Der Runtime-Service stellte den Slot wieder her; der direkte
  Wiederholungslauf war erfolgreich.

## Verbleibende Risiken

- Desktop, Backend und echter `llama-server` wurden gestartet und der lokale
  Modellpfad wurde live geprüft. Die vollständige Klickstrecke im Electron-Fenster
  konnte nicht automatisiert werden, weil die Windows-GUI-Steuerverbindung in dieser
  Sitzung nicht verfügbar war (`native pipe` fehlt).
- Der 6.271-Token-Request zeigt, dass Context-Budgetierung und First-Token-SLO im
  vollständigen UI-Pfad weiter als Phase-2-Gate behandelt werden müssen.
- Die einmalige WinError-10054-Trennung sollte im Phase-2-Langlauf beobachtet werden.
- Expliziter Zugriff auf interne Pfade ist policy-seitig modelliert, bleibt aber ohne
  vorhandenen bestätigten Zugriff bewusst gesperrt.
- Bereits existierende Legacy-Review-Gates bleiben global sichtbar und müssen dort
  normal abgeschlossen oder gelöscht werden.

## Nächster kleiner PR

Separater Folge-PR für Phase 2: zuerst `Clarify Before Context` mit einer schnellen
strukturierten Rückfrage vor RAG. Erst danach FunctionGemma-Decision-Path,
Visionmodell-Gate, Slot-/Warnbutton-Korrektur und First-Token-SLO bearbeiten.
