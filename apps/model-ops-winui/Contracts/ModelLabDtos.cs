using System.Text.Json.Serialization;

namespace DBZS.Codee.ModelOps.WinUI.Models;

public sealed class ModelSourceDto
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("path")]
    public string Path { get; set; } = "";

    [JsonPropertyName("last_scan_status")]
    public string? LastScanStatus { get; set; }
}

public sealed class ModelBundleDto
{
    [JsonPropertyName("bundle_id")]
    public string BundleId { get; set; } = "";

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("primary_artifact_id")]
    public string? PrimaryArtifactId { get; set; }

    [JsonPropertyName("status")]
    public string Status { get; set; } = "";

    [JsonPropertyName("capabilities")]
    public List<string> Capabilities { get; set; } = [];

    [JsonPropertyName("modalities")]
    public List<string> Modalities { get; set; } = [];

    [JsonPropertyName("health")]
    public ModelHealthDto Health { get; set; } = new();

    [JsonPropertyName("tags")]
    public List<string> Tags { get; set; } = [];

    [JsonPropertyName("is_favorite")]
    public bool IsFavorite { get; set; }

    [JsonPropertyName("notes")]
    public string Notes { get; set; } = "";

    [JsonPropertyName("collection_ids")]
    public List<string> CollectionIds { get; set; } = [];
}

public sealed class ModelHealthDto
{
    [JsonPropertyName("status")]
    public string Status { get; set; } = "unknown";

    [JsonPropertyName("model_type")]
    public string ModelType { get; set; } = "Unbekannt";

    [JsonPropertyName("architecture")]
    public string? Architecture { get; set; }

    [JsonPropertyName("context_length")]
    public int? ContextLength { get; set; }

    [JsonPropertyName("quantization")]
    public string? Quantization { get; set; }

    [JsonPropertyName("folder_size_bytes")]
    public long FolderSizeBytes { get; set; }

    [JsonPropertyName("missing_critical")]
    public List<string> MissingCritical { get; set; } = [];

    [JsonPropertyName("optional_missing")]
    public List<string> OptionalMissing { get; set; } = [];

    [JsonPropertyName("config_files")]
    public List<string> ConfigFiles { get; set; } = [];
}

public sealed class ModelArtifactDto
{
    [JsonPropertyName("artifact_id")]
    public string ArtifactId { get; set; } = "";

    [JsonPropertyName("file_name")]
    public string FileName { get; set; } = "";

    [JsonPropertyName("format")]
    public string Format { get; set; } = "";

    [JsonPropertyName("artifact_type")]
    public string ArtifactType { get; set; } = "";

    [JsonPropertyName("quantization")]
    public string? Quantization { get; set; }
}

public sealed class ModelLabModelDto
{
    [JsonPropertyName("bundle")]
    public ModelBundleDto Bundle { get; set; } = new();

    [JsonPropertyName("artifacts")]
    public List<ModelArtifactDto> Artifacts { get; set; } = [];

    public string CapabilitySummary => Bundle.Capabilities.Count == 0
        ? "Keine Capabilities"
        : string.Join(", ", Bundle.Capabilities);

    public string HealthSummary => $"{Bundle.Health.Status} · {Bundle.Health.ModelType}";

    public string TagSummary => Bundle.Tags.Count == 0 ? "Keine Tags" : string.Join(", ", Bundle.Tags);

    public string MissingSummary
    {
        get
        {
            var missing = Bundle.Health.MissingCritical.Concat(Bundle.Health.OptionalMissing).ToList();
            return missing.Count == 0 ? "Keine fehlenden Dateien" : string.Join(", ", missing);
        }
    }

    public string PrimaryFormat => Artifacts.FirstOrDefault(item => item.ArtifactId == Bundle.PrimaryArtifactId)?.Format
        ?? Artifacts.FirstOrDefault()?.Format
        ?? "unknown";
}

public sealed class ModelMetadataUpdateDto
{
    [JsonPropertyName("tags")]
    public List<string> Tags { get; set; } = [];

    [JsonPropertyName("is_favorite")]
    public bool IsFavorite { get; set; }

    [JsonPropertyName("notes")]
    public string Notes { get; set; } = "";
}

public sealed class ModelCollectionDto
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("color")]
    public string Color { get; set; } = "#22D3EE";

    [JsonPropertyName("description")]
    public string Description { get; set; } = "";
}

public sealed class ScanJobDto
{
    [JsonPropertyName("status")]
    public string Status { get; set; } = "";

    [JsonPropertyName("artifact_count")]
    public int ArtifactCount { get; set; }

    [JsonPropertyName("bundle_count")]
    public int BundleCount { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }
}

public sealed class ScanResultDto
{
    [JsonPropertyName("job")]
    public ScanJobDto Job { get; set; } = new();
}

public sealed class HardwareProfileDto
{
    [JsonPropertyName("runtime_backend")]
    public string RuntimeBackend { get; set; } = "unknown";

    [JsonPropertyName("cpu_threads")]
    public int CpuThreads { get; set; }

    [JsonPropertyName("ram_bytes")]
    public long RamBytes { get; set; }

    [JsonPropertyName("gpu_name")]
    public string? GpuName { get; set; }

    [JsonPropertyName("gpu_vendor")]
    public string? GpuVendor { get; set; }
}

