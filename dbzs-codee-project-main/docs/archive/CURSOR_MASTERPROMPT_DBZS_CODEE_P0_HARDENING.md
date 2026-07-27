# Cursor-Masterprompt: DBZS Codee P0 Integration Hardening

Du arbeitest im Repository `devdbzemusic/dbzs-codee-project`.

## Auftrag

Bringe DBZS Codee vom derzeitigen Stand `0.4.0-rc.1` in einen **ehrlich verifizierten Release-Candidate-Zustand**. Arbeite strikt nach Priorität, mit kleinen nachvollziehbaren Änderungen und überprüfbaren Gates.

Der wichtigste bekannte Befund:

- Reguläre Tests sind weitgehend grün.
- Die Desktop-Capability-Suite wird standardmäßig übersprungen.
- Mit `RUN_CAPABILITY_SUITE=1` bestanden zuletzt **30 von 30 Szenarien** (Gate 1 erfüllt auf Branch `feat/context-intelligence-rc-hardening`, PR #51).
- Betroffen waren unter anderem Nachrichtenversand, Agentenrouting, Tool-Aufrufe, Patch-Queue und Runtime-Stop-Guard.

Behandle diesen Zustand als **P0-Release-Blocker**.

## Verbindliche Arbeitsregeln

1. Lies zuerst alle geltenden `AGENTS.md`-Dateien sowie:
   - `README.md`
   - `docs/ARCHITECTURE.md`
   - `docs/STATUS.md`
   - `docs/HANDOVER.md`
   - `docs/ROADMAP.md`
   - vorhandene Security-, Runtime- und Testdokumentation.
2. Prüfe vor Änderungen `git status`. Überschreibe oder entferne keine fremden Änderungen.
3. Keine Groß-Neuschreibung und kein vorsorgliches Refactoring.
4. Repariere zuerst den kleinsten nachweisbaren Fehler entlang des realen Ausführungspfads.
5. Halte Shared Contracts, Zod-Schemas, Pydantic-Modelle und IPC-Verträge synchron.
6. Keine Mock-Funktion als `REAL`, `DONE`, „fertig“ oder „Production Ready“ dokumentieren.
7. Neue bzw. geänderte Dokumentation auf Deutsch; Codebezeichner entsprechend dem vorhandenen Stil.
8. Keine Secrets, absoluten persönlichen Pfade, Testresultate oder Diagnose-Runs committen.
9. Nach jeder Phase Tests ausführen und erst bei grünem Gate fortfahren.
10. Bei einem Blocker stoppen, Ursache mit Dateipfad und konkretem Beleg dokumentieren. Nichts schönreden.

---

## Phase 0 – Baseline und Fehlerlokalisierung

### Aufgaben

1. Installiere ausschließlich anhand der Lockfiles:

```bash
pnpm install --frozen-lockfile
uv sync --frozen
```

2. Ermittle die Capability-Testdatei und die Stelle, an der sie abhängig von `RUN_CAPABILITY_SUITE` übersprungen wird.
3. Führe die Suite explizit aus:

```bash
RUN_CAPABILITY_SUITE=1 pnpm --filter @dbzs/desktop test:capabilities
```

Unter Windows/PowerShell:

```powershell
$env:RUN_CAPABILITY_SUITE="1"
pnpm --filter @dbzs/desktop test:capabilities
```

4. Erzeuge eine kompakte Fehlermatrix:

| Szenario | Erwartet | Tatsächlich | Erste abweichende Funktion | Ursache |
|---|---|---|---|---|

5. Prüfe insbesondere die Übergänge:

```text
UI/Store
  → sendMessage
  → Broker/Router
  → Agentenrolle
  → Modell-Slot
  → Tool Runtime
  → Patch-Vorschlag
  → Review-/Approval-Queue
  → Verifikation
```

### Gate 0

- Der Fehler ist deterministisch reproduziert.
- Für jedes fehlgeschlagene Szenario ist die erste echte Abweichung bekannt.
- Es ist getrennt dokumentiert, welche Erwartungen veraltet und welche Implementierungen regressiert sind.

---

## Phase 1 – Capability-Suite reparieren

### Ziel

**30 von 30 Capability-Szenarien müssen bestehen.**

### Aufgaben

1. Vergleiche aktuelle Routing-, Broker-, Runtime- und Shared-Contract-Signaturen mit dem Capability-Harness.
2. Repariere veraltete Test-Fixtures nur dann, wenn der aktuelle Vertrag fachlich korrekt und dokumentiert ist.
3. Repariere Implementierungsregressionen, wenn der bestehende Vertrag weiterhin gültig ist.
4. Stelle mindestens folgende Fähigkeiten deterministisch sicher:
   - `sendMessage` startet und beendet einen gültigen Ablauf;
   - Planner-, Reviewer-, Coder- und Debugger-Presets routen an die richtige Rolle;
   - Runtime Chat verwendet den vorgesehenen Ausführungspfad;
   - List-/Read-Tools werden bei Workspace-Aufgaben tatsächlich aufgerufen;
   - strukturierte Patch-Vorschläge landen in der Approval-Queue;
   - ungeprüfte Aktionen werden nicht automatisch ausgeführt;
   - gestoppte Runtime blockiert den Versand korrekt;
   - Offline-/Fallback-Verhalten ist explizit und testbar.
5. Entferne das implizite Überspringen der Suite oder aktiviere sie verpflichtend in CI.
6. Vermeide instabile Timer-, Netzwerk- und Live-Modell-Abhängigkeiten im Required Gate.

### Gate 1

```bash
pnpm typecheck
pnpm --filter @dbzs/shared test
pnpm --filter @dbzs/desktop test
RUN_CAPABILITY_SUITE=1 pnpm --filter @dbzs/desktop test:capabilities
```

Erwartung:

- Typecheck grün;
- reguläre Tests grün;
- Capability-Suite **30/30 grün**;
- Capability-Suite läuft in CI sichtbar und verpflichtend.

Wenn Gate 1 nicht grün ist: **nicht mit Phase 2 beginnen**.

---

## Phase 2 – P0-Sicherheit

### 2.1 Cloud-API-Schlüssel

Aktueller Risikoverdacht:

- OpenAI-/Anthropic-Schlüssel sind Bestandteil des Settings-Modells.
- vollständige Settings werden als JSON gespeichert;
- Schlüssel werden an den Renderer zurückgegeben;
- der Renderer baut selbst Authorization-Header.

### Zielarchitektur

```text
Renderer
  → erhält nur providerConfigured: boolean
  → sendet Cloud-Anfrage ohne Secret

Main/Backend Secret Broker
  → liest/entschlüsselt Secret
  → führt Provider-Anfrage aus
  → gibt nur Ergebnis zurück
```

### Aufgaben

1. Bestätige zuerst den tatsächlichen Datenfluss mit Dateipfaden.
2. Entferne rohe Schlüssel aus Renderer-State, IPC-Antworten und öffentlichen Settings-Verträgen.
3. Verwende für den Windows-Desktop einen geeigneten OS-gebundenen Credential-Mechanismus. Falls Electron `safeStorage` verwendet wird:
   - Verschlüsselung und Verfügbarkeit prüfen;
   - niemals auf unsichere Klartext-Fallbacks wechseln;
   - Migration vorhandener Settings vorsehen;
   - alten Klartextwert nach erfolgreicher Migration entfernen.
4. Provider-Aufrufe über Main oder Backend vermitteln.
5. Logs, Fehlerobjekte, Traces und Diagnostik auf Secret-Leaks testen.
6. Tests für Migration, Speichern, Löschen und `configured`-Status ergänzen.

### 2.2 Electron-Härtung

Bekannte Abweichung:

- Dokumentation nennt `sandbox=true`;
- untersuchte Fenster verwendeten `sandbox=false`.

### Aufgaben

1. Inventarisiere alle `BrowserWindow`-Instanzen.
2. Aktiviere `sandbox=true`, soweit technisch möglich.
3. Dokumentiere jede unvermeidbare Ausnahme mit Risiko, Begründung und Kompensationsmaßnahme.
4. Ergänze zentrale Regeln:
   - `setWindowOpenHandler`: standardmäßig verweigern;
   - `will-navigate`: nicht erlaubte Navigation blockieren;
   - externe HTTPS-Links ausschließlich kontrolliert im Systembrowser öffnen;
   - kein `javascript:`, `file:`, `data:` oder ungeprüftes Custom-Schema.
5. Härte CSP; entferne `unsafe-inline` für Skripte.
6. Validiere bei privilegierten IPC-Aufrufen:
   - Sender/WebContents;
   - zugehöriges Fenster;
   - Payload-Schema;
   - Workspace-Grenze;
   - Berechtigung.
7. Verkleinere die Preload-Oberfläche, ohne bestehende Funktionen heimlich zu deaktivieren.
8. Isoliere interaktive Shell-/Terminalfunktionen von untrusted Renderer-Inhalten.

### Gate 2

- Keine rohen Cloud-Schlüssel im Renderer oder in Klartext-Settings.
- Navigation und neue Fenster sind standardmäßig blockiert.
- privilegierte IPC-Pfade besitzen Sender- und Payload-Prüfung.
- Dokumentation entspricht der realen Sandbox-Konfiguration.
- Security-Regressionstests sind grün.

---

## Phase 3 – Build reproduzierbar machen

Bekannter Befund:

- Standardbuild lief in einen V8-Heap-OOM nahe 2 GB.
- Mit `NODE_OPTIONS=--max-old-space-size=4096` war der Build erfolgreich.

### Aufgaben

1. Stelle das erforderliche Heap-Limit reproduzierbar im Build-Skript bzw. in CI bereit.
2. Vermeide eine rein lokale, nicht dokumentierte Umgebungsabhängigkeit.
3. Erfasse die größten Renderer-Chunks.
4. Behebe den statisch/dynamischen Doppelimport von `runtimeBootstrap.ts`.
5. Lade Monaco und TypeScript-Worker nur dort, wo sie tatsächlich gebraucht werden.
6. Führe ein realistisches Bundle-Budget ein; keine willkürliche Zahl ohne Baseline.

### Gate 3

```bash
pnpm typecheck
pnpm build
```

- Build funktioniert über den dokumentierten Standardbefehl.
- Erforderliche Speicherkonfiguration ist in CI identisch.
- Bundle-Baseline ist dokumentiert.

---

## Phase 4 – Statuswahrheit und Dokumentation

### Aufgaben

1. Erstelle eine kanonische Statusmatrix mit:
   - `REAL`
   - `PARTIAL`
   - `MOCK`
   - `BLOCKED`
   - `DEPRECATED`
2. Markiere Desktop-RuntimeKernel-Memory als `MOCK/PARTIAL`, solange nur In-Memory-Persistenz verwendet wird.
3. Korrigiere:
   - Slot-Anzahl und Port-Zuordnung;
   - Testzahlen;
   - Sandbox-Aussagen;
   - veraltete Roadmap-Phasen;
   - tote Links;
   - nicht vorhandene `LICENSE`;
   - widersprüchliche „100 %“-/„Production Ready“-Aussagen.
4. Historische Completion Reports nicht löschen, sondern in `docs/archive/` verschieben und deutlich als historischen Stand kennzeichnen.
5. Gleiche offene Issues und PRs mit dem tatsächlichen Code ab. Nicht automatisch schließen; liefere eine belegte Vorschlagsliste.

### Gate 4

- README, Architektur, Status, Roadmap und Handover widersprechen sich nicht.
- Jeder Reifegrad besitzt einen Code-/Testbeleg.
- Linkprüfung ist grün.

---

## Phase 5 – Architekturentscheidung, noch kein Großumbau

Erstelle einen ADR für den kanonischen Ausführungspfad:

```text
User Intent
  → Broker/Router
  → Agent Loop
  → Tool Runtime
  → Review/Apply
  → Verification
  → Trace
```

Ordne jeden bestehenden Pfad ein:

- kanonisch;
- Adapter;
- experimentell;
- deprecated.

Betrachte mindestens:

- Desktop `RuntimeKernel`;
- `runtimeChatStore`;
- `runtimeChatAgentRunner`;
- Backend `agent_runner`;
- Backend `agent_workbench`;
- `autonomous_controller`;
- ältere Agent-Service-Pfade.

Für jeden nicht-kanonischen Pfad dokumentieren:

- aktueller Zweck;
- noch vorhandene Aufrufer;
- Migrationsziel;
- Abschaltkriterium;
- Risiko.

In dieser Phase **keinen umfassenden Umbau** durchführen.

---

## Phase 6 – Kontrollierte Modulzerlegung

Erst beginnen, wenn Phase 1 bis 5 grün bzw. dokumentiert sind.

### Priorität 1: `runtimeChatStore.ts`

Vorgesehene Grenzen:

- Transport und Streaming;
- Routing, Modell-Slot und Fallback;
- Kontext und Token-Budget;
- Approval und Actions;
- Patch, Restore und Remediation;
- Persistenz, Trace und Telemetrie.

Regeln:

1. Vor jeder Extraktion Charakterisierungstests ergänzen.
2. Öffentliche Store-API zunächst stabil halten.
3. Pro Änderung nur eine Verantwortungsgrenze extrahieren.
4. Keine UI-Neugestaltung während dieser Arbeiten.
5. Nach jedem Schritt Typecheck, Unit- und Capability-Suite ausführen.

Danach:

- `App.tsx` in Feature-Shells/Panel-Komposition;
- Electron `main.ts` in Fenster-, IPC-, Prozess- und Security-Module;
- Shared `index.ts` in Domänenexports;
- Backend Runtime Service in Prozess-, Provider-, Slot-, Chat- und Health-Dienste.

---

## Abschlussprüfungen

Führe am Ende mindestens aus:

```bash
pnpm typecheck
pnpm --filter @dbzs/shared test
pnpm --filter @dbzs/desktop test
RUN_CAPABILITY_SUITE=1 pnpm --filter @dbzs/desktop test:capabilities
pnpm test:coding-loop
pnpm check:version
pnpm audit --prod --audit-level moderate
pnpm build
```

Backend mit isoliertem Datenpfad:

```bash
DBZS_APP_DATA_DIR="<temporärer beschreibbarer Pfad>" uv run pytest
```

Zusätzlich:

- Backend Smoke und Doctor;
- Renderer-E2E;
- echter Electron-Smoke-Test für Fenster, Preload, IPC und Safe Patch;
- manueller Live-Modell-Akzeptanzlauf getrennt vom deterministischen CI-Gate.

Temporäre Testdateien anschließend entfernen. Der Git-Arbeitsbaum darf nur beabsichtigte Änderungen enthalten.

## Erwartetes Abschlussformat

Antworte nach jeder Phase exakt mit:

### Ergebnis

- Was wurde nachweislich repariert?
- Welche Ursache wurde gefunden?

### Geänderte Dateien

- Pfad
- Zweck der Änderung

### Tests / Checks

- exakter Befehl
- bestanden/fehlgeschlagen
- relevante Anzahl

### Noch offen

- verbleibende Blocker
- keine allgemeinen Floskeln

### Nächster Schritt

- genau eine priorisierte nächste Aktion

## Definition of Done für den nächsten RC

- Capability-Suite 30/30 und verpflichtend in CI.
- Typecheck, Unit-, Backend-, E2E- und echter Electron-Smoke-Test grün.
- Standardbuild reproduzierbar.
- Keine Cloud-Schlüssel in Renderer oder Klartext-Settings.
- Electron-Sicherheitsstatus implementiert, getestet und korrekt dokumentiert.
- Ein kanonischer Agenten-Ausführungspfad ist festgelegt.
- Statusmatrix und Dokumente sind widerspruchsfrei.
- Keine offenen P0-Risiken.
- Jedes akzeptierte P1-Risiko besitzt Owner und Zieltermin.

**Beginne jetzt ausschließlich mit Phase 0 und Phase 1.**  
Führe keine Sicherheitsmigration und keine Architekturzerlegung durch, bevor das Capability-Gate 30/30 grün ist.
