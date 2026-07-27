# Architektur-Entwurf: DBZ Locale AI

## 1. Einleitung

Dieses Dokument beschreibt den Architektur-Entwurf für "DBZ Locale AI", eine hybride Anwendung, die eine Windows UI/Forms App und eine Streamlit-Webansicht kombiniert. Das Design orientiert sich stark an den bewährten Prinzipien und der Architektur des "DBZS Codee"-Referenzprojekts, um eine robuste, performante und erweiterbare Plattform für lokale und Cloud-basierte KI-Interaktionen zu schaffen. Besondere Berücksichtigung finden dabei die vom Benutzer bereitgestellten Hardware-Spezifikationen (Nvidia GeForce GTX 1650, Intel Core i7-3770, 32 GB RAM).

## 2. DBZS-Prinzipien und -Anforderungen

Die Entwicklung von "DBZ Locale AI" folgt den strengen DBZS-Regeln:

*   **UI enthält keine Business-Logik:** Trennung von Präsentation und Logik.
*   **AppController / Services / Runtime-Module:** Orchestrierung der Logik.
*   **EventBus und Observability:** Pflicht für Kommunikation und Überwachung.
*   **Jeder relevante Prozess muss geloggt werden:** Umfassende Protokollierung.
*   **Fehler dürfen nicht versteckt werden:** Transparente Fehlerbehandlung.
*   **Deutsche Kommentare und Docstrings:** Einheitliche Dokumentation.
*   **DBZS Header in Sourcecode-Dateien:** Standardisierte Dateiköpfe.
*   **Windows-first:** Optimierung für Windows-Umgebungen.
*   **Local-first AI bevorzugen:** Lokale Ausführung als Standard.
*   **Cloud nur optional über Adapter:** Flexible Cloud-Integration.
*   **DBZS Neon Style für UI:** Dunkles Tech-Design mit Neon-Akzenten.

## 3. Gesamtarchitektur von DBZ Locale AI

Die Anwendung wird eine mehrschichtige Architektur aufweisen, die die Vorteile einer nativen Windows-Anwendung mit der Flexibilität einer Web-Oberfläche verbindet. Das Herzstück bildet eine robuste Core Engine, die für die LLM-Interaktion, Agenten-Orchestrierung und Ressourcenverwaltung zuständig ist.

```mermaid
graph TD
    subgraph User Interfaces
        A[Windows UI/Forms App] -->|IPC/API| C(Core Engine)
        B[Streamlit Webansicht] -->|HTTP/API| C
    end

    subgraph Core Engine (C# / Python Interop)
        C --> D[LLM-Integration (Lokal/API)]
        C --> E[Multi-Agenten-System]
        C --> F[Runtime Slot Management]
        C --> G[Konfigurations- & Datenmanagement (SQLite)]
        C --> H[EventBus & Logging]
    end

    subgraph LLM Provider
        D --> I[Llama.cpp (lokal)]
        D --> J[Ollama (lokal)]
        D --> K[Anthropic API (Cloud)]
        D --> L[Mistral API (Cloud)]
        D --> M[OpenAI API (Cloud)]
    end

    subgraph System Services
        F --> N[Hardware-Erkennung & Resource Planner]
        G --> O[SQLite-Datenbank]
        H --> P[Logging-Framework]
    end

    N --> Q[Nvidia GPU (GTX 1650)]
    N --> R[Intel CPU (i7-3770)]
    N --> S[RAM (32 GB)]
```

**Erläuterung der Komponenten:**

