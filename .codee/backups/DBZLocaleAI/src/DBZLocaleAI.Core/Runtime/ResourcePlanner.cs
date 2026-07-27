using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace DBZLocaleAI.Core.Runtime
{
    /// <summary>
    /// DBZS Header: Resource Planner
    /// Berechnet optimale Ressourcen-Konfiguration für Modelle
    /// Inspiriert von DBZS Codee Phase 1
    /// Optimiert für Nvidia GTX 1650 (4GB VRAM)
    /// </summary>
    public class ResourcePlanner
    {
        private const long BytesPerMb = 1024 * 1024;
        private const long MinSafetyReserveBytes = 512 * BytesPerMb;
        private const long LowVramSafetyReserveBytes = 768 * BytesPerMb;
        private const long LowVramThresholdBytes = (long)(4.5 * 1024 * BytesPerMb);
        private const int GpuLayerStep = 4;

        // Modell-Größen-Buckets (Schätzungen in Bytes)
        private static readonly Dictionary<string, long> ModelSizeBuckets = new()
        {
            { "70b", 40_000_000_000 },
            { "34b", 20_000_000_000 },
            { "13b", 8_000_000_000 },
            { "8b", 5_500_000_000 },
            { "7b", 5_000_000_000 },
            { "4b", 3_000_000_000 },
            { "3b", 2_500_000_000 },
            { "2b", 1_600_000_000 },
            { "1.5b", 1_600_000_000 },
            { "1b", 1_200_000_000 },
        };

        private const long DefaultModelBytes = 2_000_000_000;

        // KV-Cache-Größe relativ zu F16
        private static readonly Dictionary<string, float> CacheTypeRelativeToF16 = new()
        {
            { "f16", 1.0f },
            { "q8_0", 0.5f },
            { "q4_0", 0.25f },
        };

        // Profil-Kontext-Größen
        private static readonly Dictionary<SlotProfile, int> ProfileContextSizes = new()
        {
            { SlotProfile.FastGpu, 2048 },
            { SlotProfile.QualityCpu, 4096 },
            { SlotProfile.Utility, 2048 },
            { SlotProfile.OrchestratorCpu, 4096 },
        };

        /// <summary>
        /// Berechnet einen Resource-Plan für ein Modell
        /// </summary>
        public ResourcePlan PlanResources(
            string modelId,
            string modelName,
            SlotProfile profile,
            HardwareInfo hardware)
        {
            var warnings = new List<string> { "kv_cache_estimate_approximate" };
            var contextSize = ProfileContextSizes.GetValueOrDefault(profile, 4096);
            var batchSize = profile == SlotProfile.Utility ? 256 : 512;
            var threads = Math.Max(4, hardware.CpuThreads / 2);

            var modelBytes = EstimateModelBytes(modelId, modelName);
            var availableVramBytes = hardware.GpuVramBytes;
            var safetyReserveBytes = CalculateSafetyReserve(availableVramBytes);

            // GPU-Layer Berechnung
            var gpuLayers = 0;
            if (profile == SlotProfile.FastGpu && hardware.GpuVramBytes > 0)
            {
                gpuLayers = ChooseGpuLayers(
                    modelBytes,
                    contextSize,
                    batchSize,
                    hardware.GpuVramBytes,
                    safetyReserveBytes);
            }
            else if (profile == SlotProfile.QualityCpu)
            {
                gpuLayers = 0; // CPU-only
            }

            // Geschätzte VRAM-Nutzung
            var estimatedKvCacheBytes = EstimateKvCacheBytes(contextSize, "q8_0", "q8_0");
            var estimatedComputeBufferBytes = EstimateComputeBufferBytes(batchSize);
            var gpuRatio = gpuLayers > 0 ? Math.Min(gpuLayers / 32.0f, 1.0f) : 0.0f;
            var estimatedTotalVramBytes = gpuLayers > 0
                ? (long)(modelBytes * gpuRatio) + estimatedKvCacheBytes + estimatedComputeBufferBytes
                : 0;

            // Hardware-Mode bestimmen
            var hardwareMode = gpuLayers == 0
                ? "cpu"
                : (gpuLayers >= EstimateMaxGpuLayers(hardware.GpuVramBytes) ? "gpu" : "hybrid");

            // Warnungen hinzufügen
            if (hardware.GpuVramBytes == 0 && profile != SlotProfile.QualityCpu)
            {
                warnings.Add("no_gpu_detected_forced_cpu");
            }

            if (estimatedTotalVramBytes > availableVramBytes - safetyReserveBytes)
            {
                warnings.Add("estimated_vram_exceeds_safety_reserve");
            }

            return new ResourcePlan
            {
                ModelId = modelId,
                SlotId = profile.ToString(),
                ContextSize = contextSize,
                GpuLayers = gpuLayers,
                Threads = threads,
                BatchSize = batchSize,
                EstimatedVramBytes = estimatedTotalVramBytes,
                EstimatedRamBytes = modelBytes + estimatedKvCacheBytes,
                HardwareMode = hardwareMode,
                Warnings = warnings,
            };
        }

        /// <summary>
        /// Schätzt die Modell-Größe basierend auf dem Namen
        /// </summary>
        private long EstimateModelBytes(string modelId, string modelName)
        {
            var searchString = $"{modelId} {modelName}".ToLower();

            foreach (var (token, size) in ModelSizeBuckets)
            {
                if (searchString.Contains(token))
                {
                    return size;
                }
            }

            return DefaultModelBytes;
        }

        /// <summary>
        /// Berechnet die KV-Cache-Größe
        /// </summary>
        private long EstimateKvCacheBytes(int contextSize, string cacheTypeK, string cacheTypeV)
        {
            var baseMb = Math.Max(256, Math.Min(4096, contextSize / 4));
            var relativeK = CacheTypeRelativeToF16.GetValueOrDefault(cacheTypeK, 1.0f);
            var relativeV = CacheTypeRelativeToF16.GetValueOrDefault(cacheTypeV, 1.0f);
            var relative = (relativeK + relativeV) / 2.0f;

            return (long)(baseMb * relative * BytesPerMb);
        }

        /// <summary>
        /// Schätzt die Compute-Buffer-Größe
        /// </summary>
        private long EstimateComputeBufferBytes(int batchSize)
        {
            return Math.Max(256 * BytesPerMb, (long)(batchSize * 1.5 * BytesPerMb));
        }

        /// <summary>
        /// Berechnet die Sicherheits-Reserve
        /// </summary>
        private long CalculateSafetyReserve(long availableVramBytes)
        {
            if (availableVramBytes == 0)
                return MinSafetyReserveBytes;

            var reserve = Math.Max(MinSafetyReserveBytes, (long)(availableVramBytes * 0.15));

            if (availableVramBytes <= LowVramThresholdBytes)
            {
                reserve = Math.Max(reserve, LowVramSafetyReserveBytes);
            }

            return reserve;
        }

        /// <summary>
        /// Wählt die optimale Anzahl von GPU-Layers
        /// </summary>
        private int ChooseGpuLayers(
            long modelBytes,
            int contextSize,
            int batchSize,
            long availableVramBytes,
            long safetyReserveBytes)
        {
            var maxLayers = EstimateMaxGpuLayers(availableVramBytes);

            if (maxLayers <= 0)
                return 0;

            var computeBufferBytes = EstimateComputeBufferBytes(batchSize);
            var kvCacheBytes = EstimateKvCacheBytes(contextSize, "q8_0", "q8_0");

            var layers = maxLayers;
            while (layers > 0)
            {
                var gpuRatio = Math.Min(layers / 32.0f, 1.0f);
                var total = (long)(modelBytes * gpuRatio) + kvCacheBytes + computeBufferBytes;

                if (total <= availableVramBytes - safetyReserveBytes)
                {
                    return layers;
                }

                layers -= GpuLayerStep;
            }

            return 0;
        }

        /// <summary>
        /// Schätzt die maximale Anzahl von GPU-Layers basierend auf VRAM
        /// </summary>
        private int EstimateMaxGpuLayers(long vramBytes)
        {
            if (vramBytes == 0)
                return 0;

            var vramGb = vramBytes / (1024.0 * 1024 * 1024);

            // Heuristik für Nvidia GPUs
            if (vramGb >= 24)
                return 80;
            if (vramGb >= 16)
                return 60;
            if (vramGb >= 12)
                return 40;
            if (vramGb >= 8)
                return 32;
            if (vramGb >= 6)
                return 24;
            if (vramGb >= 4)
                return 16; // GTX 1650 (4GB)
            if (vramGb >= 2)
                return 8;

            return 4;
        }

        /// <summary>
        /// Reduziert den Resource-Plan bei OOM-Fehler
        /// </summary>
        public ResourcePlan ReduceForOom(ResourcePlan previousPlan, int attempt)
        {
            var reductionFactor = Math.Pow(0.5, attempt);
            var newGpuLayers = Math.Max(0, (int)(previousPlan.GpuLayers * reductionFactor));

            if (newGpuLayers == previousPlan.GpuLayers && newGpuLayers > 0)
            {
                newGpuLayers = Math.Max(0, newGpuLayers - GpuLayerStep);
            }

            var warnings = new List<string>(previousPlan.Warnings);
            warnings.Add($"oom_retry_attempt_{attempt}_reduced_gpu_layers_to_{newGpuLayers}");

            if (newGpuLayers == 0)
            {
                warnings.Add("oom_retry_forced_cpu_only");
            }

            var gpuRatio = newGpuLayers > 0 ? Math.Min(newGpuLayers / 32.0f, 1.0f) : 0.0f;
            var estimatedTotalVramBytes = newGpuLayers > 0
                ? (long)(previousPlan.EstimatedVramBytes * gpuRatio)
                : 0;

            return new ResourcePlan
            {
                ModelId = previousPlan.ModelId,
                SlotId = previousPlan.SlotId,
                ContextSize = previousPlan.ContextSize,
                GpuLayers = newGpuLayers,
                Threads = previousPlan.Threads,
                BatchSize = previousPlan.BatchSize,
                EstimatedVramBytes = estimatedTotalVramBytes,
                EstimatedRamBytes = previousPlan.EstimatedRamBytes,
                HardwareMode = newGpuLayers == 0 ? "cpu" : "hybrid",
                Warnings = warnings,
            };
        }
    }
}
