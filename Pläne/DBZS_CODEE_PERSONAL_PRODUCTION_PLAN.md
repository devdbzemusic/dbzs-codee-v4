# DBZS Codee V4 – Persönlich produktiv nutzbar machen

## Neue Zieldefinition

Codee muss nicht für tausende Nutzer, App-Stores oder öffentliche Releases gehärtet werden.

Für deinen persönlichen produktiven Einsatz reicht:

- stabiler Start auf deinem Windows-System
- zuverlässiges Öffnen deiner Projekte
- funktionierender Chat mit lokalem Modell
- Repository-Review
- Dateiänderungen mit Vorschau
- sichere Rücknahme fehlerhafter Änderungen
- automatische Sicherung
- verständliche Diagnose bei Fehlern

Branch Protection, signierte Installer, Multi-OS-Abnahme und öffentliche Release-Prozesse sind für dich vorerst zweitrangig.

---

## Was jetzt wirklich Priorität hat

### P0 – damit du Codee täglich nutzen kannst

1. **Golden Path festlegen**
   - Codee starten
   - Projektordner öffnen
   - lokales Modell verbinden
   - Projekt indexieren
   - Frage stellen
   - Review starten
   - Änderung als Diff anzeigen
   - Änderung anwenden
   - Tests ausführen
   - Änderung bei Bedarf zurücksetzen

2. **Nur einen stabilen Runtime-Pfad verwenden**
   - zunächst ausschließlich `llama.cpp` oder ausschließlich Ollama
   - keine automatische Provider-Umschaltung
   - keine Cloud-Fallbacks
   - ein festes, bekanntes Modell
   - feste Ports und Modellpfade

3. **Review-Inventar bereinigen**
   Folgende Pfade grundsätzlich ausschließen:

   ```text
   .codee/**
   .git/**
   node_modules/**
   dist/**
   out/**
   build/**
   coverage/**
   .cache/**
   playwright-report/**
   test-results/**
   *.log
   ```

4. **Sicheres Arbeiten erzwingen**
   - vor jeder Dateiänderung Snapshot oder Git-Commit
   - niemals direkt ohne Diff anwenden
   - Änderungen nur innerhalb des geöffneten Workspace
   - Shell-Befehle anzeigen und bestätigen lassen
   - API-Keys und `.env` grundsätzlich sperren

5. **Automatische Sicherung**
   - Einstellungen
   - Codee-Datenbank
   - `.codee`-Arbeitsdaten
   - Runtime-Konfiguration
   - Modellprofile
   - wichtige Logs

---

## Persönlicher Produktionsmodus

Codee sollte einen eigenen Modus erhalten:

```text
PERSONAL_PRODUCTION_MODE=true
```

Dieser Modus aktiviert:

- nur getestete Kernfunktionen
- feste Runtime-Konfiguration
- keine experimentellen Agenten-Flows
- keine automatische Cloud-Nutzung
- Snapshot vor Änderungen
- Diff-Pflicht
- Workspace-Grenzen
- reduzierte Diagnoseausgaben
- automatisches Recovery nach Absturz

Experimentelle Funktionen bleiben sichtbar, aber deutlich als „Labor“ markiert.

---

## Minimale Abnahmekriterien

Codee ist für dich produktiv nutzbar, sobald diese zehn Tests erfolgreich sind:

- [ ] App startet zehnmal hintereinander fehlerfrei
- [ ] vorhandenes Projekt wird korrekt geöffnet
- [ ] lokales Modell verbindet sich automatisch
- [ ] Chat beantwortet Projektfragen
- [ ] Full-Repository-Review erzeugt verwertbare Ergebnisse
- [ ] `.codee` und Build-Artefakte werden nicht analysiert
- [ ] vorgeschlagene Änderungen erscheinen zuerst als Diff
- [ ] Änderung kann angewendet und zurückgenommen werden
- [ ] Projekt-Tests können aus Codee gestartet werden
- [ ] nach App-Absturz gehen keine Projektänderungen verloren

Wenn diese Punkte erfüllt sind, kannst du Codee produktiv einsetzen, auch wenn öffentliche Release-Gates noch fehlen.

---

## Was vorerst nicht nötig ist

Für deinen persönlichen Einsatz kannst du zunächst zurückstellen:

- macOS- und Linux-Pakete
- automatische GitHub-CI
- Branch Protection
- öffentliche Telemetrie
- Auto-Updater
- Code Signing
- Cloud-Skalierung
- Multi-User-Unterstützung
- Plugin Marketplace
- vollständige Barrierefreiheit
- öffentliche Dokumentation

Diese Themen werden erst relevant, wenn Codee verteilt oder verkauft werden soll.

---

## Meine konkrete Empfehlung

Keine neuen Großfeatures mehr beginnen.

Der nächste Entwicklungsblock sollte ausschließlich heißen:

> **Codee Personal Production Stabilization**

Reihenfolge:

1. Review-Inventar reparieren
2. festen lokalen Runtime-Pfad stabilisieren
3. Snapshot-, Diff- und Rollback-Pflicht einbauen
4. Backup und Recovery absichern
5. zehn Golden-Path-Tests durchführen
6. persönliche stabile Version einfrieren
7. danach Codee täglich verwenden und nur echte Alltagsfehler beheben

## Zielversion

Eine sinnvolle persönliche Zielmarke wäre:

```text
DBZS Codee 0.4.0-personal-stable
```

Diese Version muss nicht perfekt sein. Sie muss auf deinem Rechner reproduzierbar funktionieren und deine Projekte sicher behandeln.

## Fazit

Du bist näher an der produktiven Nutzung, als der vorherige öffentliche Release-Maßstab vermuten ließ.

Für deinen persönlichen Einsatz fehlen vor allem:

- ein konsequent begrenzter Funktionsumfang
- ein stabiler Runtime-Pfad
- sichere Dateiänderungen
- Backup und Rollback
- ein bestandener persönlicher Golden Path

Das ist deutlich weniger Arbeit als eine allgemein veröffentlichungsreife Anwendung.
