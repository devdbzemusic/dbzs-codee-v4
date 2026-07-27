using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using DBZLocaleAI.Core.Models;

namespace DBZLocaleAI.Core.Interfaces
{
    /// <summary>
    /// Interface for multi-agent orchestration service
    /// </summary>
    public interface IAgentService
    {
        /// <summary>
        /// Initialize the agent service
        /// </summary>
        Task InitializeAsync();

        /// <summary>
        /// Get available agents
        /// </summary>
        Task<IEnumerable<AgentInfo>> GetAvailableAgentsAsync();

        /// <summary>
        /// Execute a task using the specified agent
        /// </summary>
        Task<string> ExecuteTaskAsync(string agentName, string task, CancellationToken cancellationToken = default);

        /// <summary>
        /// Execute a task with streaming progress updates
        /// </summary>
        IAsyncEnumerable<AgentProgressUpdate> ExecuteTaskStreamingAsync(string agentName, string task, CancellationToken cancellationToken = default);

        /// <summary>
        /// Stop the currently running task
        /// </summary>
        Task StopCurrentTaskAsync();

        /// <summary>
        /// Get the status of a running task
        /// </summary>
        Task<AgentTaskStatus> GetTaskStatusAsync(string taskId);

        /// <summary>
        /// Get task history
        /// </summary>
        Task<IEnumerable<AgentTask>> GetTaskHistoryAsync(int limit = 100);

        /// <summary>
        /// Create a custom agent
        /// </summary>
        Task<bool> CreateAgentAsync(AgentDefinition agentDefinition);

        /// <summary>
        /// Update an existing agent
        /// </summary>
        Task<bool> UpdateAgentAsync(string agentName, AgentDefinition agentDefinition);

        /// <summary>
        /// Delete an agent
        /// </summary>
        Task<bool> DeleteAgentAsync(string agentName);

        /// <summary>
        /// Get agent capabilities
        /// </summary>
        Task<IEnumerable<string>> GetAgentCapabilitiesAsync(string agentName);

        /// <summary>
        /// Register a tool for agents to use
        /// </summary>
        Task<bool> RegisterToolAsync(ITool tool);

        /// <summary>
        /// Unregister a tool
        /// </summary>
        Task<bool> UnregisterToolAsync(string toolName);

        /// <summary>
        /// Get available tools
        /// </summary>
        Task<IEnumerable<ToolInfo>> GetAvailableToolsAsync();

        /// <summary>
        /// Event fired when agent progress updates
        /// </summary>
        event EventHandler<AgentProgressEventArgs> OnAgentProgress;

        /// <summary>
        /// Event fired when agent produces output
        /// </summary>
        event EventHandler<AgentOutputEventArgs> OnAgentOutput;

        /// <summary>
        /// Event fired when agent task completes
        /// </summary>
        event EventHandler<AgentTaskCompletedEventArgs> OnAgentTaskCompleted;
    }

    /// <summary>
    /// Event arguments for agent progress updates
    /// </summary>
    public class AgentProgressEventArgs : EventArgs
    {
        public string AgentName { get; set; }
        public string TaskId { get; set; }
        public string Status { get; set; }
        public string Message { get; set; }
        public int ProgressPercentage { get; set; }
        public DateTime Timestamp { get; set; }
    }

    /// <summary>
    /// Event arguments for agent output
    /// </summary>
    public class AgentOutputEventArgs : EventArgs
    {
        public string AgentName { get; set; }
        public string TaskId { get; set; }
        public string Output { get; set; }
        public AgentOutputType OutputType { get; set; }
        public DateTime Timestamp { get; set; }
    }

    /// <summary>
    /// Event arguments for agent task completion
    /// </summary>
    public class AgentTaskCompletedEventArgs : EventArgs
    {
        public string AgentName { get; set; }
        public string TaskId { get; set; }
        public string Result { get; set; }
        public bool Success { get; set; }
        public string ErrorMessage { get; set; }
        public TimeSpan Duration { get; set; }
        public DateTime CompletedAt { get; set; }
    }

    /// <summary>
    /// Types of agent output
    /// </summary>
    public enum AgentOutputType
    {
        Log,
        Progress,
        Result,
        Error,
        Debug
    }
}