*   **Windows UI/Forms App:** Die primäre Benutzeroberfläche für Windows-Benutzer, entwickelt in C#. Sie bietet eine native, reaktionsschnelle Erfahrung und direkten Zugriff auf lokale Ressourcen. Die UI wird dem DBZS Neon Style folgen.
*   **Streamlit Webansicht:** Eine optionale, browserbasierte Schnittstelle, die über einen lokalen Webserver (Python/Streamlit) bereitgestellt wird. Sie ermöglicht den Zugriff auf die Kernfunktionen über einen Webbrowser und kann für Remote-Zugriff oder alternative UI-Präferenzen genutzt werden. Auch hier wird der DBZS Neon Style angestrebt.
*   **Core Engine:** Das Herzstück der Anwendung, verantwortlich für die gesamte Business-Logik. Es wird eine Interoperabilität zwischen C# und Python nutzen, um die Stärken beider Sprachen zu kombinieren (z.B. C# für die Systemintegration und Python für LLM-Bibliotheken).
    *   **LLM-Integration:** Verwaltet die Kommunikation mit lokalen LLM-Runtimes (z.B. `llama.cpp`, Ollama) und Cloud-APIs (Anthropic, Mistral, OpenAI). Bietet eine einheitliche Schnittstelle für die Modellinteraktion.
    *   **Multi-Agenten-System:** Orchestriert verschiedene KI-Agenten, die spezifische Aufgaben ausführen können (z.B. Code-Analyse, Planung, Debugging). Dies wird die DBZS-Agentenlogik aus dem Referenzprojekt adaptieren.
    *   **Runtime Slot Management:** Ein zentrales Feature, das die effiziente Zuweisung und Verwaltung von LLM-Modellen zu dedizierten Hardware-Slots (GPU/CPU) ermöglicht. Dies ist direkt vom DBZS Codee-Projekt inspiriert und wird für optimale Performance auf der spezifischen Hardware des Benutzers konfiguriert.
    *   **Konfigurations- & Datenmanagement:** Verwaltet Anwendungseinstellungen, API-Schlüssel, Modellpfade und Benutzerdaten. SQLite wird als lokale Datenbank für persistente Speicherung verwendet.
    *   **EventBus & Logging:** Ein zentrales System für die interne Kommunikation zwischen Komponenten und die umfassende Protokollierung aller relevanten Prozesse und Fehler.
*   **LLM Provider:** Die tatsächlichen Schnittstellen zu den Sprachmodellen, sowohl lokal als auch über Cloud-APIs.
*   **System Services:** Unterstützende Dienste wie Hardware-Erkennung und der Resource Planner, die für die intelligente Ressourcenzuweisung unerlässlich sind.

## 4. Detaillierter Entwurf der Core Engine

Die Core Engine wird in C# entwickelt, um eine nahtlose Integration in die Windows UI/Forms App zu gewährleisten. Für die LLM-Interaktion und Agenten-Logik, die oft Python-Bibliotheken nutzen, wird eine robuste Interoperabilitätsschicht implementiert. Dies kann über `Python.NET` oder durch die Kommunikation mit einem separaten Python-Backend (ähnlich dem FastAPI-Backend im DBZS-Referenzprojekt) erfolgen.

### 4.1 LLM-Integration

Die LLM-Integration wird eine Abstraktionsschicht bieten, die es ermöglicht, verschiedene LLM-Modelle und APIs über eine einheitliche Schnittstelle anzusprechen. Die `ILLMService`-Schnittstelle (siehe `DBZLocaleAI.Core/Interfaces/ILLMService.cs`) wird die Grundlage bilden.

**Schlüsselkonzepte:**

*   **Modell-Adapter:** Für jeden LLM-Provider (llama.cpp, Ollama, Anthropic, Mistral, OpenAI) wird ein spezifischer Adapter implementiert, der die Provider-spezifischen API-Aufrufe und Datenformate kapselt.
*   **Lokale Modelle:** Integration von `llama.cpp` (gguf-Modelle) und Ollama für lokale Inferenz. Dies wird die Nutzung der GPU (Nvidia GTX 1650) und CPU (i7-3770) optimieren.
    *   **`llama.cpp`:** Direkte Einbindung über C# Bindings (falls verfügbar) oder über einen Wrapper, der die `llama.cpp`-Binaries aufruft. Der `Resource Planner` wird die `n_gpu_layers` basierend auf der verfügbaren VRAM der GTX 1650 dynamisch anpassen.
    *   **Ollama:** Kommunikation über die Ollama API (standardmäßig `http://127.0.0.1:11434`). Der Benutzer kann Ollama-Modelle herunterladen und verwalten.
*   **Cloud-APIs:** Integration von Anthropic (Claude 3.5 Sonnet), Mistral und OpenAI APIs. API-Schlüssel werden sicher in der SQLite-Datenbank gespeichert und über das Konfigurationssystem verwaltet.
*   **Fallback-Mechanismus:** Wenn lokale Modelle nicht verfügbar sind oder die Anfrage spezielle Fähigkeiten erfordert, wird ein konfigurierbarer Fallback auf Cloud-APIs implementiert.

### 4.2 Multi-Agenten-System

Das Multi-Agenten-System wird die DBZS-Agentenlogik nachbilden, um komplexe Aufgaben durch die Orchestrierung spezialisierter Agenten zu lösen. Die `IAgentService`-Schnittstelle (siehe `DBZLocaleAI.Core/Interfaces/IAgentService.cs`) wird die Agentenverwaltung und -ausführung definieren.

