# DBZ Locale AI - Benutzerhandbuch

## 1. Einführung

Willkommen bei **DBZ Locale AI** – Ihrer umfassenden lokalen KI-Anwendung, entwickelt von Division By Zeros (DBZS). DBZ Locale AI bietet Ihnen eine leistungsstarke Plattform zur Interaktion mit lokalen und cloudbasierten Sprachmodellen (LLMs) sowie zur Orchestrierung spezialisierter KI-Agenten. Unser Ziel ist es, Ihnen die volle Kontrolle über Ihre KI-Werkzeuge und Daten zu geben, mit einem Fokus auf Performance, Anpassbarkeit und Benutzerfreundlichkeit.

Dieses Handbuch führt Sie durch die Installation, Konfiguration und Nutzung von DBZ Locale AI, sowohl über die Windows UI/Forms App als auch über die Streamlit Webansicht.

## 2. Installation und Systemanforderungen

### 2.1 Systemanforderungen

DBZ Locale AI ist für Windows-Systeme optimiert und nutzt Ihre Hardware, insbesondere NVIDIA GPUs, für maximale Leistung. Die Anwendung kann jedoch auch auf CPU-Basis betrieben werden.

**Minimale Anforderungen:**
*   **Betriebssystem:** Windows 10 (64-bit) oder neuer
*   **Prozessor:** Intel Core i5 oder AMD Ryzen 5 (oder vergleichbar)
*   **RAM:** 16 GB
*   **Grafikkarte:** NVIDIA GeForce GTX 1050 (oder vergleichbar) mit mindestens 4 GB VRAM für GPU-Beschleunigung
*   **Speicher:** 50 GB freier Speicherplatz

**Empfohlene Anforderungen:**
*   **Betriebssystem:** Windows 10/11 (64-bit)
*   **Prozessor:** Intel Core i7 (3. Generation oder neuer) oder AMD Ryzen 7 (oder vergleichbar)
*   **RAM:** 32 GB oder mehr
*   **Grafikkarte:** NVIDIA GeForce GTX 1650 (oder besser) mit mindestens 4 GB VRAM für optimale GPU-Beschleunigung
*   **Speicher:** 100 GB freier Speicherplatz (SSD empfohlen)

### 2.2 Installation

Die Installation von DBZ Locale AI erfolgt in wenigen Schritten:

1.  **Herunterladen:** Laden Sie das Installationspaket von der offiziellen DBZS-Website herunter.
2.  **Ausführen:** Starten Sie die `DBZLocaleAI_Setup.exe` und folgen Sie den Anweisungen des Installationsassistenten.
3.  **Erster Start:** Nach der Installation finden Sie die Anwendung im Startmenü. Beim ersten Start werden notwendige Komponenten initialisiert und eine lokale SQLite-Datenbank eingerichtet.

## 3. Die Windows UI/Forms App

Die Windows UI/Forms App ist das Herzstück von DBZ Locale AI und bietet eine umfassende Benutzeroberfläche im **DBZS Neon Style**.

### 3.1 Hauptfenster (MainForm)

Das Hauptfenster dient als zentrales Dashboard und bietet Zugriff auf alle Funktionen:

*   **Sidebar:** Navigationsleiste auf der linken Seite mit folgenden Bereichen:
    *   **Dashboard:** Übersicht über Systemstatus, aktive Modelle und Agenten.
    *   **Chat:** Interaktion mit Sprachmodellen.
    *   **Agenten:** Verwaltung und Orchestrierung von KI-Agenten.
    *   **Modelle:** Konfiguration und Download von LLMs.
    *   **Projekte:** Verwaltung Ihrer KI-Projekte.
    *   **Einstellungen:** Globale Anwendungseinstellungen.
*   **Runtime Slots Panel:** Zeigt den Status der zugewiesenen Hardware-Slots (z.B. `fast_gpu`, `quality_cpu`, `utility`) und der darauf geladenen Modelle an. Hier können Sie Modelle starten, stoppen oder neu starten.
*   **Statusleiste:** Am unteren Rand des Fensters werden wichtige Systeminformationen wie GPU-Auslastung, CPU-Nutzung und RAM-Verbrauch angezeigt.

### 3.2 Chat-Funktion (ChatForm)

Der Chat-Bereich ermöglicht die direkte Kommunikation mit Ihren konfigurierten Sprachmodellen.

