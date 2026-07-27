using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace DBZLocaleAI.Core.Runtime
{
    /// <summary>
    /// DBZS Header: Runtime Slot Management
    /// Verwaltung von Hardware-Slots für optimale Modell-Zuweisung
    /// Inspiriert von DBZS Codee: fast_gpu, quality_cpu, utility
    /// </summary>

    /// <summary>
    /// Slot-Profile für verschiedene Aufgabentypen
    /// </summary>
    public enum SlotProfile
    {
        /// <summary>
        /// Schnelle GPU-Inferenz (maximale Geschwindigkeit)
        /// </summary>
        FastGpu,

        /// <summary>
        /// Ausgewogene CPU-Qualität (hohe Qualität, längere Verarbeitung)
        /// </summary>
        QualityCpu,

        /// <summary>
        /// Utility-Slot für Nebenaufgaben
        /// </summary>
        Utility,

        /// <summary>
        /// Orchestrator für Agenten-Koordination
        /// </summary>
        OrchestratorCpu
    }

    /// <summary>
    /// Slot-Status
    /// </summary>
    public enum SlotStatus
    {
        Stopped,
        Starting,
        Running,
        Stopping,
        Error
    }

    /// <summary>
    /// Hardware-Informationen
    /// </summary>
    public class HardwareInfo
    {
        public string OsName { get; set; }
        public string Architecture { get; set; }
        public string CpuModel { get; set; }
        public int CpuCores { get; set; }
        public int CpuThreads { get; set; }
        public long TotalRamBytes { get; set; }
        public string GpuName { get; set; }
        public string GpuVendor { get; set; } // "nvidia", "amd", "intel"
        public long GpuVramBytes { get; set; }
        public Dictionary<string, object> Metadata { get; set; } = new();
    }

    /// <summary>
    /// Resource-Plan für ein Modell auf einem Slot
    /// </summary>
    public class ResourcePlan
    {
        public string ModelId { get; set; }
        public string SlotId { get; set; }
        public int ContextSize { get; set; }
        public int GpuLayers { get; set; }
        public int Threads { get; set; }
        public int BatchSize { get; set; }
        public long EstimatedVramBytes { get; set; }
        public long EstimatedRamBytes { get; set; }
        public string HardwareMode { get; set; } // "gpu", "cpu", "hybrid"
        public List<string> Warnings { get; set; } = new();
    }

    /// <summary>
    /// Status eines Runtime-Slots
    /// </summary>
    public class SlotStatus
    {
        public string SlotId { get; set; }
        public SlotStatus Status { get; set; }
        public string CurrentModelId { get; set; }
        public string CurrentModelName { get; set; }
        public int Port { get; set; }
        public string Endpoint { get; set; }
        public long MemoryUsedBytes { get; set; }
        public long MemoryAvailableBytes { get; set; }
        public float GpuUtilizationPercent { get; set; }
        public float CpuUtilizationPercent { get; set; }
        public DateTime StartedAt { get; set; }
        public int ProcessId { get; set; }
        public bool IsChatReady { get; set; }
        public Dictionary<string, object> Metadata { get; set; } = new();
    }

    /// <summary>
    /// Interface für Slot-Verwaltung
    /// </summary>
    public interface ISlotManager
    {
        /// <summary>
        /// Gibt Hardware-Informationen zurück
        /// </summary>
        Task<HardwareInfo> GetHardwareInfoAsync(CancellationToken cancellationToken = default);

        /// <summary>
        /// Gibt alle verfügbaren Slots zurück
        /// </summary>
        Task<List<SlotStatus>> GetAllSlotsAsync(CancellationToken cancellationToken = default);

        /// <summary>
        /// Gibt den Status eines spezifischen Slots zurück
        /// </summary>
        Task<SlotStatus> GetSlotStatusAsync(string slotId, CancellationToken cancellationToken = default);

        /// <summary>
        /// Startet einen Slot mit einem Modell
        /// </summary>
        Task<bool> StartSlotAsync(
            string slotId,
            string modelId,
            SlotProfile profile = SlotProfile.QualityCpu,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Stoppt einen Slot
        /// </summary>
        Task<bool> StopSlotAsync(string slotId, CancellationToken cancellationToken = default);

        /// <summary>
        /// Startet einen Slot neu
        /// </summary>
        Task<bool> RestartSlotAsync(string slotId, CancellationToken cancellationToken = default);

        /// <summary>
        /// Berechnet einen Resource-Plan für ein Modell auf einem Slot
        /// </summary>
        Task<ResourcePlan> PlanResourcesAsync(
            string modelId,
            string slotId,
            SlotProfile profile = SlotProfile.QualityCpu,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Wählt automatisch den besten Slot für ein Modell
        /// </summary>
        Task<string> SelectBestSlotAsync(
            string modelId,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Gibt den Status aller Slots zurück
        /// </summary>
        Task<Dictionary<string, SlotStatus>> GetAllSlotStatusesAsync(CancellationToken cancellationToken = default);

        /// <summary>
        /// Prüft, ob ein Slot bereit für Chat ist
        /// </summary>
        Task<bool> IsSlotReadyAsync(string slotId, CancellationToken cancellationToken = default);
    }

    /// <summary>
    /// Exception für Slot-Fehler
    /// </summary>
    public class SlotException : Exception
    {
        public string SlotId { get; set; }
        public string ErrorCode { get; set; }

        public SlotException(string message, string slotId = null, string errorCode = null, Exception innerException = null)
            : base(message, innerException)
        {
            SlotId = slotId;
            ErrorCode = errorCode;
        }
    }
}