**Schlüsselkonzepte:**

*   **Agenten-Definition:** Agenten werden durch ihre Rolle, Beschreibung, Fähigkeiten und die zu verwendenden Tools definiert. Dies wird in der SQLite-Datenbank gespeichert.
*   **Tool-Registry:** Ein Mechanismus zur Registrierung und Verwaltung von Tools, die Agenten nutzen können (z.B. Code-Interpreter, Dateisystemzugriff, Web-Suche).
*   **Aufgaben-Orchestrierung:** Ein zentraler Controller, der Benutzeranfragen analysiert, den am besten geeigneten Agenten auswählt und die Ausführung der Aufgabe überwacht. Dies beinhaltet die Fähigkeit zur Multi-Step-Execution und zur Fehlerbehandlung.
*   **Observability:** Umfassendes Logging und Status-Updates für jede Agentenaufgabe, um Transparenz und Debugging zu ermöglichen.

### 4.3 Runtime Slot Management

Das Runtime Slot Management ist entscheidend für die Performance und Ressourceneffizienz. Es wird die dynamische Zuweisung von LLM-Modellen zu spezifischen Hardware-Slots (GPU/CPU) steuern, basierend auf der Aufgabenart und den verfügbaren Ressourcen.

**Schlüsselkonzepte:**

*   **Slot-Definition:** Vordefinierte Slots wie `fast_gpu`, `quality_cpu`, `utility` (analog zum DBZS Codee-Projekt). Jeder Slot ist für bestimmte Modelltypen oder Aufgaben optimiert.
*   **Hardware-Erkennung:** Beim Start der Anwendung wird die Hardware des Benutzers (Nvidia GTX 1650, i7-3770, 32 GB RAM) erkannt. Dies ist die Grundlage für den Resource Planner.
*   **Resource Planner:** Ein intelligenter Algorithmus, der basierend auf dem ausgewählten Modell, dem Slot-Profil und der verfügbaren Hardware (insbesondere VRAM der GTX 1650) die optimalen Parameter für das Laden des Modells berechnet (z.B. `n_gpu_layers`, Kontextgröße).
    *   Für die GTX 1650 (4GB VRAM) wird der Planner darauf abzielen, so viele Schichten wie möglich auf die GPU auszulagern, ohne einen Out-Of-Memory (OOM) Fehler zu verursachen. Kleinere Modelle (z.B. Llama-3.2-1B-Instruct-Q4_0, Mistral-7B-Instruct-v0.3.Q4_0) werden bevorzugt vollständig auf die GPU geladen.
*   **Dynamisches Laden/Entladen:** Modelle werden bei Bedarf in die Slots geladen und bei Inaktivität oder Ressourcenknappheit entladen, um VRAM und RAM effizient zu nutzen.
*   **Start/Stop/Restart-Funktionalität:** Direkte Kontrolle über die Slots, wie im DBZS Codee-Projekt beschrieben.

## 5. Datenbank und Konfigurationssystem (SQLite)

Ein zentrales Konfigurations- und Datenmanagementsystem wird alle relevanten Einstellungen und Benutzerdaten persistent speichern.

**Schlüsselkonzepte:**

*   **SQLite:** Eine leichte, dateibasierte Datenbank, ideal für lokale Anwendungen. Sie wird für die Speicherung von:
    *   Anwendungseinstellungen (API-Schlüssel, Modellpfade, UI-Einstellungen)
    *   Agenten-Definitionen und deren Historie
    *   Chat-Verläufe und Projektinformationen
    *   Modell-Metadaten und Resource Plans
*   **Konfigurationsdienst:** Eine C#-Klasse, die das Laden, Speichern und Aktualisieren von Einstellungen in der SQLite-Datenbank abstrahiert. API-Schlüssel werden verschlüsselt gespeichert.
*   **Projektmanagement:** Benutzer können Projekte erstellen, speichern und laden. Jedes Projekt enthält seine eigenen Chat-Verläufe, Agenten-Aufgaben und spezifische Einstellungen.
*   **Cloud-Synchronisation (optional):** Eine optionale Integration mit Google Drive oder OneDrive für die Sicherung und Synchronisation von Projektdaten.

## 6. UI/UX Design (DBZS Neon Style)

Die Benutzeroberflächen (Windows UI/Forms und Streamlit) werden dem "DBZS Neon Style" folgen, um ein konsistentes und ansprechendes Benutzererlebnis zu bieten.

**Schlüsselkonzepte:**

