# Generalüberholung — dbzs-codee-project

## ✅ Umsetzungsstatus (nach Codebase-Bearbeitung)

**Phase 0 (Housekeeping) — erledigt:**
- 40 veraltete Root-Markdown-Dateien nach `docs/archive/` verschoben (README, CHANGELOG, MODULES, PROVIDERS, RUNTIME, STYLEGUIDE, SYSTEM, WORKSPACES, AGENTS bleiben im Root).
- `docs/RUNTIME_CHAT_FREEZE_AUDIT.md` archiviert mit Hinweis, dass der Bug bereits behoben ist.
- `*.zip` in `.gitignore` aufgenommen (Hinweis: bereits getrackte Zips müssen zusätzlich per `git rm --cached` in eurem echten Git-Repo entfernt werden — das kann eine reine Datei-Bearbeitung nicht leisten, da diese Kopie kein `.git`-Verzeichnis enthält).
- CI-Empfehlung bleibt wie besprochen: lokal via `pnpm ci:local`.

**Phase 1 (Fehlerbehandlung) — die 3 konkreten Stubs behoben:**
1. `vision.screenshot_text`-Tool meldet jetzt ehrlich `status="error"` statt fälschlich `"ok"` (`backend/app/orchestration/service.py`).
2. `ModelDiscoveryService` **reaktiviert** (`backend/app/models/index_service.py`) — der Import war fälschlich mit „Modul nicht gefunden" kommentiert, obwohl `backend/app/models/discovery.py` die Klasse voll implementiert enthält. Nach Reaktivierung: alle 20 betroffenen Tests grün. Nebenbei eine doppelte `relative_id = None`-Zeile bereinigt.
3. `JobQueuePanel.tsx`: **Wichtige Korrektur meines ursprünglichen Befunds** — diese Komponente wird aktuell nirgends im Code importiert/gerendert (dead code). Die echte, produktive Job-Anzeige läuft über `JobMonitorPanel.tsx`, die den Fortschritt bereits korrekt aus Waypoint-Events berechnet. Der Platzhalter betraf also keine sichtbare Funktion. Ich habe die Datei mit einem klaren Hinweis versehen statt sie zu löschen — die Löschentscheidung liegt bei euch.

**Alle Änderungen gegen die echte Backend-Testsuite verifiziert** (`uv run pytest`, 376 Tests): keine Regression durch meine Fixes.

## 🚨 Neuer kritischer Fund: Baseline-Tests sind bereits vor jeder Änderung rot

Die Backend-Testsuite hatte **schon vor meinen Änderungen 16 von 376 fehlschlagenden Tests** — unabhängig von dieser Revision. Das ist wichtig für Phase 2, da man `runtime/service.py` nicht sicher refaktorieren kann, wenn die eigene Testsuite bereits einen inkonsistenten Ausgangszustand hat. Drei unterschiedliche Ursachen identifiziert:

| Ursache | Betroffene Tests | Einschätzung |
|---|---|---|
| **A) Fehlendes `native_tools_payload()`** — `RuntimeChatRequest` (in `backend/app/runtime/schemas.py`) hat keine Methode `native_tools_payload()`, die aber in `runtime/service.py:1303` aufgerufen wird | 8 Tests in `test_runtime_service.py`, `test_residency_cache.py`, `test_runtime_api.py` | **Echter Produktionsbug** — unvollständiges Feature (native vs. prompt-mode Tool-Calls). Würde in Produktion crashen, sobald dieser Codepfad mit „native"-Tools durchlaufen wird. Braucht bewusste Implementierung, keine blinde Automatik-Reparatur. |
| **B) Veraltete Test-Fixtures** — 6 Tests in `test_runtime_warmup.py` konstruieren `RuntimeService` über `RuntimeService.__new__(...)` und setzen Attribute manuell, aber `_shared_slot_bindings` (neueres Attribut) fehlt dabei | 6 Tests | Test-technische Schuld, kein Produktionsbug — mechanischer Fix: `service._shared_slot_bindings = {}` in jedem Test ergänzen. |
| **C) Sandbox-Umgebung** — `test_coding_loop_acceptance.py` schlägt fehl, weil `node_modules/.bin/tsc` in dieser Analyseumgebung nicht existiert (kein `pnpm install` gelaufen) | 1 Test | Kein echter Bug, Artefakt dieser isolierten Prüfumgebung. In eurer echten Dev-Umgebung mit installierten Node-Deps sollte dieser Test regulär laufen. |

