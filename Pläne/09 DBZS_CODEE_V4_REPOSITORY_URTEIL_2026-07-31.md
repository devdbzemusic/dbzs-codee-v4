# DBZS Codee V4 – Repository-Urteil

**Repository:** `devdbzemusic/dbzs-codee-v4`  
**Geprüfter Branch:** `main`  
**Stand:** 31.07.2026  
**Aktueller Head:** `1e680363f51cb8f4e4d770a7eda4c527f3ebf636`

## Gesamturteil

DBZS Codee V4 ist kein loses Experiment mehr, sondern eine technisch ernstzunehmende lokale AI-Assistant-Plattform mit belastbarer Grundarchitektur.

**Bewertung: 7,8 / 10**

Der Codebestand wirkt bereits **entwicklungs- und intern produktionsfähig**, aber noch nicht vollständig **release- beziehungsweise installerreif**. Die wichtigsten Grundlagen sind vorhanden:

- Electron-/Desktop-Frontend mit TypeScript
- Python-Backend
- lokale Modellverwaltung und Runtime-Slots
- Agent- und Tool-Loop
- sichere Patch-, Approval-, Restore- und Backup-Strukturen
- umfangreiche automatisierte Tests
- lokale CI-Spiegelung
- dokumentierte Golden-Path- und Audit-Verfahren
- Runtime-Chat mit Dateianhängen und Folgeaktionen
- vorbereiteter Vision-Runtime-Slot

Der Engpass ist derzeit weniger fehlender Code als die fehlende vollständige Realitätsprüfung der bereits gebauten Systeme.

## Stärken

### 1. Solide Qualitätsinfrastruktur

Das Root-Projekt besitzt klare Befehle für:

- Typecheck
- Unit- und Backendtests
- Capability-Tests
- Packaging-Smoke
- Backend-Smoke
- Dependency Audit
- Contract Verification
- Repo-Health
- lokale CI

`pnpm ci:local:win` bildet einen umfangreichen Required-Gate-Pfad ab. Das ist für ein Einzelentwicklerprojekt außergewöhnlich stark.

### 2. Ehrlicher Projektstatus

Das Projekt unterscheidet sinnvoll zwischen:

- `SERVICE_VERIFIED`
- `UI_VERIFIED`
- `INSTALLER_VERIFIED`
- `PERSONAL_STABLE`

Diese Statuslogik verhindert, dass ein grüner Unit-Test vorschnell als fertige Benutzerfunktion verkauft wird.

### 3. Gute Fehlerkultur

Die letzten Commits zeigen, dass reale Fehler nicht nur kosmetisch repariert werden:

- Tool-only-Antworten werden nicht mehr als erfolgreiche Endantwort ausgegeben.
- Agent-Completion wird aus dem echten Terminalzustand abgeleitet.
- Workspace-Pfade werden normalisiert und Traversal-/Absolutpfade abgewiesen.
- Repository-Review verlangt bei null Findings jetzt explizit `[]`.
- Rohantworten werden bei Parsefehlern redigiert diagnostisch gespeichert.

Das ist genau die Art von Härtung, die Codee produktionsfähig macht.

### 4. Sinnvolle Runtime-Architektur

Der separate `vision_gpu`-Slot ist für ein System mit nur 4 GB VRAM architektonisch richtig. Vision-Modelle dürfen nicht unkontrolliert denselben GPU-Slot wie schnelle Coding-Modelle blockieren.

Die Umsetzung ist derzeit jedoch nur die Grundlage. Echtes Routing und GPU-Exklusivität fehlen noch.

### 5. Hohe Testdichte

Die Dokumentation nennt über 1.200 grüne Desktop-Tests sowie zusätzliche Backend-, Capability- und Runtime-Tests. Das ist eine starke Absicherung gegen Regressionen.

## Kritische Risiken

### P0 – Reale End-to-End-Abnahme fehlt

Mehrere zentrale Flows sind automatisiert getestet, aber noch nicht vollständig mit einem echten lokalen Modell interaktiv verifiziert:

- Repository Review
- Tool-Call-Finalisierung
- Chat-Folgeaktionen
- Dateianhänge
- Tests nach Patch-Anwendung
- Rollback nach Patch-Anwendung

Damit besteht weiterhin das Risiko, dass isoliert korrekte Komponenten im echten Ablauf falsch zusammenspielen.

### P0 – Unerklärter Absturz nach Modellwechsel

Im TODO ist ein App-/Backend-Absturz nach dem Wechsel auf `qwen2.5-coder-7b-instruct` dokumentiert.

Solange die Ursache nicht geklärt ist, sollte Codee nicht als `PERSONAL_STABLE` eingestuft werden. Modellwechsel gehören zum Kernbetrieb und müssen deterministisch stabil sein.

### P1 – CI ist nicht automatisch erzwungen

`.github/workflows/ci.yml` läuft nur über `workflow_dispatch`.

Dadurch kann Code ohne automatische Prüfung auf `main` gelangen. Zusätzlich fehlt Branch Protection. Der lokale CI-Spiegel ist gut, aber nicht technisch verpflichtend.