*   **Dark-First Interfaces:** Dunkle Farbpaletten als Standard.
*   **Neon-inspirierte Hierarchie:** Verwendung von Neon-Blau/Cyan für Akzente, Hervorhebungen und interaktive Elemente.
*   **Klare Panels und Splitter:** Modulare Layouts mit klar definierten Bereichen und Trennlinien.
*   **Realtime Status Indicators:** Visuelles Feedback für laufende Prozesse, Modellstatus und Agentenaktivitäten.
*   **Minimalistisches Design:** Vermeidung von überladenen Dashboards und unnötigen Animationen.
*   **Tooltips und PDF Help File:** Umfassende Erklärungen für alle Einstellungen und Funktionen.

## 7. Interoperabilität C# und Python

Um die Vorteile beider Ökosysteme zu nutzen, wird eine Interoperabilitätsschicht geschaffen:

*   **C# als primäre Sprache:** Für die Windows UI/Forms App und die Kernlogik der Core Engine.
*   **Python für LLM-Bibliotheken:** Nutzung von Python für `llama.cpp` (z.B. über `ctypes` oder einen Wrapper), Ollama-Client und potenziell für spezialisierte Agenten-Skripte.
*   **Kommunikationsmechanismen:**
    *   **Named Pipes / Sockets:** Für die Kommunikation zwischen der C#-Anwendung und einem separaten Python-Prozess (ähnlich dem FastAPI-Backend des Referenzprojekts, aber möglicherweise leichtergewichtig für lokale Nutzung).
    *   **`Python.NET`:** Direkte Einbettung des Python-Interpreters in die C#-Anwendung, um Python-Module direkt aufzurufen. Dies bietet eine engere Integration, kann aber die Deployment-Komplexität erhöhen.
    *   **Streamlit:** Wird als eigenständiger Python-Prozess laufen und über eine definierte API mit der C#-Core Engine kommunizieren.

## 8. Hardware-Spezifikationen und Optimierung

Die Anwendung wird speziell für die bereitgestellte Hardware optimiert:

*   **Nvidia GeForce GTX 1650 (4GB VRAM):**
    *   Der Resource Planner wird die `n_gpu_layers` für `llama.cpp`-Modelle sorgfältig berechnen, um den VRAM optimal zu nutzen. Kleinere Modelle (z.B. 7B-Parameter-Modelle in Q4_0-Quantisierung) sollten weitgehend auf der GPU laufen können.
    *   Priorisierung von GPU-Slots für schnelle Chat-Antworten.
*   **Intel Core i7-3770 CPU @ 3.40GHz (3.90 GHz) + 32 GB RAM:**
    *   CPU-Slots werden für größere Modelle oder Aufgaben mit hohem Kontext genutzt, bei denen der VRAM der GPU nicht ausreicht.
    *   Ausreichend RAM ermöglicht das Laden mehrerer Modelle (wenn auch nicht gleichzeitig aktiv auf der GPU) und große Kontextfenster.
    *   Der Resource Planner wird die Anzahl der CPU-Threads (`n_threads`) basierend auf der CPU-Konfiguration optimieren.

## 9. Erweiterbarkeit und Plugins (MCP-Integration)

Die Architektur wird von Anfang an auf Erweiterbarkeit ausgelegt sein. Ein Plugin-System wird es ermöglichen, neue Agenten, Tools oder LLM-Adapter hinzuzufügen.

*   **MCP-Integration:** Die Möglichkeit, das Model Context Protocol (MCP) zu nutzen, um externe Dienste und Tools zu integrieren, wird als zukünftige Erweiterung in Betracht gezogen. Dies würde die Flexibilität des Agenten-Systems erheblich steigern.
*   **Plugin-Schnittstellen:** Klare Schnittstellen für Plugins, die es Entwicklern ermöglichen, eigene Module zu erstellen und in die Anwendung zu integrieren.

## 10. Fazit

Dieser Architektur-Entwurf bietet eine solide Grundlage für die Entwicklung von "DBZ Locale AI". Durch die Adaption der bewährten DBZS-Prinzipien und die sorgfältige Berücksichtigung der Hardware-Spezifikationen wird eine leistungsstarke, flexible und benutzerfreundliche Anwendung entstehen, die sowohl lokale als auch Cloud-basierte KI-Funktionen optimal nutzt. Die modulare Struktur und die geplante Interoperabilität zwischen C# und Python gewährleisten dabei eine hohe Wartbarkeit und Erweiterbarkeit.
