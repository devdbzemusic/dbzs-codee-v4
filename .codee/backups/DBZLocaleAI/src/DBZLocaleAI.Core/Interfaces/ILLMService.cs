using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using DBZLocaleAI.Core.Models;

namespace DBZLocaleAI.Core.Interfaces
{
    /// <summary>
    /// Interface for LLM (Large Language Model) services
    /// </summary>
    public interface ILLMService
    {
        /// <summary>
        /// Initialize the LLM service
        /// </summary>
        Task InitializeAsync();

        /// <summary>
        /// Get available models
        /// </summary>
        Task<IEnumerable<string>> GetAvailableModelsAsync();

        /// <summary>
        /// Generate a response using the specified model
        /// </summary>
        Task<string> GenerateResponseAsync(string model, string prompt, CancellationToken cancellationToken = default);

        /// <summary>
        /// Generate a response with conversation context
        /// </summary>
        Task<string> GenerateResponseAsync(string model, IEnumerable<ChatMessage> messages, CancellationToken cancellationToken = default);

        /// <summary>
        /// Generate a streaming response
        /// </summary>
        IAsyncEnumerable<string> GenerateStreamingResponseAsync(string model, string prompt, CancellationToken cancellationToken = default);

        /// <summary>
        /// Generate a streaming response with conversation context
        /// </summary>
        IAsyncEnumerable<string> GenerateStreamingResponseAsync(string model, IEnumerable<ChatMessage> messages, CancellationToken cancellationToken = default);

        /// <summary>
        /// Check if a model is available
        /// </summary>
        Task<bool> IsModelAvailableAsync(string model);

        /// <summary>
        /// Get model information
        /// </summary>
        Task<ModelInfo> GetModelInfoAsync(string model);

        /// <summary>
        /// Load a local model
        /// </summary>
        Task<bool> LoadModelAsync(string modelPath);

        /// <summary>
        /// Unload a model from memory
        /// </summary>
        Task<bool> UnloadModelAsync(string model);

        /// <summary>
        /// Get current model status
        /// </summary>
        Task<ModelStatus> GetModelStatusAsync(string model);

        /// <summary>
        /// Event fired when model loading progress changes
        /// </summary>
        event EventHandler<ModelLoadingProgressEventArgs> ModelLoadingProgress;

        /// <summary>
        /// Event fired when a model is loaded or unloaded
        /// </summary>
        event EventHandler<ModelStatusChangedEventArgs> ModelStatusChanged;
    }

    /// <summary>
    /// Event arguments for model loading progress
    /// </summary>
    public class ModelLoadingProgressEventArgs : EventArgs
    {
        public string ModelName { get; set; }
        public int ProgressPercentage { get; set; }
        public string Status { get; set; }
    }

    /// <summary>
    /// Event arguments for model status changes
    /// </summary>
    public class ModelStatusChangedEventArgs : EventArgs
    {
        public string ModelName { get; set; }
        public ModelStatus OldStatus { get; set; }
        public ModelStatus NewStatus { get; set; }
    }
}

