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

    public string PrimaryFormat => Artifacts.FirstOrDefault(item => item.ArtifactId == Bundle.PrimaryArtifactId)?.Format
        ?? Artifacts.FirstOrDefault()?.Format
        ?? "unknown";
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