**Empfehlung:** Ursache A vor Phase 2 (Backend-Refactoring von `runtime/service.py`) beheben — sonst refaktoriert ihr eine Datei, deren eigene Tests bereits eine bekannte Funktionslücke verdecken. Ursache B ist ein guter erster, risikoarmer Einstieg in Phase 4 (Test-Härtung).

---


Basierend auf der tatsächlichen Analyse des Codes (37.000 LOC, Electron/React-Desktop + Python-FastAPI-Backend für lokale/Cloud-LLM-Orchestrierung). Kein Fantasie-Plan — jeder Punkt bezieht sich auf konkrete, geprüfte Dateien.

## Ausgangslage (bestätigte Befunde)

| Bereich | Befund |
|---|---|
| CI | Deaktiviert (`workflow_dispatch` only) seit Billing-Lock 23.07.2026 |
| Doc-Sprawl | 51 Markdown-Dateien im Root, viele veraltete KI-Prompt-/Handover-Reste |
| Fehlerbehandlung | 109× `except Exception` im Backend, teils ohne Logging |
| Backend-Testabdeckung | 66 Testdateien / 141 Quelldateien — solide Basis |
| Frontend-Testabdeckung | 131 Testdateien / 300 Quelldateien — solide Basis |
| Repo-Hygiene | Mehrere `.zip`-Archive im Git-Verlauf, nicht in `.gitignore` |
| Python-Deps | `uv.lock` vorhanden, sauber gepinnt — kein Handlungsbedarf |
| Bekannter Altbug | Runtime-Chat-Freeze (fehlendes Abort-Signal) laut `docs/RUNTIME_CHAT_FREEZE_AUDIT.md` — **bereits gefixt** (AbortController + Timeout im Code bestätigt) |

### God-Files (Hauptziel der Revision)

**Backend (Python):**
| Datei | Zeilen |
|---|---|
| `backend/app/runtime/service.py` | 1.934 |
| `backend/app/agent_workbench/repository.py` | 1.023 |
| `backend/app/agent_workbench/service.py` | 714 |
| `backend/app/models/index_service.py` | 708 |
| `backend/app/agents/service.py` | 698 |
| `backend/app/job_spooler/service.py` | 670 |
| `backend/app/context_pack/context_cache.py` | 628 |
| `backend/app/runtime/launch.py` | 621 |

**Frontend (TypeScript/React):**
| Datei | Zeilen |
|---|---|
| `apps/desktop/src/stores/runtimeChatStore.ts` | **7.050** |
| `apps/desktop/src/App.tsx` | 2.167 |
| `apps/desktop/electron/main.ts` | 2.104 |
| `apps/desktop/src/components/WorkspaceExplorer.tsx` | 1.323 |
| `apps/desktop/src/components/JobMonitorPanel.tsx` | 1.072 |
| `apps/desktop/src/components/RuntimeChatTab.tsx` | 1.027 |

## Ziele der Revision
1. Wartbarkeit erhöhen — keine Datei über ~500 Zeilen ohne triftigen Grund.
2. Fehler nicht mehr stillschweigend verschlucken.
3. CI wieder als verlässliches Sicherheitsnetz aktivieren.
4. Repository-Hygiene herstellen (Doku, Binärdateien).
5. Bestehende gute Testbasis erhalten und auf neue Module ausweiten — **nicht** neu erfinden.

## Nicht-Ziele (bewusst ausklammern)
- `backend/app/runtime/chat_stream.py` — bereits sauber, keine Änderung nötig (höchstens die dreifache JSON-Parse-Optimierung, siehe Phase 2).
- Python-Dependency-Management (`uv.lock`) — bereits in Ordnung.
- Kein Technologiewechsel (kein Umstieg von Zustand/Electron/FastAPI) — reine Strukturrevision.

