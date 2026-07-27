using System;
using System.Collections.Generic;
using System.Data.SQLite;
using System.IO;
using System.Threading.Tasks;
using DBZLocaleAI.Core.Utils;

namespace DBZLocaleAI.Core.Data
{
    /// <summary>
    /// DBZS Header: Datenbank-Service
    /// Verwaltung der SQLite-Datenbank für Konfiguration, Projekte und Chats
    /// </summary>
    public class DatabaseService
    {
        private readonly string _dbPath;
        private readonly string _connectionString;

        public DatabaseService(string dbPath)
        {
            _dbPath = dbPath;
            _connectionString = $"Data Source={_dbPath};Version=3;";
            InitializeDatabase();
        }

        private void InitializeDatabase()
        {
            var directory = Path.GetDirectoryName(_dbPath);
            if (!Directory.Exists(directory))
            {
                Directory.CreateDirectory(directory);
            }

            if (!File.Exists(_dbPath))
            {
                SQLiteConnection.CreateFile(_dbPath);
            }

            using (var connection = new SQLiteConnection(_connectionString))
            {
                connection.Open();

                // Tabellen erstellen
                string[] createTableCommands = {
                    // Einstellungen
                    "CREATE TABLE IF NOT EXISTS Settings (Key TEXT PRIMARY KEY, Value TEXT, UpdatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)",
                    
                    // API Provider
                    "CREATE TABLE IF NOT EXISTS ApiProviders (Id TEXT PRIMARY KEY, Name TEXT, ApiKey TEXT, BaseUrl TEXT, IsEnabled INTEGER, ConfigJson TEXT)",
                    
                    // Modelle
                    "CREATE TABLE IF NOT EXISTS Models (Id TEXT PRIMARY KEY, Name TEXT, Provider TEXT, LocalPath TEXT, IsEnabled INTEGER, ConfigJson TEXT)",
                    
                    // Projekte
                    "CREATE TABLE IF NOT EXISTS Projects (Id TEXT PRIMARY KEY, Name TEXT, Description TEXT, CreatedAt DATETIME, UpdatedAt DATETIME, Path TEXT)",
                    
                    // Chat-Verläufe
                    "CREATE TABLE IF NOT EXISTS ChatMessages (Id INTEGER PRIMARY KEY AUTOINCREMENT, ProjectId TEXT, Role TEXT, Content TEXT, Timestamp DATETIME, ModelId TEXT)",
                    
                    // Agenten-Tasks
                    "CREATE TABLE IF NOT EXISTS AgentTasks (Id TEXT PRIMARY KEY, AgentId TEXT, Description TEXT, Status TEXT, Result TEXT, CreatedAt DATETIME, CompletedAt DATETIME)"
                };

                foreach (var commandText in createTableCommands)
                {
                    using (var command = new SQLiteCommand(commandText, connection))
                    {
                        command.ExecuteNonQuery();
                    }
                }
            }
            
            Logger.Instance.LogInfo("Datenbank erfolgreich initialisiert.");
        }

        public async Task ExecuteNonQueryAsync(string sql, Dictionary<string, object> parameters = null)
        {
            using (var connection = new SQLiteConnection(_connectionString))
            {
                await connection.OpenAsync();
                using (var command = new SQLiteCommand(sql, connection))
                {
                    if (parameters != null)
                    {
                        foreach (var param in parameters)
                        {
                            command.Parameters.AddWithValue(param.Key, param.Value);
                        }
                    }
                    await command.ExecuteNonQueryAsync();
                }
            }
        }

        public async Task<List<Dictionary<string, object>>> QueryAsync(string sql, Dictionary<string, object> parameters = null)
        {
            var results = new List<Dictionary<string, object>>();
            using (var connection = new SQLiteConnection(_connectionString))
            {
                await connection.OpenAsync();
                using (var command = new SQLiteCommand(sql, connection))
                {
                    if (parameters != null)
                    {
                        foreach (var param in parameters)
                        {
                            command.Parameters.AddWithValue(param.Key, param.Value);
                        }
                    }
                    using (var reader = await command.ExecuteReaderAsync())
                    {
                        while (await reader.ReadAsync())
                        {
                            var row = new Dictionary<string, object>();
                            for (int i = 0; i < reader.FieldCount; i++)
                            {
                                row[reader.GetName(i)] = reader.GetValue(i);
                            }
                            results.Add(row);
                        }
                    }
                }
            }
            return results;
        }
    }
}
