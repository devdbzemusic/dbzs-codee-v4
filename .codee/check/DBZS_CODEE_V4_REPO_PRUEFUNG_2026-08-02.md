# DBZS Codee v4 – Repository-Kurzprüfung

**Repository:** `devdbzemusic/dbzs-codee-v4`  
**Geprüfter Stand:** `main`  
**HEAD:** `cf049233b9a7f04709eec44b3f36bee5303db2af`  
**Version:** `0.4.0-rc.1`  
**Datum:** 2026-08-02

## Gesamturteil

**Status: fortgeschrittene Release-Candidate-Entwicklung mit guter technischer Absicherung im Repository, aber aktuell ohne automatisch erzwungene GitHub-CI.**

Codee ist deutlich über einen Prototyp hinaus. Das Repository besitzt:

- Monorepo-Struktur mit Shared- und Desktop-Paketen
- Electron/Vite/TypeScript-Frontend
- FastAPI/Pydantic-Backend auf Python 3.13
- umfangreiche Unit-, Integrations-, Capability- und E2E-Tests
- Runtime-Vertragsprüfungen
- Repository-Health-Checks
- Backend-Smoke-, Doctor- und Packaging-Prüfungen
- plattformübergreifende CI-Definition für Windows und Linux
- dedizierte Sicherheitsregressionstests

Die derzeit größte Schwäche ist nicht fehlende Testtechnik, sondern deren **fehlende automatische Durchsetzung auf GitHub**.

## Aktueller Entwicklungsstand

Die jüngsten Änderungen konzentrieren sich auf die lokale Modellflotte und schließen wichtige Produktionslücken:

1. Model-Lab-Runtime-Bridge wurde in reale Produktionspfade eingebunden.
2. Lazy Repository-Auflösung verhindert unnötige SQLite-Zugriffe und Seiteneffekte beim Import und in Tests.
3. RAM-Druckschutz wurde fertiggestellt:
   - Idle-Eviction ab 85 %
   - Eviction älterer Resident-Slots ab 90 %
   - Schutzmodus ab 95 %
   - Drain laufender Requests vor Eviction
   - Diagnose-Endpunkt für RAM Pressure
4. Laufende Chat-Anfragen werden nicht mehr durch sachfremde Einstellungsänderungen verworfen.
5. CLIP-/Vision-Projektor-GGUFs werden anhand der Architekturmetadaten erkannt und nicht mehr fälschlich als Hauptmodell gestartet.
6. Rollen-, Residency- und Routing-Zuordnungen sind im Model Lab editierbar.
7. RAG-Retrieval kann Suchanfragen serverseitig einbetten.

Das ist eine sinnvolle Richtung: Modellverwaltung, Routing und Runtime wachsen nicht mehr als getrennte Einzellösungen, sondern werden zu einer verwalteten Flotte zusammengeführt.

## Technische Stärken

### 1. Gute Prüfoberfläche

Das Root-Paket definiert unter anderem:

- vollständigen Testlauf
- Typecheck
- Capability-Suite
- Coding-Loop-Akzeptanztest
- RAG-Index-, Retrieval- und Spooler-Tests
- Reasoning-Trace-Tests
- Runtime-Chat-E2E
- Backend- und Packaging-Smokes
- Doctor-Prüfungen
- Dokumentations-Drift-Prüfung
- Versionssynchronisation
- Datei- und Import-Grenzwertprüfung
- Runtime-Contract-Verifikation
- lokale CI für Bash und PowerShell

Das ist für ein Projekt dieses Entwicklungsstands überdurchschnittlich gut.

### 2. Klare Runtime-Verträge

`contracts:verify` und die explizite Electron-Bridge-/Backend-Ausrichtung zeigen, dass die Kommunikation nicht mehr nur implizit über zufällige DTO-Formen wächst. Das reduziert besonders bei Desktop-Bridge, Backend und Model Lab die Gefahr stiller API-Drift.

### 3. Produktive Fehlerbehebung

