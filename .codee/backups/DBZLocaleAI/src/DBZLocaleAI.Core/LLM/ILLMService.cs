using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace DBZLocaleAI.Core.LLM
{
    /// <summary>
    /// DBZS Header: LLM-Service Schnittstelle
    /// Abstraktion für verschiedene LLM-Provider (Lokal und Cloud)
    /// Einheitliche Schnittstelle für Chat-Completion und Streaming
    /// </summary>

    /// <summary>
    /// Repräsentiert eine Chat-Nachricht
    /// </summary>
    public class ChatMessage
    {
        public string Role { get; set; } // "system", "user", "assistant"
        public string Content { get; set; }
        public Dictionary<string, object> Metadata { get; set; } = new();
    }

    /// <summary>
    /// Request für Chat-Completion
    /// </summary>
    public class ChatCompletionRequest
    {
        public string ModelId { get; set; }
        public List<ChatMessage> Messages { get; set; } = new();
        public float Temperature { get; set; } = 0.7f;
        public int MaxTokens { get; set; } = 2048;
        public float TopP { get; set; } = 0.9f;
        public float TopK { get; set; } = 40f;
        public float RepeatPenalty { get; set; } = 1.1f;
        public Dictionary<string, object> CustomParameters { get; set; } = new();
    }

    /// <summary>
    /// Response für Chat-Completion
    /// </summary>
    public class ChatCompletionResponse
    {
        public string Content { get; set; }
        public string FinishReason { get; set; } // "stop", "length", "error"
        public int InputTokens { get; set; }
        public int OutputTokens { get; set; }
        public long ResponseTimeMs { get; set; }
        public Dictionary<string, object> Metadata { get; set; } = new();
    }

    /// <summary>
    /// Streaming-Chunk für Chat-Completion
    /// </summary>
    public class ChatStreamChunk
    {
        public string Content { get; set; }
        public string FinishReason { get; set; }
        public int InputTokens { get; set; }
        public int OutputTokens { get; set; }
        public bool IsComplete { get; set; }
    }

    /// <summary>
    /// Modell-Information
    /// </summary>
    public class ModelInfo
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string Provider { get; set; } // "llama-cpp", "ollama", "anthropic", "mistral", "openai"
        public long SizeBytes { get; set; }
        public string QuantizationType { get; set; } // "Q4_0", "Q5_1", "F16", etc.
        public List<string> Capabilities { get; set; } = new(); // "chat", "vision", "tools"
        public string Description { get; set; }
        public Dictionary<string, object> Metadata { get; set; } = new();
    }

    /// <summary>
    /// Haupt-Interface für LLM-Services
    /// </summary>
    public interface ILLMService
    {
        /// <summary>
        /// Gibt eine Liste aller verfügbaren Modelle zurück
        /// </summary>
        Task<List<ModelInfo>> GetAvailableModelsAsync(CancellationToken cancellationToken = default);

        /// <summary>
        /// Gibt Informationen über ein spezifisches Modell zurück
        /// </summary>
        Task<ModelInfo> GetModelInfoAsync(string modelId, CancellationToken cancellationToken = default);

        /// <summary>
        /// Führt eine Chat-Completion durch (nicht-streaming)
        /// </summary>
        Task<ChatCompletionResponse> CompleteAsync(
            ChatCompletionRequest request,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Führt eine Chat-Completion mit Streaming durch
        /// </summary>
        IAsyncEnumerable<ChatStreamChunk> CompleteStreamAsync(
            ChatCompletionRequest request,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Lädt ein Modell in den Speicher (falls lokal)
        /// </summary>
        Task<bool> LoadModelAsync(string modelId, CancellationToken cancellationToken = default);

        /// <summary>
        /// Entlädt ein Modell aus dem Speicher (falls lokal)
        /// </summary>
        Task<bool> UnloadModelAsync(string modelId, CancellationToken cancellationToken = default);

        /// <summary>
        /// Prüft, ob ein Modell geladen ist
        /// </summary>
        Task<bool> IsModelLoadedAsync(string modelId, CancellationToken cancellationToken = default);

        /// <summary>
        /// Gibt den aktuellen Status des Services zurück
        /// </summary>
        Task<LLMServiceStatus> GetStatusAsync(CancellationToken cancellationToken = default);
    }

    /// <summary>
    /// Status des LLM-Services
    /// </summary>
    public class LLMServiceStatus
    {
        public bool IsHealthy { get; set; }
        public string CurrentModel { get; set; }
        public long MemoryUsedBytes { get; set; }
        public long MemoryAvailableBytes { get; set; }
        public float GpuUtilization { get; set; }
        public float CpuUtilization { get; set; }
        public DateTime LastActivityTime { get; set; }
        public List<string> ActiveModels { get; set; } = new();
        public Dictionary<string, object> Metadata { get; set; } = new();
    }

    /// <summary>
    /// Interface für Modell-Provider (Adapter-Pattern)
    /// </summary>
    public interface IModelProvider
    {
        /// <summary>
        /// Eindeutige Kennung des Providers
        /// </summary>
        string ProviderId { get; }

        /// <summary>
        /// Gibt eine Liste aller verfügbaren Modelle zurück
        /// </summary>
        Task<List<ModelInfo>> GetAvailableModelsAsync(CancellationToken cancellationToken = default);

        /// <summary>
        /// Führt eine Chat-Completion durch
        /// </summary>
        Task<ChatCompletionResponse> CompleteAsync(
            ChatCompletionRequest request,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Führt eine Chat-Completion mit Streaming durch
        /// </summary>
        IAsyncEnumerable<ChatStreamChunk> CompleteStreamAsync(
            ChatCompletionRequest request,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Prüft die Verbindung zum Provider
        /// </summary>
        Task<bool> HealthCheckAsync(CancellationToken cancellationToken = default);
    }

    /// <summary>
    /// Interface für lokale Modell-Provider (mit Laden/Entladen)
    /// </summary>
    public interface ILocalModelProvider : IModelProvider
    {
        /// <summary>
        /// Lädt ein Modell in den Speicher
        /// </summary>
        Task<bool> LoadModelAsync(string modelId, CancellationToken cancellationToken = default);

        /// <summary>
        /// Entlädt ein Modell aus dem Speicher
        /// </summary>
        Task<bool> UnloadModelAsync(string modelId, CancellationToken cancellationToken = default);

        /// <summary>
        /// Prüft, ob ein Modell geladen ist
        /// </summary>
        Task<bool> IsModelLoadedAsync(string modelId, CancellationToken cancellationToken = default);

        /// <summary>
        /// Gibt den aktuellen Speicherstatus zurück
        /// </summary>
        Task<MemoryStatus> GetMemoryStatusAsync(CancellationToken cancellationToken = default);
    }

    /// <summary>
    /// Speicherstatus für lokale Provider
    /// </summary>
    public class MemoryStatus
    {
        public long TotalMemoryBytes { get; set; }
        public long UsedMemoryBytes { get; set; }
        public long AvailableMemoryBytes { get; set; }
        public float GpuMemoryUsagePercent { get; set; }
        public float CpuMemoryUsagePercent { get; set; }
        public List<string> LoadedModels { get; set; } = new();
    }

    /// <summary>
    /// Exception für LLM-Fehler
    /// </summary>
    public class LLMException : Exception
    {
        public string ErrorCode { get; set; }
        public string Provider { get; set; }

        public LLMException(string message, string errorCode = null, string provider = null, Exception innerException = null)
            : base(message, innerException)
        {
            ErrorCode = errorCode;
            Provider = provider;
        }
    }
}
