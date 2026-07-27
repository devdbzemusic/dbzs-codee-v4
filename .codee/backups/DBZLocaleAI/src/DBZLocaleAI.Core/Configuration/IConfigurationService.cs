using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace DBZLocaleAI.Core.Configuration
{
    /// <summary>
    /// DBZS Header: Konfigurationssystem
    /// Verwaltung aller Anwendungseinstellungen und API-Schlüssel
    /// Persistente Speicherung in SQLite mit Verschlüsselung
    /// </summary>

    /// <summary>
    /// API-Provider-Konfiguration
    /// </summary>
    public class ApiProviderConfig
    {
        public string ProviderId { get; set; } // "anthropic", "mistral", "openai"
        public string ApiKey { get; set; }
        public string BaseUrl { get; set; }
        public Dictionary<string, object> CustomSettings { get; set; } = new();
        public bool IsEnabled { get; set; } = true;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>
    /// Modell-Konfiguration
    /// </summary>
    public class ModelConfig
    {
        public string ModelId { get; set; }
        public string ModelName { get; set; }
        public string Provider { get; set; } // "llama-cpp", "ollama", "anthropic", etc.
        public string LocalPath { get; set; }
        public bool IsEnabled { get; set; } = true;
        public Dictionary<string, object> Parameters { get; set; } = new();
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>
    /// Anwendungseinstellungen
    /// </summary>
    public class ApplicationSettings
    {
        public string AppDataDirectory { get; set; }
        public string ModelsDirectory { get; set; }
        public string ProjectsDirectory { get; set; }
        public string LogsDirectory { get; set; }
        public bool DarkMode { get; set; } = true;
        public string Theme { get; set; } = "neon-dark";
        public int UIFontSize { get; set; } = 11;
        public bool AutoStartSlots { get; set; } = true;
        public int MaxConcurrentModels { get; set; } = 2;
        public bool EnableCloudFallback { get; set; } = true;
        public bool EnableLocalOnly { get; set; } = false;
        public Dictionary<string, object> CustomSettings { get; set; } = new();
    }

    /// <summary>
    /// Interface für Konfigurationsverwaltung
    /// </summary>
    public interface IConfigurationService
    {
        /// <summary>
        /// Lädt alle Einstellungen
        /// </summary>
        Task<ApplicationSettings> LoadSettingsAsync(CancellationToken cancellationToken = default);

        /// <summary>
        /// Speichert Einstellungen
        /// </summary>
        Task SaveSettingsAsync(ApplicationSettings settings, CancellationToken cancellationToken = default);

        /// <summary>
        /// Gibt eine spezifische Einstellung zurück
        /// </summary>
        Task<object> GetSettingAsync(string key, CancellationToken cancellationToken = default);

        /// <summary>
        /// Setzt eine spezifische Einstellung
        /// </summary>
        Task SetSettingAsync(string key, object value, CancellationToken cancellationToken = default);

        /// <summary>
        /// Registriert einen API-Provider
        /// </summary>
        Task<ApiProviderConfig> RegisterApiProviderAsync(
            ApiProviderConfig config,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Gibt einen API-Provider zurück
        /// </summary>
        Task<ApiProviderConfig> GetApiProviderAsync(
            string providerId,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Gibt alle registrierten API-Provider zurück
        /// </summary>
        Task<List<ApiProviderConfig>> GetAllApiProvidersAsync(CancellationToken cancellationToken = default);

        /// <summary>
        /// Löscht einen API-Provider
        /// </summary>
        Task<bool> DeleteApiProviderAsync(
            string providerId,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Registriert eine Modell-Konfiguration
        /// </summary>
        Task<ModelConfig> RegisterModelAsync(
            ModelConfig config,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Gibt eine Modell-Konfiguration zurück
        /// </summary>
        Task<ModelConfig> GetModelConfigAsync(
            string modelId,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Gibt alle Modell-Konfigurationen zurück
        /// </summary>
        Task<List<ModelConfig>> GetAllModelConfigsAsync(CancellationToken cancellationToken = default);

        /// <summary>
        /// Löscht eine Modell-Konfiguration
        /// </summary>
        Task<bool> DeleteModelConfigAsync(
            string modelId,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Exportiert die Konfiguration (ohne sensitive Daten)
        /// </summary>
        Task<string> ExportConfigurationAsync(CancellationToken cancellationToken = default);

        /// <summary>
        /// Importiert eine Konfiguration
        /// </summary>
        Task<bool> ImportConfigurationAsync(
            string configJson,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Setzt die Konfiguration auf Standardwerte zurück
        /// </summary>
        Task<bool> ResetToDefaultsAsync(CancellationToken cancellationToken = default);
    }

    /// <summary>
    /// Exception für Konfigurationsfehler
    /// </summary>
    public class ConfigurationException : Exception
    {
        public string ConfigKey { get; set; }
        public string ErrorCode { get; set; }

        public ConfigurationException(
            string message,
            string configKey = null,
            string errorCode = null,
            Exception innerException = null)
            : base(message, innerException)
        {
            ConfigKey = configKey;
            ErrorCode = errorCode;
        }
    }
}
