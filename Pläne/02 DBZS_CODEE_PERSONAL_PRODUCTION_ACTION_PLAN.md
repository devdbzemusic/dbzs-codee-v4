# DBZS Codee V4 – Maßnahmenplan zur persönlichen Produktionsreife

**Ziel:** Codee auf deinem Windows-System sicher und täglich produktiv nutzen  
**Zielversion:** `DBZS Codee 0.4.0-personal-stable`  
**Ausgangspunkt:** App-Start, Workspace-Persistenz, lokales Modell und echte Projektfragen sind bereits verifiziert.

---

## 1. Zieldefinition

Codee gilt für deinen persönlichen Einsatz als produktiv, sobald dieser Ablauf zuverlässig funktioniert:

```text
Start
→ Projekt öffnen
→ lokales Modell verbinden
→ Repository-Review
→ Änderung als Diff
→ Freigabe
→ Änderung anwenden
→ Tests ausführen
→ Rollback
→ Backup/Restore
→ Neustart nach Abbruch
```

Öffentliche Release-Themen wie Multi-User-Betrieb, Code Signing, App Store, macOS/Linux oder Branch Protection sind vorerst nicht relevant.

---

## 2. P0 – Unmittelbar notwendige Maßnahmen

### 2.1 Full-Repository-Review vollständig verifizieren

**Ziel:** Ein kompletter Review muss bis zum Abschluss durchlaufen.

**Prüfen:**

- [ ] Review startet ohne leeren Plan
- [ ] Modell und Runtime werden korrekt gewählt
- [ ] Review-Batches werden vollständig verarbeitet
- [ ] `REVIEW_REPORT.md` wird erzeugt
- [ ] Findings sind konkret und verwertbar
- [ ] `.codee`, `.env`, Logs, Caches und Build-Dateien fehlen im Inventory
- [ ] Review endet mit eindeutigem Status

**Fehlerfälle müssen klar unterschieden werden:**

```text
empty_inventory
empty_plan
runtime_unavailable
model_missing
context_overflow
review_failed
review_completed
```

---

### 2.2 Diff-Pflicht vor Dateiänderungen

**Ziel:** Codee darf niemals unbemerkt Dateien verändern.

**Umsetzung:**

- jede Änderung zuerst als Diff anzeigen
- betroffene Dateien vollständig auflisten
- neue, geänderte und gelöschte Dateien kennzeichnen
- keine automatische Anwendung ohne Freigabe
- `.env`, Secrets und Dateien außerhalb des Workspace blockieren

**Abnahme:**

- [ ] Änderungsvorschlag erzeugt Diff
- [ ] Diff entspricht exakt der späteren Änderung
- [ ] Abbrechen verändert keine Datei
- [ ] Freigabe ist sichtbar und eindeutig

---

### 2.3 Sichere Apply-Kette

**Ziel:** Änderungen müssen kontrolliert und atomar angewendet werden.

**Vor Apply:**

1. Workspace-Zustand prüfen
2. Restore-Point erzeugen
3. optional Git-Status speichern
4. Diff-Hash berechnen
5. Benutzerfreigabe einholen

**Beim Apply:**

- atomare Schreibvorgänge
- Workspace-Grenze prüfen
- Symlinks/Junctions kontrollieren
- Schreibfehler vollständig protokollieren
- Teiländerungen bei Fehler zurückrollen

**Abnahme:**

- [ ] Dateiänderung wird korrekt angewendet
- [ ] mehrere Dateien werden konsistent geändert
- [ ] Fehler mitten im Apply hinterlässt keinen halben Zustand
- [ ] Apply-Ergebnis wird im Chat verständlich angezeigt

---

### 2.4 Tests aus Codee starten

**Ziel:** Codee muss nach Änderungen die passenden Tests ausführen können.

**Minimaler Umfang:**