Die letzten Commits behandeln echte Produktionsprobleme statt nur UI-Kosmetik:

- ungewollte Datenbank-I/O
- fehlerhafte Modellklassifikation
- RAM-Überlast
- Request-Verlust während langer Modellstarts
- scannerbedingte Falschklassifikationen
- REST-Seiteneffekte bei reinen Leseoperationen

Diese Fehlerklasse zeigt, dass inzwischen reale Systemintegration getestet wird.

### 4. Reproduzierbare Toolchain

Die Versionen und Laufzeitvorgaben sind relativ klar:

- pnpm 11.7
- Node-basierte Desktop-Toolchain
- Python >= 3.13
- uv-Lockfile-Workflow
- PyInstaller fest auf 6.21.0
- CI für Windows und Ubuntu

## Kritische Risiken

### P0 – GitHub-CI ist nicht automatisch aktiv

Die CI-Datei besitzt derzeit nur `workflow_dispatch`. Push- und Pull-Request-Trigger sind wegen eines dokumentierten GitHub-Billing-Locks deaktiviert.

Folgen:

- Merges können ohne nachweisbaren grünen CI-Lauf erfolgen.
- Branch Protection kann keinen aktuellen Status erzwingen.
- Der letzte HEAD-Commit besitzt keinen veröffentlichten Combined Status.
- Regressionen aus paralleler Agentenarbeit können direkt auf `main` gelangen.
- Windows-/Linux-Abweichungen werden nur erkannt, wenn jemand CI manuell startet oder lokal beide Pfade prüft.

**Empfehlung:** Bis GitHub Actions wieder automatisch läuft, jeden Merge durch ein verpflichtendes lokales Gate-Protokoll absichern und das Resultat als PR-Kommentar oder Build-Attest dokumentieren.

### P0 – Parallel arbeitende Agenten verändern dieselben Kernbereiche

Ein aktueller Commit beschreibt, dass eine parallele Sitzung `runtime/residency.py` syntaktisch beschädigt und unvollständig hinterlassen hatte. Das wurde repariert, ist aber ein deutliches Warnsignal.

**Empfehlung:**

- Ownership/Locking pro Subsystem
- keine parallelen Schreibzugriffe auf dieselben Dateien
- kleine Feature-Branches
- Pflicht-Rebase vor Merge
- Diff- und Contract-Review
- `pnpm ci:local:win` direkt vor jedem Merge

### P1 – Lange Lazy-Runtime-Starts bleiben UX-kritisch

Mehrminütige Modellstarts werden als hardwarebedingt akzeptiert. Technisch korrekt, aber aus Nutzersicht bleibt ein siebenminütiger Warm-up ohne belastbares Fortschrittsmodell problematisch.

**Empfehlung:**

- Runtime-Startphasen als Ereignisse streamen
- Modell-Ladefortschritt und aktuelle Phase anzeigen
- geschätzte Restzeit nur aus Messwerten ableiten
- Abbruch und Wechsel sauber unterstützen
- kleine Agentic-Modelle resident halten
- große Work-Modelle lazy laden
- Startup-Benchmarks dauerhaft im Model Lab speichern

### P1 – Cache-Migration für falsch klassifizierte Modelle fehlt

Bereits gecachte Vision-Projektoren korrigieren sich laut Commit nicht automatisch. Nutzer können daher trotz behobenem Scanner weiterhin falsche Einträge besitzen.

**Empfehlung:** Index-Schema-/Classifier-Version in den Cache-Key aufnehmen oder beim Start gezielt alte Klassifikationen invalidieren.

### P1 – Abhängigkeiten sind überwiegend nur nach unten begrenzt

Viele Python-Abhängigkeiten verwenden `>=`. Das Lockfile reduziert das lokale Risiko, aber unkontrollierte Lockfile-Erneuerungen können größere Sprünge hereinholen.

**Empfehlung:**