### P1 – Installer ist noch nicht verifiziert

Backup-/Restore- und Userdata-Pfade müssen in einer echten gepackten Installation geprüft werden. Dev-Modus und Installer-Modus unterscheiden sich bei Electron häufig in Pfaden, Berechtigungen, Schreibrechten und Prozessstart.

### P1 – Rollenmodelle haben keine robusten Defaults

Fehlende `defaultCoderModelId`, `defaultReviewerModelId` und weitere Rollen-IDs können den ersten Coding-Auftrag direkt blockieren.

Codee benötigt eine automatische Rollenauflösung:

1. explizit gewähltes Rollenmodell
2. bestes kompatibles laufendes Modell
3. bestes kompatibles installiertes Modell
4. verständlicher Auswahlassistent statt hartem Fehler

### P1 – Vision-Slot ist noch nicht funktional integriert

Der Slot existiert, aber:

- kein echtes Broker-Routing
- keine GPU-Exklusivität
- kein definiertes Verhalten für laufende Requests
- Settings teilweise noch `orphaned`

Der aktuelle Zustand ist korrekt als Fundament, aber noch keine nutzbare Vision-Architektur.

### P2 – Statusdokumente driften auseinander

`README.md` ist auf Stand 29.07.2026, während `docs/STATUS_TODAY.md` noch den 27.07.2026 und ältere Commit-/Branch-Aussagen enthält.

Für ein agentisches Projekt ist veraltete Dokumentation besonders gefährlich, weil Agenten sie als Wahrheit interpretieren können.

## Produktionsreife: mein Lösungsweg

### Phase 1 – Stabilitäts-Sprint

Zuerst ausschließlich folgende Punkte abschließen:

1. Absturz nach Modellwechsel reproduzieren und root-causen.
2. Einen vollständigen echten Golden Path durchführen:
   - Aufgabe senden
   - Tool-Aufruf
   - Diff erzeugen
   - Approval
   - Patch anwenden
   - Tests ausführen
   - Fehler simulieren
   - Rollback
3. Repository Review mit zwei realen Modellen testen.
4. Dateianhänge mit PDF, ZIP, Bild und Quellcode real testen.
5. alle Resultate als maschinenlesbare Verification Records speichern.

### Phase 2 – Runtime-Härtung

- Rollenmodell-Autoselektion implementieren
- GPU-Slot-Exklusivität einführen
- geordnetes Request-Draining statt Hard-Kill
- Runtime-Prozess-Supervisor mit Restart-Budget
- Health-Heartbeat pro Modellslot
- Crash-Correlation-ID durch Desktop, Backend und Runtime

### Phase 3 – Release-Gates

- CI wieder auf `push` und `pull_request` aktivieren
- Branch Protection für `main`
- Required Checks erzwingen
- Release nur bei:
  - CI grün
  - Golden Path grün
  - Installer Smoke grün
  - keine offenen P0-Fehler

### Phase 4 – Installer und Updatefähigkeit

- sauberer Windows-Installer
- definierter App-Data-Pfad
- Migrationen für Settings und Model Index
- Backup vor jeder Schema-Migration
- Repair-Modus
- Diagnosepaket als ZIP exportierbar
- signierte Builds und reproduzierbare Versionsnummern

## Empfohlene nächste Aufgaben

### Sofort

1. Modellwechsel-Absturz analysieren.
2. echten Patch-/Test-/Rollback-Golden-Path abschließen.
3. Rollenmodell-Fallback implementieren.
4. `STATUS_TODAY.md`, `README.md`, `TODO.md` automatisch synchronisieren.

### Danach

5. Vision GPU Phase 2: Slot-Exklusivität.
6. Vision GPU Phase 3: echtes Broker-Routing.
7. automatische CI und Branch Protection aktivieren.
8. Installer-Verifikation durchführen.

## Architektururteil

Die Architektur ist insgesamt richtig ausgerichtet:

- local-first
- modular
- diagnostizierbar
- sicherheitsbewusst
- testbar
- für mehrere Modellrollen vorbereitet

Es gibt noch technische Schulden und einzelne große Runtime-/Store-Module, aber keine erkennbare grundlegende Fehlentscheidung, die einen Neuaufbau rechtfertigen würde.

**Klare Empfehlung: Nicht neu bauen. V4 stabilisieren, integrieren und die vorhandenen Systeme real abnehmen.**

## Schlussurteil

DBZS Codee V4 befindet sich zwischen **fortgeschrittenem Beta-System** und **persönlich produktionsfähigem Werkzeug**.

Der aktuelle Stand ist:

- **Architektur:** gut
- **Implementierungsbreite:** sehr gut
- **Testbasis:** sehr gut
- **Runtime-Stabilität:** noch nicht abschließend belegt
- **Release-Prozess:** unzureichend erzwungen
- **Installer-Reife:** offen
- **Produktionspotenzial:** hoch

Nach einem fokussierten Stabilitäts- und Abnahme-Sprint kann Codee glaubwürdig den Status `PERSONAL_STABLE` erreichen.