- Projekt-Testbefehl automatisch erkennen
- Befehl vor Ausführung anzeigen
- Arbeitsverzeichnis anzeigen
- Exit-Code, Laufzeit und relevante Ausgabe darstellen
- Fehler verständlich zusammenfassen

**Reihenfolge der Erkennung:**

```text
package.json
pyproject.toml
Cargo.toml
go.mod
*.sln / *.csproj
Makefile
```

**Abnahme:**

- [ ] `npm test` oder projektspezifischer Test startet
- [ ] Erfolg und Fehler werden korrekt erkannt
- [ ] Testausgabe ist einsehbar
- [ ] fehlender Testbefehl führt zu klarer Meldung

---

### 2.5 Rollback und Restore-Point

**Ziel:** Jede von Codee ausgeführte Änderung muss rückgängig gemacht werden können.

**Umsetzung:**

- Restore-Point vor jedem Apply
- Manifest mit Dateien, Hashes und Zeitstempel
- Rollback über UI und Chat
- Vorschau vor Wiederherstellung
- Konfliktmeldung, wenn Dateien danach manuell geändert wurden

**Abnahme:**

- [ ] Änderung anwenden
- [ ] Rollback starten
- [ ] Originalzustand vollständig wiederhergestellt
- [ ] Git-Status stimmt wieder
- [ ] Rollback funktioniert auch bei mehreren Dateien

---

## 3. P1 – Datensicherheit und Wiederherstellung

### 3.1 Backup über Diagnostics vollständig prüfen

**Zu sichern:**

- Einstellungen
- Agenten- und Projektzustände
- relevante SQLite-Datenbanken
- Workspace-`.codee`
- Runtime-Konfiguration
- Modellkatalog und Modellprofile

**Nicht sichern:**

- GGUF-Modellgewichte
- RAG-Indizes
- Build-Caches
- temporäre Logs
- bestehende Restore-Points

**Abnahme:**

- [ ] manuelles Backup erzeugen
- [ ] Backup erscheint in der Liste
- [ ] Manifest ist vollständig
- [ ] Einstellungen ändern
- [ ] Restore durchführen
- [ ] vorheriger Zustand ist wieder vorhanden

---

### 3.2 Backup-Pfad im gepackten Build prüfen

Der aktuelle Dev-Pfad reicht nicht als Nachweis.

**Prüfen:**

- [ ] Windows-Paket erstellen
- [ ] Installer oder portable Build starten
- [ ] Backup erzeugen
- [ ] tatsächlichen UserData-Pfad kontrollieren
- [ ] Restore nach Neustart testen
- [ ] keine Daten landen versehentlich im Installationsordner

---

### 3.3 Crash-Recovery

**Ziel:** Nach einem harten Abbruch darf kein unklarer Zustand verbleiben.

**Test:**

1. Projekt öffnen
2. Chat und Review starten
3. App hart beenden
4. App neu starten
5. Workspace und Verlauf prüfen
6. unvollständige Operation erkennen
7. Recovery oder Rollback anbieten

**Abnahme:**

- [ ] Workspace bleibt erhalten
- [ ] keine beschädigte Datenbank
- [ ] unvollständiger Run wird erkannt
- [ ] Benutzer erhält klare Recovery-Option
- [ ] keine halb angewendeten Patches

---

## 4. P1 – Runtime stabilisieren

### 4.1 Modellkatalog neu erzeugen

Da ein veralteter `runtime_dir` bereits einen echten Fehler verursacht hat:

- [ ] Modellscan erneut ausführen
- [ ] `D:\Models` vollständig erkennen
- [ ] llama.cpp-Runtime neu erkennen
- [ ] alte oder leere Runtime-Pfade entfernen
- [ ] Modellprofile auf gültige IDs prüfen

---

### 4.2 Einen Golden Runtime Path festlegen

Für den täglichen Einsatz zunächst nur:

```text
Provider: llama.cpp
Runtime: D:\win_runtimes\llama\
Modelle: D:\Models\
Modus: project_local_strict
Cloud-Fallback: aus
Ollama-Fallback: aus
```

