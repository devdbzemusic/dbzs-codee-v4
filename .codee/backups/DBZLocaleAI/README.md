# DBZ Locale AI

Eine umfassende lokale AI-Anwendung mit Multi-Agent-Orchestrierung, die sowohl als Windows UI/Forms App als auch als Streamlit-Webansicht verfügbar ist.

## Features

- **Lokale LLM-Unterstützung:** LLaMA 3, Mistral 7B und andere Open-Source-Modelle
- **API-Integration:** Claude Anthropic, OpenAI, Mistral API
- **Multi-Agent-Orchestrierung:** Intelligente Agenten-Workflows wie bei Manus
- **Hybride UI:** Windows Forms Desktop-App + Streamlit Web-Interface
- **Plugin-System:** Erweiterbar durch MCP und Custom Plugins
- **Sichere Konfiguration:** Verschlüsselte API-Schlüssel-Speicherung
- **Projekt-Management:** Lokale und Cloud-Speicherung (Google Drive, OneDrive)

## Systemanforderungen

### Minimum
- Windows 10/11
- .NET 7.0 Runtime
- 16 GB RAM
- 4 GB freier Speicherplatz

### Empfohlen für lokale LLMs
- NVIDIA GPU mit 8+ GB VRAM
- 32 GB RAM
- SSD-Speicher

### Getestete Hardware
- NVIDIA GeForce GTX 1650 (4GB VRAM)
- Intel Core i7-3770 @ 3.40GHz
- 32 GB RAM

## Installation

### Voraussetzungen
1. .NET 7.0 SDK installieren
2. Python 3.8+ für Streamlit-Komponente
3. Visual Studio 2022 (für Entwicklung)

### Build
```bash
git clone <repository-url>
cd DBZLocaleAI
dotnet restore
dotnet build
```

### Streamlit Setup
```bash
cd src/DBZLocaleAI.Streamlit
pip install -r requirements.txt
```

## Verwendung

### Windows Forms App
```bash
cd src/DBZLocaleAI.WinForms
dotnet run
```

### Streamlit Web Interface
```bash
cd src/DBZLocaleAI.Streamlit
streamlit run app.py
```

## Konfiguration

### API-Schlüssel
- Über die Einstellungen-UI hinzufügen
- Verschlüsselte Speicherung in lokaler SQLite-Datenbank
- Unterstützte APIs: OpenAI, Anthropic Claude, Mistral

### Lokale Modelle
- Automatische Erkennung von Ollama-Modellen
- Manuelle Modell-Pfad-Konfiguration
- GPU/CPU-Offloading-Einstellungen

## Architektur

```
DBZLocaleAI/
├── src/
│   ├── DBZLocaleAI.Core/           # Core Engine (.NET)
│   ├── DBZLocaleAI.WinForms/       # Windows Forms App
│   ├── DBZLocaleAI.Streamlit/      # Streamlit Web App
│   └── DBZLocaleAI.Plugins/        # Plugin System
├── tests/
├── docs/
└── assets/
```

## Entwicklung

### Core Engine
- .NET 7.0 Class Library
- LLamaSharp für lokale LLM-Integration
- SQLite für Datenpersistierung
- Dependency Injection Pattern

### Windows Forms
- Native Windows Desktop UI
- WebView2 für Streamlit-Integration
- Asynchrone LLM-Verarbeitung

### Streamlit Interface
- Python-basierte Web-UI
- REST API-Kommunikation mit Core Engine
- Real-time Chat-Interface

## Plugin-Entwicklung

### Interface Implementation
```csharp
public interface IDBZPlugin
{
    string Name { get; }
    string Version { get; }
    Task<string> ExecuteAsync(string input, CancellationToken cancellationToken);
}
```

### MCP Integration
- Model Context Protocol Support
- External Tool Integration
- Custom Protocol Handlers

## Lizenz

MIT License - siehe LICENSE-Datei für Details.

## Beitragen

1. Fork des Repositories
2. Feature Branch erstellen
3. Änderungen committen
4. Pull Request erstellen

## Support

Für Fragen und Support:
- GitHub Issues
- Dokumentation im `/docs` Verzeichnis
- Entwicklerhandbuch (Deutsch)