*   **Modell-Auswahl:** Wählen Sie aus einer Liste verfügbarer lokaler oder API-basierter Modelle.
*   **Chat-Verlauf:** Zeigt die Konversation mit dem ausgewählten Modell an.
*   **Eingabefeld:** Geben Sie hier Ihre Nachrichten ein. Drücken Sie `Strg + Enter` zum Senden.
*   **Senden-Button:** Sendet Ihre Nachricht an das Modell.
*   **Löschen-Button:** Löscht den aktuellen Chat-Verlauf.
*   **Exportieren-Button:** Exportiert den Chat-Verlauf als Text- oder RTF-Datei.

### 3.3 Agenten-Workbench (AgentForm)

Die Agenten-Workbench ist Ihr Kontrollzentrum für das Multi-Agenten-System.

*   **Verfügbare Agenten:** Eine Liste vordefinierter Agenten-Rollen (z.B. Planner, Coder, Reviewer, Debugger).
*   **Aufgaben-Eingabe:** Beschreiben Sie hier die Aufgabe, die ein Agent ausführen soll.
*   **Start/Stopp-Buttons:** Starten oder stoppen Sie die Ausführung einer Agenten-Aufgabe.
*   **Task Monitor:** Zeigt den Fortschritt und die Ausgaben der Agenten in Echtzeit an.

### 3.4 Einstellungen (SettingsForm)

Im Einstellungsbereich können Sie DBZ Locale AI an Ihre Bedürfnisse anpassen.

*   **API-Einstellungen:** Konfigurieren Sie API-Schlüssel und Endpunkte für Cloud-Dienste wie OpenAI, Anthropic Claude und Mistral AI.
*   **Modell-Einstellungen:** Verwalten Sie lokale Modelle, deren Pfade und spezifische Parameter (z.B. `max_tokens`, `temperature`, GPU-Layer).
*   **Allgemeine Einstellungen:** Konfigurieren Sie Speicherpfade für Projekte, automatische Speicherfunktionen und Cloud-Speicherintegrationen (Google Drive, OneDrive).
*   **UI-Einstellungen:** Passen Sie das Erscheinungsbild der Anwendung an (z.B. Theme, Schriftgröße).

## 4. Die Streamlit Webansicht

Die Streamlit Webansicht bietet eine browserbasierte Schnittstelle zu DBZ Locale AI, ideal für den Zugriff über das Netzwerk oder für eine schlankere Benutzeroberfläche. Sie spiegelt die Kernfunktionen der Windows App wider.

### 4.1 Starten der Webansicht

1.  Öffnen Sie ein Terminal oder die PowerShell im Verzeichnis `src/DBZLocaleAI.Streamlit`.
2.  Führen Sie den Befehl `streamlit run app.py` aus.
3.  Die Webansicht wird in Ihrem Standardbrowser unter `http://localhost:8501` geöffnet.

### 4.2 Navigation und Funktionen

Die Streamlit-Oberfläche ist ähnlich der Windows App strukturiert:

*   **Sidebar:** Enthält Navigationslinks zu Dashboard, Chat, Agenten und Einstellungen sowie Systemstatus-Informationen.
*   **Dashboard:** Bietet eine Übersicht über aktive Modelle, Chat-Nachrichten, Agenten-Tasks und Systemmetriken.
*   **Chat, Agenten, Einstellungen:** Diese Bereiche bieten ähnliche Funktionen wie ihre Pendants in der Windows App, angepasst an die Web-Umgebung.

## 5. Projekte und Datenverwaltung

DBZ Locale AI ermöglicht die Verwaltung Ihrer Projekte, Chat-Verläufe und generierten Dateien.

*   **Projektordner:** Alle projektspezifischen Daten (Chats, Agenten-Outputs, Konfigurationen) werden in einem dedizierten Projektordner gespeichert.
*   **SQLite-Datenbank:** Eine lokale SQLite-Datenbank (`dbz_locale_ai.db`) speichert alle Konfigurationen, Modell-Metadaten und Projektinformationen sicher und verschlüsselt.
*   **Cloud-Integration:** Optionale Integration mit Google Drive und OneDrive für die Speicherung und Synchronisierung von Projektdaten.

## 6. Erweiterbarkeit (Plugins)

DBZ Locale AI ist modular aufgebaut und unterstützt die Erweiterung durch Plugins. Im Einstellungsbereich können Sie Plugins verwalten und aktivieren, um neue Funktionen, Modelle oder Agenten-Tools hinzuzufügen.

## 7. Fehlerbehebung und Support

Bei Problemen konsultieren Sie bitte das Entwicklerhandbuch oder die Online-Dokumentation. Für weitere Unterstützung besuchen Sie die offizielle DBZS-Website oder kontaktieren Sie den Support.

---

**© 2025 Division By Zeros (DBZS)**

*Dieses Dokument wurde von Manus AI im Auftrag von Ralf Lauckner / Division By Zeros (DBZS) erstellt.*