**Ziel:** Keine automatische Provider-Umschaltung im persönlichen Stable-Modus.

---

## 5. P2 – Bedienung für den Alltag

### 5.1 Personal Production Mode

Empfohlene zentrale Konfiguration:

```env
PERSONAL_PRODUCTION_MODE=true
DBZS_DISCOVERY_MODE=project_local_strict
DBZS_CLOUD_FALLBACK=false
DBZS_REQUIRE_DIFF_APPROVAL=true
DBZS_CREATE_RESTORE_POINT=true
DBZS_AUTO_BACKUP=true
```

Dieser Modus sollte:

- experimentelle Funktionen markieren
- automatische Cloud-Nutzung blockieren
- Diff und Approval erzwingen
- Restore-Point vor Apply erzeugen
- tägliches Backup prüfen
- Workspace-Grenzen strikt halten

---

### 5.2 Klare Statusanzeige

Codee sollte jederzeit anzeigen:

```text
Workspace: verbunden
Runtime: verbunden
Modell: geladen
Review: bereit
Write Access: geschützt
Restore-Point: aktiv
Backup: aktuell
```

Keine versteckten Zustände und keine technischen Rohfehler ohne verständliche Zusammenfassung.

---

## 6. Konkreter Abnahmetest

### Testprojekt

Zunächst ein kleines, ungefährliches Fixture-Projekt verwenden.

### Testauftrag

```text
Prüfe das gesamte Projekt.
Finde einen kleinen echten Fehler.
Schlage eine minimale Änderung vor.
Zeige zuerst den Diff.
Wende die Änderung nach meiner Freigabe an.
Führe die Tests aus.
Stelle danach den ursprünglichen Zustand wieder her.
```

### Checkliste

- [ ] App startet
- [ ] Workspace öffnet sich
- [ ] Modell verbindet sich
- [ ] Projektfrage funktioniert
- [ ] Full Review endet erfolgreich
- [ ] Findings sind sinnvoll
- [ ] Diff ist korrekt
- [ ] Freigabe wird verlangt
- [ ] Apply funktioniert
- [ ] Tests laufen
- [ ] Rollback funktioniert
- [ ] Backup funktioniert
- [ ] Restore funktioniert
- [ ] Crash-Recovery funktioniert
- [ ] gepackter Build verwendet korrekten UserData-Pfad

---

## 7. Reihenfolge der Umsetzung

### Block A – Änderungskette

1. Full Review bis Ende
2. Diff-Vorschau
3. Approval
4. Apply
5. Tests
6. Rollback

### Block B – Datensicherheit

1. Backup
2. Restore
3. Crash-Recovery
4. Installer-UserData-Pfad

### Block C – Stabilisierung

1. Modellkatalog neu scannen
2. festen llama.cpp-Pfad setzen
3. Personal Production Mode aktivieren
4. Golden Path dreimal wiederholen

---

## 8. Freigaberegel

Codee wird als persönlich stabil freigegeben, wenn:

- alle 15 Prüfpunkte bestanden sind
- kein P0-Fehler offen ist
- derselbe Ablauf an drei verschiedenen Tagen funktioniert
- mindestens ein echtes Projekt erfolgreich analysiert wurde
- mindestens eine Änderung angewendet, getestet und zurückgerollt wurde

Danach:

```text
git tag personal-stable-0.4.0
```

Empfohlene Bezeichnung:

```text
DBZS Codee 0.4.0-personal-stable
```

---

## 9. Was danach kommt

Erst nach der persönlichen Freigabe:

- Review-Qualität verbessern
- größere Projekte testen
- Kontextkomprimierung optimieren
- Modellrouting erweitern
- autonome Mehrschritt-Aufgaben zulassen
- weitere Agentenfunktionen aktivieren

Bis dahin gilt:

> Keine neuen Großfeatures. Erst den sicheren täglichen Arbeitskreislauf schließen.