- kontrollierte Dependency-Update-PRs
- obere Kompatibilitätsgrenzen für besonders kritische Runtime-Pakete
- automatischer Lockfile-Diff-Review
- SBOM und reproduzierbarer Release-Build

### P2 – RC-Version benötigt formale Release-Gates

`0.4.0-rc.1` ist plausibel, sollte aber an definierte Exit-Kriterien gekoppelt sein.

Mindestens erforderlich:

- grüner Windows- und Linux-Gesamtlauf
- Desktop-Paketierung
- Neuinstallationstest
- Upgrade-Test bestehender App-Daten
- Model-Lab-Datenbankmigration
- Cache-Migration
- Offline-Start
- Backend-Ausfall und Recovery
- Modellstart/Stop/Crash/Restart
- RAM-Pressure-Szenarien
- Vision-Modell plus mmproj
- RAG-Reindex und Retrieval
- Workspace-Dateioperationen
- Sicherheitsregressionen der Electron-Kommandos

## Priorisierte nächste Schritte

### Sofort

1. `pnpm ci:local:win` auf dem aktuellen `main` ausführen.
2. Resultat mit Datum, Commit-SHA und Einzelstatus dokumentieren.
3. Cache-Migration für alte CLIP-/mmproj-Klassifikationen ergänzen.
4. Merge-Sperre einführen, solange kein Gate-Protokoll vorliegt.
5. aktuellen RC als installierbares Paket auf einem sauberen Windows-Profil testen.

### Danach

1. Runtime-Startup-Telemetrie in UI und Model Lab sichtbar machen.
2. Residency-Policy für `fast_gpu`, `quality_cpu`, `utility` und `orchestrator` als offiziellen Vertrag festschreiben.
3. Model-Lab-Rollen mit tatsächlichen Runtime-Slots und Routing-Entscheidungen bidirektional abgleichen.
4. DB-/Cache-Schema-Versionen zentral verwalten.
5. CI-Trigger und Branch Protection reaktivieren, sobald der GitHub-Lock aufgehoben ist.

## Empfohlene Flottenaufteilung

Für die bekannte Zielhardware ist diese Grundstrategie sinnvoll:

- **fast_gpu:** kleines Coding-/Tool-Modell, dauerhaft oder lange resident
- **utility:** Embedding, Reranking, Klassifikation und kurze Hilfsjobs; bevorzugt kleine spezialisierte Modelle
- **orchestrator:** kleines Agentic-Modell, permanent resident auf CPU oder teilweise GPU
- **quality_cpu:** größeres Qualitätsmodell, nur bei Bedarf laden und nach Idle-Zeit entladen

Wichtig ist, dass `residency_intent` nicht nur UI-Metadatum bleibt. Es muss unmittelbar in Slot-Planung, RAM-/VRAM-Budget, Eviction und Routing einfließen.

## Fazit

Codee v4 entwickelt sich aktuell in die richtige Richtung. Besonders Model Lab, Runtime, Routing und Speicherverwaltung werden zunehmend als zusammenhängendes System behandelt.

Der Engpass ist momentan **Prozesssicherheit**, nicht fehlende Architektur:

- hohe Änderungsfrequenz
- parallele Agentenarbeit
- deaktivierte automatische CI
- noch offene Cache-/Migrationsfälle
- hardwarebedingt sehr lange Modellstarts

**Freigabeempfehlung:** Noch nicht als stabilen Release deklarieren. Als `0.4.0-rc.1` ist der Stand plausibel, sobald der aktuelle HEAD einmal vollständig und nachvollziehbar durch die lokalen Windows-Gates sowie einen sauberen Installations- und Migrationstest gegangen ist.

## Prüfgrenzen

Diese Prüfung basiert auf dem aktuellen GitHub-Repository, Metadaten, Commits und den sichtbaren Projekt-/CI-Konfigurationen. Es wurde in dieser Sitzung kein lokaler Clone gebaut und kein Testprozess auf der Zielhardware ausgeführt. Aussagen über tatsächlich grüne Tests sind daher ausdrücklich nicht enthalten.