---

## Phasenplan

### Phase 0 — Housekeeping (Aufwand: S, Risiko: sehr gering, Dauer: ~1 Tag)
Schnelle Erfolge ohne Code-Risiko, schaffen sofort Übersicht.
- [ ] **CI bleibt vorerst lokal** (`pnpm ci:local` / `pnpm ci:local:win`) — GitHub Actions (`workflow_dispatch`) wird nicht reaktiviert, solange der Billing-Lock besteht. Wichtig für die späteren Phasen: **`pnpm ci:local` vor jedem Refactoring-Schritt in Phase 2/3 manuell ausführen**, da kein automatisches Push/PR-Gate greift.
- [ ] Root-Verzeichnis aufräumen: alle `CURSOR_*.md`, `CODEX_*.md`, `COPILOT_*.md`, `CLAUDE_*.md`, Handover-/Completion-Reports nach `docs/archive/` verschieben oder löschen.
- [ ] `.zip`-Dateien aus Git-Tracking entfernen (`git rm --cached`), `*.zip` in `.gitignore` aufnehmen.
- [ ] `docs/RUNTIME_CHAT_FREEZE_AUDIT.md` als „erledigt" markieren oder archivieren (Bug ist gefixt).

### Phase 1 — Fehlerbehandlung & Logging (Aufwand: M, Risiko: gering, Dauer: ~2–3 Tage)
- [ ] Alle 109 `except Exception`-Stellen im Backend durchgehen; Muster wie `except Exception: return None` durch `logger.exception(...)` vor dem Return ergänzen.
- [ ] Einheitliches Logging statt der 48 verbliebenen `print()`-Aufrufe (nur 6 Dateien importieren aktuell `logging`).
- [ ] Kurze Konvention festlegen: wann `except Exception` akzeptabel ist (z. B. Health-Checks) vs. wann spezifischer gefangen werden muss.
- [ ] **`vision.screenshot_text`-Tool korrigieren** (`backend/app/orchestration/service.py:118-127`): Antwort meldet aktuell `status="ok"` ohne echte OCR-Verarbeitung — auf `status="unavailable"` (o. ä.) ändern, bis ein echtes Vision-Backend angebunden ist. Sonst denkt ein aufrufender Agent fälschlich, er habe Screenshot-Text erhalten.
- [ ] **Toten Discovery-Service-Zweig bereinigen** (`backend/app/models/index_service.py:53-58, 103-104`): `self.discovery_service` ist fest auf `None` gesetzt, `ModelDiscoveryService` ist auskommentiert. Entweder Service reaktivieren (falls Feature gewünscht) oder den nie erreichbaren `if raw_path and self.discovery_service:`-Zweig samt totem Code entfernen.
- [ ] **Job-Fortschritt korrekt berechnen** (`apps/desktop/src/components/JobQueuePanel.tsx:260-265`): aktuell hartkodiert auf 0/50/100 statt aus Waypoints berechnet (eigener Entwickler-Kommentar „Placeholder"). Echte Prozent-Berechnung aus Waypoint-Daten ergänzen.

### Phase 2 — Backend-Refactoring (Aufwand: L, Risiko: mittel, Dauer: ~1–2 Wochen)
Reihenfolge nach Zeilenzahl/Komplexität, jede Datei einzeln, mit bestehenden Tests als Sicherheitsnetz vor dem Split:
1. `runtime/service.py` (1.934 Z.) → aufteilen in z. B. Prozess-Lifecycle, Health/Status, Modell-Auswahl, Slot-Verwaltung.
2. `agent_workbench/repository.py` (1.023 Z.) → Datenzugriff nach Entität trennen.
3. `agent_workbench/service.py`, `models/index_service.py`, `agents/service.py`, `job_spooler/service.py`, `context_pack/context_cache.py`, `runtime/launch.py` — gleiches Muster: Verantwortlichkeiten identifizieren, in Submodule extrahieren.
4. Kleine Optimierung nebenbei: `chat_stream.py` — JSON nur einmal parsen statt 3×.

**Vorgehen pro Datei:** Erst Tests grün bekommen/ergänzen → dann extrahieren → Tests erneut laufen lassen. Kein „Big Bang".

### Phase 3 — Frontend-Store-Refactoring (Aufwand: XL, Risiko: hoch, Dauer: ~2–3 Wochen)
Kernstück der Revision, höchstes Risiko wegen Größe und zentraler Rolle im Chat-Flow.
- [ ] `runtimeChatStore.ts` (7.050 Z.) in fokussierte Stores/Hooks aufteilen, z. B.:
  - `useChatMessages` (Nachrichten-State)
  - `useChatStreaming` (Stream-/Abort-/Timeout-Logik)
  - `useChatApprovals` (Patch-/Plan-Genehmigungen)
  - `useChatSkills` (Skill-Aktivierung)
  - `useChatToolCalls` (Tool-Ausführung/-Anzeige)
- [ ] Bestehende Tests (`runtimeChatStore.test.ts`, `runtimeChatStore.integration.test.ts`) parallel migrieren, damit Verhalten während des Splits abgesichert bleibt.
- [ ] Danach `App.tsx` (2.167 Z.) und `electron/main.ts` (2.104 Z.) angehen — vermutlich Routing/Fenster-Setup vs. Business-Logik trennen.
- [ ] `WorkspaceExplorer.tsx`, `JobMonitorPanel.tsx`, `RuntimeChatTab.tsx` als letzter Schritt dieser Phase.

**Wichtig:** Diese Phase erst nach Phase 0+1, da eine bessere Fehlersicht und aktive CI das Risiko großer Refactorings deutlich senken.

### Phase 4 — Test- & CI-Härtung (Aufwand: M, Risiko: gering, Dauer: begleitend zu Phase 2+3)
- [ ] Für jedes neu extrahierte Modul: eigene, fokussierte Tests statt einer Mega-Testdatei.
- [ ] Coverage-Gate in CI ergänzen, damit die gute bestehende Quote (Backend ~47 %, Frontend ~44 % der Dateien mit Tests) nicht während des Refactorings sinkt.

### Phase 5 — Doku-Konsolidierung (Aufwand: S, Risiko: sehr gering, Dauer: ~2 Tage, parallel zu Phase 0)
- [ ] Eine einzige Quelle der Wahrheit: `README.md` + `docs/` mit klarer Struktur (Architektur, Runbooks, Changelog) statt verstreuter Einzeldokumente.
- [ ] `MODULES.md`, `RUNTIME.md`, `PROVIDERS.md` aktuell halten, sobald Phase 2/3 die Modulgrenzen ändern.

---

## Empfohlene Reihenfolge (Roadmap)

```
Woche 1:      Phase 0 (Housekeeping) + Phase 5 (Doku) parallel
Woche 1–2:    Phase 1 (Fehlerbehandlung/Logging)
Woche 2–4:    Phase 2 (Backend-Refactoring), begleitet von Phase 4
Woche 4–7:    Phase 3 (Frontend-Store-Refactoring), begleitet von Phase 4
laufend:      `pnpm ci:local` vor jedem Merge/Refactoring-Schritt als manuelles Sicherheitsnetz
```

## Risikohinweise
- **Phase 3 ist der Flaschenhals:** `runtimeChatStore.ts` steuert den gesamten Chat-Flow (Nachrichten, Streaming, Approvals, Tools). Ohne konsequent ausgeführte lokale CI (`pnpm ci:local`, Phase 0) und stabile Fehlerbehandlung (Phase 1) vorher ist das Risiko unnötig hoch — da kein automatisches Push/PR-Gate mehr existiert, hängt die Absicherung vollständig davon ab, dass `ci:local` vor jedem Merge tatsächlich manuell ausgeführt wird.
- **Kein Refactoring ohne grüne Tests davor** — die bestehende Testbasis ist ordentlich, sollte aber vor jedem größeren Split als Ausgangspunkt verifiziert werden.
- **Zeitschätzungen sind Richtwerte** für ein bis zwei Entwickler; bei Solo-Entwicklung entsprechend strecken.
