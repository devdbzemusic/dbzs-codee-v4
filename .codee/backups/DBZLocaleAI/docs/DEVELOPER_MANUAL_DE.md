# DBZ Locale AI - Entwicklerhandbuch

## 1. Einführung

Dieses Entwicklerhandbuch bietet einen detaillierten Einblick in die Architektur, Implementierung und die verwendeten Technologien von **DBZ Locale AI**, einer hybriden KI-Anwendung, die auf den Prinzipien von Division By Zeros (DBZS) basiert. Es richtet sich an Entwickler, die das Projekt erweitern, warten oder verstehen möchten.

## 2. DBZS-Prinzipien und Architektur

DBZ Locale AI folgt strikt den von Ralf Lauckner / DBZS definierten Regeln, um eine wartbare, skalierbare und produktionsnahe Software zu gewährleisten.

### 2.1 Kernprinzipien

*   **UI enthält keine Business-Logik:** Die Benutzeroberfläche ist strikt von der Geschäftslogik getrennt. UI-Komponenten sind für die Darstellung und Benutzerinteraktion zuständig, während die gesamte Logik in der Core Engine oder spezialisierten Services residiert.
*   **AppController / Services / Runtime-Module orchestrieren die Logik:** Die Kernlogik wird durch klar definierte Services und Module verwaltet, die über Interfaces miteinander kommunizieren.
*   **EventBus und Observability sind Pflicht:** Alle relevanten Systemereignisse werden über einen zentralen EventBus verteilt, was eine lose Kopplung und einfache Erweiterbarkeit ermöglicht. Observability wird durch umfassendes Logging sichergestellt.
*   **Jeder relevante Prozess muss geloggt werden:** Kritische Operationen, Fehler und Zustandsänderungen werden detailliert protokolliert, um die Nachvollziehbarkeit und Fehleranalyse zu erleichtern.
*   **Fehler dürfen nicht versteckt werden:** Fehler werden transparent behandelt und protokolliert, um eine schnelle Identifizierung und Behebung zu ermöglichen.
*   **Deutsche Kommentare und Docstrings:** Der Code ist mit deutschen Kommentaren und Docstrings versehen, um die Verständlichkeit zu maximieren.
*   **DBZS Header in Sourcecode-Dateien:** Jede Sourcecode-Datei enthält einen standardisierten DBZS-Header.
*   **Windows-first:** Die Anwendung ist primär für Windows-Systeme entwickelt und optimiert.
*   **Local-first AI bevorzugen:** Die Nutzung lokaler KI-Modelle wird priorisiert, mit optionaler Cloud-Anbindung als Fallback oder Erweiterung.
*   **Cloud nur optional über Adapter:** Cloud-Dienste werden über abstrakte Adapter integriert, um die Austauschbarkeit und lokale Autonomie zu gewährleisten.
*   **DBZS Neon Style für UI:** Ein konsistentes, dunkles UI-Design mit Neon-Blau/Cyan-Akzenten wird für alle Benutzeroberflächen verwendet.

### 2.2 Gesamtarchitektur

DBZ Locale AI ist als hybride Anwendung konzipiert, bestehend aus drei Hauptkomponenten:

