using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using DBZLocaleAI.Core.Data;

namespace DBZLocaleAI.Core.Configuration
{
    /// <summary>
    /// DBZS Header: Konfigurations-Service Implementation
    /// Implementiert IConfigurationService unter Verwendung von DatabaseService
    /// </summary>
    public class ConfigurationService : IConfigurationService
    {
        private readonly DatabaseService _db;
        private ApplicationSettings _cachedSettings;

        public ConfigurationService(DatabaseService db)
        {
            _db = db;
        }

        public async Task<ApplicationSettings> LoadSettingsAsync(CancellationToken cancellationToken = default)
        {
            if (_cachedSettings != null) return _cachedSettings;

            var settings = new ApplicationSettings();
            var rows = await _db.QueryAsync("SELECT Key, Value FROM Settings");

            foreach (var row in rows)
            {
                var key = row["Key"].ToString();
                var value = row["Value"].ToString();

                switch (key)
                {
                    case "DarkMode": settings.DarkMode = bool.Parse(value); break;
                    case "Theme": settings.Theme = value; break;
                    case "UIFontSize": settings.UIFontSize = int.Parse(value); break;
                    case "AutoStartSlots": settings.AutoStartSlots = bool.Parse(value); break;
                    case "EnableCloudFallback": settings.EnableCloudFallback = bool.Parse(value); break;
                    // Weitere Mappings...
                }
            }

            _cachedSettings = settings;
            return settings;
        }

        public async Task SaveSettingsAsync(ApplicationSettings settings, CancellationToken cancellationToken = default)
        {
            await SetSettingAsync("DarkMode", settings.DarkMode.ToString());
            await SetSettingAsync("Theme", settings.Theme);
            await SetSettingAsync("UIFontSize", settings.UIFontSize.ToString());
            await SetSettingAsync("AutoStartSlots", settings.AutoStartSlots.ToString());
            await SetSettingAsync("EnableCloudFallback", settings.EnableCloudFallback.ToString());
            
            _cachedSettings = settings;
        }

        public async Task<object> GetSettingAsync(string key, CancellationToken cancellationToken = default)
        {
            var rows = await _db.QueryAsync("SELECT Value FROM Settings WHERE Key = @key", new Dictionary<string, object> { { "@key", key } });
            return rows.Count > 0 ? rows[0]["Value"] : null;
        }

        public async Task SetSettingAsync(string key, object value, CancellationToken cancellationToken = default)
        {
            await _db.ExecuteNonQueryAsync(
                "INSERT OR REPLACE INTO Settings (Key, Value, UpdatedAt) VALUES (@key, @value, CURRENT_TIMESTAMP)",
                new Dictionary<string, object> { { "@key", key }, { "@value", value.ToString() } }
            );
        }

        public async Task<ApiProviderConfig> RegisterApiProviderAsync(ApiProviderConfig config, CancellationToken cancellationToken = default)
        {
            await _db.ExecuteNonQueryAsync(
                "INSERT OR REPLACE INTO ApiProviders (Id, Name, ApiKey, BaseUrl, IsEnabled, ConfigJson) VALUES (@id, @name, @key, @url, @enabled, @config)",
                new Dictionary<string, object> {
                    { "@id", config.ProviderId },
                    { "@name", config.ProviderId },
                    { "@key", config.ApiKey },
                    { "@url", config.BaseUrl },
                    { "@enabled", config.IsEnabled ? 1 : 0 },
                    { "@config", JsonSerializer.Serialize(config.CustomSettings) }
                }
            );
            return config;
        }

        public async Task<List<ApiProviderConfig>> GetAllApiProvidersAsync(CancellationToken cancellationToken = default)
        {
            var rows = await _db.QueryAsync("SELECT * FROM ApiProviders");
            var providers = new List<ApiProviderConfig>();

            foreach (var row in rows)
            {
                providers.Add(new ApiProviderConfig
                {
                    ProviderId = row["Id"].ToString(),
                    ApiKey = row["ApiKey"].ToString(),
                    BaseUrl = row["BaseUrl"].ToString(),
                    IsEnabled = Convert.ToInt32(row["IsEnabled"]) == 1,
                    CustomSettings = JsonSerializer.Deserialize<Dictionary<string, object>>(row["ConfigJson"].ToString())
                });
            }

            return providers;
        }

        // Weitere Implementierungen für IConfigurationService...
        public Task<ApiProviderConfig> GetApiProviderAsync(string providerId, CancellationToken cancellationToken = default) => throw new NotImplementedException();
        public Task<bool> DeleteApiProviderAsync(string providerId, CancellationToken cancellationToken = default) => throw new NotImplementedException();
        public Task<ModelConfig> RegisterModelAsync(ModelConfig config, CancellationToken cancellationToken = default) => throw new NotImplementedException();
        public Task<ModelConfig> GetModelConfigAsync(string modelId, CancellationToken cancellationToken = default) => throw new NotImplementedException();
        public Task<List<ModelConfig>> GetAllModelConfigsAsync(CancellationToken cancellationToken = default) => throw new NotImplementedException();
        public Task<bool> DeleteModelConfigAsync(string modelId, CancellationToken cancellationToken = default) => throw new NotImplementedException();
        public Task<string> ExportConfigurationAsync(CancellationToken cancellationToken = default) => throw new NotImplementedException();
        public Task<bool> ImportConfigurationAsync(string configJson, CancellationToken cancellationToken = default) => throw new NotImplementedException();
        public Task<bool> ResetToDefaultsAsync(CancellationToken cancellationToken = default) => throw new NotImplementedException();
    }
}
