using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace DBZLocaleAI.Core.Agents
{
    /// <summary>
    /// DBZS Header: Multi-Agenten-System
    /// Orchestrierung spezialisierter KI-Agenten für komplexe Aufgaben
    /// Inspiriert von DBZS Codee: Planner, Coder, Reviewer, Debugger
    /// </summary>

    /// <summary>
    /// Agent-Rollen
    /// </summary>
    public enum AgentRole
    {
        /// <summary>
        /// Planer: Entwirft Lösungsstrategien
        /// </summary>
        Planner,

        /// <summary>
        /// Coder: Schreibt und modifiziert Code
        /// </summary>
        Coder,

        /// <summary>
        /// Reviewer: Überprüft Code auf Qualität und Sicherheit
        /// </summary>
        Reviewer,

        /// <summary>
        /// Debugger: Findet und behebt Fehler
        /// </summary>
        Debugger,

        /// <summary>
        /// Tester: Schreibt und führt Tests durch
        /// </summary>
        Tester,

        /// <summary>
        /// Dokumenter: Erstellt und aktualisiert Dokumentation
        /// </summary>
        Documenter,

        /// <summary>
        /// Generischer Agent für allgemeine Aufgaben
        /// </summary>
        Generic
    }

    /// <summary>
    /// Agent-Aufgaben-Status
    /// </summary>
    public enum TaskStatus
    {
        Created,
        Queued,
        Running,
        Completed,
        Failed,
        Cancelled
    }

    /// <summary>
    /// Tool-Definition für Agenten
    /// </summary>
    public class Tool
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string Description { get; set; }
        public Dictionary<string, object> Parameters { get; set; } = new();
        public string Category { get; set; } // "file", "code", "search", "system"
        public bool IsEnabled { get; set; } = true;
    }

    /// <summary>
    /// Agent-Definition
    /// </summary>
    public class AgentDefinition
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public AgentRole Role { get; set; }
        public string Description { get; set; }
        public string SystemPrompt { get; set; }
        public List<string> AvailableTools { get; set; } = new();
        public string PreferredModel { get; set; }
        public Dictionary<string, object> Configuration { get; set; } = new();
    }

    /// <summary>
    /// Agent-Aufgabe
    /// </summary>
    public class AgentTask
    {
        public string Id { get; set; }
        public string AgentId { get; set; }
        public string Description { get; set; }
        public string Input { get; set; }
        public TaskStatus Status { get; set; }
        public string Result { get; set; }
        public string ErrorMessage { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime StartedAt { get; set; }
        public DateTime CompletedAt { get; set; }
        public List<string> ExecutionSteps { get; set; } = new();
        public Dictionary<string, object> Metadata { get; set; } = new();
    }

    /// <summary>
    /// Ausführungs-Kontext für Agenten
    /// </summary>
    public class ExecutionContext
    {
        public string TaskId { get; set; }
        public string AgentId { get; set; }
        public string ModelId { get; set; }
        public List<ChatMessage> ConversationHistory { get; set; } = new();
        public Dictionary<string, object> Variables { get; set; } = new();
        public int MaxSteps { get; set; } = 10;
        public int CurrentStep { get; set; } = 0;
        public CancellationToken CancellationToken { get; set; }
    }

    /// <summary>
    /// Chat-Nachricht für Agent-Konversation
    /// </summary>
    public class ChatMessage
    {
        public string Role { get; set; } // "user", "assistant", "system"
        public string Content { get; set; }
        public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    }

    /// <summary>
    /// Interface für Agent-Service
    /// </summary>
    public interface IAgentService
    {
        /// <summary>
        /// Registriert einen neuen Agenten
        /// </summary>
        Task<AgentDefinition> RegisterAgentAsync(
            AgentDefinition definition,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Gibt einen Agenten nach ID zurück
        /// </summary>
        Task<AgentDefinition> GetAgentAsync(
            string agentId,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Gibt alle registrierten Agenten zurück
        /// </summary>
        Task<List<AgentDefinition>> GetAllAgentsAsync(
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Gibt Agenten nach Rolle zurück
        /// </summary>
        Task<List<AgentDefinition>> GetAgentsByRoleAsync(
            AgentRole role,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Startet eine Aufgabe mit einem Agenten
        /// </summary>
        Task<AgentTask> ExecuteTaskAsync(
            string agentId,
            string taskDescription,
            string input,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Gibt den Status einer Aufgabe zurück
        /// </summary>
        Task<AgentTask> GetTaskStatusAsync(
            string taskId,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Bricht eine laufende Aufgabe ab
        /// </summary>
        Task<bool> CancelTaskAsync(
            string taskId,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Gibt alle Tools zurück, die einem Agenten verfügbar sind
        /// </summary>
        Task<List<Tool>> GetAvailableToolsAsync(
            string agentId,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Registriert ein neues Tool
        /// </summary>
        Task<Tool> RegisterToolAsync(
            Tool tool,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Führt ein Tool aus
        /// </summary>
        Task<object> ExecuteToolAsync(
            string toolId,
            Dictionary<string, object> parameters,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Gibt die Aufgaben-Historie eines Agenten zurück
        /// </summary>
        Task<List<AgentTask>> GetTaskHistoryAsync(
            string agentId,
            int limit = 100,
            CancellationToken cancellationToken = default);
    }

    /// <summary>
    /// Exception für Agent-Fehler
    /// </summary>
    public class AgentException : Exception
    {
        public string AgentId { get; set; }
        public string TaskId { get; set; }
        public string ErrorCode { get; set; }

        public AgentException(
            string message,
            string agentId = null,
            string taskId = null,
            string errorCode = null,
            Exception innerException = null)
            : base(message, innerException)
        {
            AgentId = agentId;
            TaskId = taskId;
            ErrorCode = errorCode;
        }
    }
}