1.  **Core Engine (C# .NET):** Enthält die gesamte Geschäftslogik, LLM-Integration, Agenten-Orchestrierung, Konfigurationsverwaltung und Datenzugriff. Sie ist plattformunabhängig und kann von verschiedenen Frontends genutzt werden.
2.  **Windows UI/Forms App (C# .NET WinForms):** Das primäre Desktop-Frontend, das die Core Engine über Services anspricht und eine reichhaltige Benutzeroberfläche bietet.
3.  **Streamlit Webansicht (Python):** Ein leichtgewichtiges Web-Frontend, das ebenfalls mit der Core Engine kommuniziert (potenziell über eine lokale API-Schnittstelle, die von der Core Engine bereitgestellt wird) und eine browserbasierte Interaktion ermöglicht.

```mermaid
graph TD
    subgraph User Interfaces
        A[Windows UI/Forms App] --> C(Core Engine)
        B[Streamlit Webansicht] --> C
    end

    subgraph Core Engine (C# .NET)
        C --> D[LLM Services]
        C --> E[Agent Services]
        C --> F[Runtime Slot Management]
        C --> G[Configuration Service]
        C --> H[Data Service (SQLite)]
        C --> I[EventBus]
        C --> J[Logging]
    end

    subgraph External Services
        D --> K[Lokale LLMs (llama.cpp, Ollama)]
        D --> L[Cloud LLMs (Anthropic, OpenAI, Mistral)]
        E --> M[Tools (Dateisystem, Web, etc.)]
    end

    F --> N[Hardware Detection]
    F --> O[Resource Planning]
    H --> P[SQLite-Datenbank]
    G --> P
```

## 3. Core Engine (C# .NET)

Die Core Engine ist das Rückgrat der Anwendung und implementiert alle kritischen Funktionen.

### 3.1 EventBus (DBZLocaleAI.Core/EventBus/EventBus.cs)

Der `EventBus` ist ein zentrales Publish/Subscribe-System, das eine lose Kopplung zwischen den Komponenten ermöglicht. Er unterstützt synchrone und asynchrone Event-Verarbeitung.

*   **`Subscribe<TEvent>(Action<TEvent> handler)`:** Registriert einen synchronen Event-Handler.
*   **`SubscribeAsync<TEvent>(Func<TEvent, Task> handler)`:** Registriert einen asynchronen Event-Handler.
*   **`Publish<TEvent>(TEvent @event)`:** Veröffentlicht ein Event synchron.
*   **`PublishAsync<TEvent>(TEvent @event)`:** Veröffentlicht ein Event asynchron.

### 3.2 Logging (DBZLocaleAI.Core/Utils/Logger.cs)

Das `Logger`-Framework bietet eine einheitliche Schnittstelle für die Protokollierung von Ereignissen. Es unterstützt verschiedene Log-Level (`Debug`, `Info`, `Warning`, `Error`, `Critical`) und kann für die Ausgabe in Dateien und die Konsole konfiguriert werden.

### 3.3 LLM Services (DBZLocaleAI.Core/LLM/ILLMService.cs)

Das `ILLMService`-Interface definiert die Schnittstelle für die Interaktion mit Sprachmodellen, abstrahiert von der spezifischen Implementierung (lokal oder Cloud).

*   **`GenerateResponseAsync(string modelId, string prompt)`:** Generiert eine Textantwort basierend auf einem Prompt.
*   **`StreamResponseAsync(string modelId, string prompt)`:** Streamt die Textantwort in Echtzeit.
*   **`GetAvailableModelsAsync()`:** Listet alle konfigurierten und verfügbaren Modelle auf.

**Geplante Implementierungen:**
*   **`LlamaCppService`:** Integration von `llama.cpp` für lokale LLaMA-Modelle, Nutzung von GPU-Beschleunigung über `llama.cpp` Bindings.
*   **`OllamaService`:** Integration von Ollama für einfache Verwaltung und Ausführung lokaler Modelle.
*   **`AnthropicService`:** Anbindung an die Anthropic Claude API.
*   **`OpenAIService`:** Anbindung an die OpenAI API.
*   **`MistralService`:** Anbindung an die Mistral AI API.

### 3.4 Runtime Slot Management (DBZLocaleAI.Core/Runtime/ISlotManager.cs, HardwareDetector.cs, ResourcePlanner.cs)

Dieses Modul ist inspiriert von DBZS Codee und verwaltet die Zuweisung von Modellen zu Hardware-Ressourcen (Slots) für optimale Performance.

*   **`ISlotManager`:** Interface für die Verwaltung von Slots (Start, Stopp, Restart, Statusabfrage).
*   **`HardwareDetector.cs`:** Erkennt die Systemhardware (CPU, RAM, NVIDIA GPU). Nutzt `nvidia-smi` für detaillierte GPU-Informationen und `wmic` für Windows-spezifische Daten.
    *   **Hardware:** `Nvidia Gforce GTX 1650` + `Intel(R) Core(TM) i7-3770 CPU @ 3.40GHz 3.90 GHz` + `32 GB Ram` werden erkannt und für die Ressourcenplanung berücksichtigt.
*   **`ResourcePlanner.cs`:** Berechnet basierend auf der verfügbaren Hardware und dem Modelltyp einen optimalen Resource-Plan (z.B. Anzahl der GPU-Layer, Kontextgröße, Batch-Größe). Berücksichtigt Sicherheitsreserven für VRAM und RAM, insbesondere für Systeme mit geringerem VRAM wie der GTX 1650.
*   **`SlotProfile`:** Definiert Profile wie `FastGpu`, `QualityCpu`, `Utility` und `OrchestratorCpu` zur Priorisierung der Ressourcennutzung.

### 3.5 Multi-Agenten-System (DBZLocaleAI.Core/Agents/IAgentService.cs)

Das `IAgentService`-Interface definiert die Orchestrierung von spezialisierten KI-Agenten, die komplexe Aufgaben in mehreren Schritten ausführen können.

*   **`AgentRole`:** Definiert Rollen wie `Planner`, `Coder`, `Reviewer`, `Debugger`, `Tester`, `Documenter`.
*   **`Tool`:** Abstraktion für Tools, die Agenten nutzen können (Dateisystem, Code-Ausführung, Suche, etc.).
*   **`AgentDefinition`:** Beschreibung eines Agenten, einschließlich System-Prompt und verfügbarer Tools.
*   **`AgentTask`:** Repräsentiert eine auszuführende Aufgabe für einen Agenten.

### 3.6 Konfigurationssystem (DBZLocaleAI.Core/Configuration/IConfigurationService.cs, ConfigurationService.cs)

Das Konfigurationssystem verwaltet alle anwendungsspezifischen Einstellungen, API-Schlüssel und Modell-Konfigurationen. Die Persistenz erfolgt über den `DatabaseService` in einer verschlüsselten SQLite-Datenbank.

*   **`ApiProviderConfig`:** Speichert Konfigurationen für Cloud-APIs (API-Key, Base URL, Aktivierungsstatus).
*   **`ModelConfig`:** Speichert Konfigurationen für lokale und remote Modelle (Pfad, Provider, Parameter).
*   **`ApplicationSettings`:** Allgemeine Anwendungseinstellungen (Pfade, UI-Theme, etc.).
*   **`ConfigurationService`:** Implementiert die Lade- und Speicherlogik für alle Einstellungen.

### 3.7 Datenzugriff (DBZLocaleAI.Core/Data/DatabaseService.cs)

Der `DatabaseService` kapselt den Zugriff auf die lokale SQLite-Datenbank (`dbz_locale_ai.db`). Er ist für die Initialisierung der Datenbank, das Erstellen von Tabellen und die Ausführung von CRUD-Operationen zuständig.

*   **Tabellen:** `Settings`, `ApiProviders`, `Models`, `Projects`, `ChatMessages`, `AgentTasks`.
*   **Verschlüsselung:** Sensible Daten wie API-Schlüssel werden verschlüsselt gespeichert.

## 4. Windows UI/Forms App (C# .NET WinForms)

Das Desktop-Frontend bietet eine reichhaltige, interaktive Benutzeroberfläche.

### 4.1 UI-Styling (DBZLocaleAI.WinForms/Styles/NeonStyle.cs)

Der `NeonStyle`-Klasse definiert das visuelle Erscheinungsbild der Anwendung gemäß den DBZS-Vorgaben:

*   **Farben:** `Background` (`#0a0a0f`), `PanelBackground` (`#14141e`), `NeonBlue` (`#00b4ff`), `NeonCyan` (`#00ffff`).
*   **Schriftarten:** `Segoe UI` für Haupttexte, `Consolas` für Code/Logs.
*   **Anwendung:** Die `Apply`-Methode wendet den Stil rekursiv auf Controls an.

### 4.2 Hauptformular (DBZLocaleAI.WinForms/Forms/MainForm.cs)

Das `MainForm` ist das Hauptfenster der Anwendung und orchestriert die verschiedenen Ansichten.

*   **Sidebar:** Navigation zu den Hauptbereichen (Chat, Agenten, Einstellungen).
*   **Runtime Slots Panel:** Visuelle Darstellung der aktiven Runtime Slots und ihrer Modelle.
*   **Statusleiste:** Zeigt Echtzeit-Hardware-Metriken (GPU, CPU, RAM) an.

### 4.3 Chat-Formular (DBZLocaleAI.WinForms/Forms/ChatForm.cs)

Das `ChatForm` ermöglicht die Benutzerinteraktion mit LLMs.

*   **Modell-Auswahl:** `ComboBox` zur Auswahl des aktiven LLM.
*   **Chat-Verlauf:** `RichTextBox` zur Anzeige der Konversation.
*   **Eingabe:** `TextBox` für Benutzereingaben, `Button` zum Senden.

### 4.4 Agenten-Formular (DBZLocaleAI.WinForms/Forms/AgentForm.cs)

Das `AgentForm` dient zur Steuerung des Multi-Agenten-Systems.

*   **Agenten-Liste:** Anzeige verfügbarer Agenten.
*   **Aufgaben-Eingabe:** `TextBox` zur Definition von Agenten-Aufgaben.
*   **Task Monitor:** `RichTextBox` zur Anzeige der Agenten-Ausgaben und des Fortschritts.

### 4.5 Einstellungs-Formular (DBZLocaleAI.WinForms/Forms/SettingsForm.cs)

Das `SettingsForm` bietet eine umfassende Konfigurationsmöglichkeit.

*   **Tab-Struktur:** Organisiert Einstellungen in Kategorien (API-Keys, Modelle, Hardware, Plugins, Allgemein).
*   **API-Key-Eingabe:** `TextBox` für API-Schlüssel mit `UseSystemPasswordChar` für Sicherheit.
*   **Modell-Auswahl:** `CheckedListBox` für lokale Modelle, `TextBox` für Modellpfade.
*   **Hardware-Einstellungen:** Anzeige der erkannten Hardware und Optionen zur Performance-Optimierung (z.B. GPU-Layer).

## 5. Streamlit Webansicht (Python)

Die Streamlit-Anwendung bietet eine alternative, browserbasierte Benutzeroberfläche.

### 5.1 UI-Styling (DBZLocaleAI.Streamlit/utils/style.py)

Die `apply_neon_style`-Funktion injiziert benutzerdefiniertes CSS, um den DBZS Neon Style in Streamlit zu replizieren.

*   **Hintergrund:** Dunkle Farben (`#0a0a0f`, `#14141e`).
*   **Akzente:** Neon-Blau/Cyan für Überschriften und Buttons.
*   **`neon_panel`:** Eine Hilfsfunktion zum Erstellen von Panels im DBZS-Stil.

### 5.2 Hauptanwendung (DBZLocaleAI.Streamlit/app.py)

Die `app.py` ist der Einstiegspunkt der Streamlit-Anwendung.

*   **`st.set_page_config`:** Konfiguriert den Seitentitel, Icon und Layout.
*   **Session State:** Verwaltet den Navigationsstatus (`st.session_state.current_page`).
*   **Dashboard:** Zeigt Systemmetriken und Runtime Slot-Status an.

### 5.3 Sidebar (DBZLocaleAI.Streamlit/components/sidebar.py)

Die Sidebar enthält die Navigation und Statusinformationen.

*   **Navigation:** Buttons für Dashboard, Chat, Agenten, Einstellungen.
*   **System Status:** Zeigt den Status der Core Engine, lokaler LLMs und Cloud-APIs an.

### 5.4 Chat, Agenten, Einstellungen (components/*.py)

Separate Python-Dateien (`chat_interface.py`, `agent_interface.py`, `settings_interface.py`) implementieren die jeweiligen UI-Komponenten für Streamlit, die mit der Core Engine über eine (noch zu implementierende) lokale API kommunizieren.

## 6. Verwendete Technologien und Bibliotheken

### 6.1 C# / .NET

*   **Sprache:** C# 10/11
*   **.NET Framework:** .NET 6/7 (oder neuer)
*   **UI-Framework:** Windows Forms
*   **Datenbank:** `System.Data.SQLite` (für SQLite-Interaktion)
*   **Logging:** `Microsoft.Extensions.Logging` (oder eine einfache Custom-Implementierung)
*   **Webview:** `Microsoft.Web.WebView2.WinForms` (für die Integration der Streamlit Webansicht)

### 6.2 Python

*   **Sprache:** Python 3.9+
*   **Web-Framework:** Streamlit
*   **LLM-Bibliotheken:**
    *   `llama-cpp-python` (für `llama.cpp` Bindings)
    *   `ollama` (für Ollama-Integration)
    *   `anthropic`, `openai`, `mistralai` (für Cloud-API-Anbindungen)
*   **Weitere:** `pandas`, `plotly` (für Dashboard-Visualisierungen)

### 6.3 Datenbank

*   **SQLite:** Eine leichtgewichtige, dateibasierte relationale Datenbank, ideal für lokale Anwendungen.

### 6.4 LLM-Modelle (Beispiele)

*   **Lokal:**
    *   `Llama-3.2-1B-Instruct-Q4_0` (GGUF-Format für `llama.cpp`)
    *   `Llama-3.2-3B-Instruct-Q4_0` (GGUF-Format für `llama.cpp`)
    *   `mistral-7B-Instruct-v0.3` (GGUF-Format für `llama.cpp` oder Ollama)
    *   `mistral-7b-instruct-v0.1.Q4_0` (GGUF-Format für `llama.cpp` oder Ollama)
*   **Cloud-API:**
    *   `Claude 3.5 Sonnet` (Anthropic API)
    *   `GPT-4o` (OpenAI API)
    *   `Mistral Large` (Mistral AI API)

## 7. Entwicklungsworkflow und Best Practices

*   **Code-Struktur:** Das Projekt ist in `DBZLocaleAI.Core`, `DBZLocaleAI.WinForms`, `DBZLocaleAI.Streamlit` und `DBZLocaleAI.Plugins` unterteilt, um eine klare Trennung der Verantwortlichkeiten zu gewährleisten.
*   **Dependency Injection:** Services und Abhängigkeiten sollten über Dependency Injection verwaltet werden, um die Testbarkeit und Wartbarkeit zu verbessern.
*   **Asynchrone Programmierung:** Intensive Nutzung von `async`/`await` in C# und asynchronen Operationen in Python, um die UI reaktionsfähig zu halten.
*   **Fehlerbehandlung:** Robuste Fehlerbehandlung mit `try-catch`-Blöcken und detaillierter Protokollierung.
*   **Sicherheit:** API-Schlüssel und andere sensible Daten werden verschlüsselt in der SQLite-Datenbank gespeichert.
*   **Performance-Optimierung:** Der `ResourcePlanner` und die `SlotManager`-Implementierung sind entscheidend für die optimale Nutzung der Hardware, insbesondere der GPU.
*   **Plugin-Architektur:** Das `DBZLocaleAI.Plugins`-Projekt bietet eine Schnittstelle für die Erweiterung der Anwendung, z.B. durch neue LLM-Provider oder Agenten-Tools.

## 8. Nächste Schritte für Entwickler

1.  **Implementierung der LLM-Provider:** Konkrete Implementierung der `ILLMService`-Schnittstelle für `llama.cpp`, Ollama und die Cloud-APIs.
2.  **Implementierung des Slot Managers:** Implementierung des `ISlotManager` zur Steuerung der LLM-Prozesse und zur Interaktion mit `HardwareDetector` und `ResourcePlanner`.
3.  **Implementierung des Agenten-Systems:** Ausbau des `IAgentService` mit konkreten Agenten-Implementierungen und Tool-Integrationen.
4.  **Datenbank-Integration:** Vollständige Integration des `DatabaseService` in die `ConfigurationService` und andere Services.
5.  **UI-Anbindung:** Verbindung der UI-Elemente in WinForms und Streamlit mit den Services der Core Engine.
6.  **Tests:** Umfassende Unit- und Integrationstests für alle Komponenten.

---

**© 2025 Division By Zeros (DBZS)**

*Dieses Dokument wurde von Manus AI im Auftrag von Ralf Lauckner / Division By Zeros (DBZS) erstellt.*
