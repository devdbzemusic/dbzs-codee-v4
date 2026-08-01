using System.Net.Http.Json;
using System.Text.Json;
using DBZS.Codee.ModelOps.WinUI.Models;

namespace DBZS.Codee.ModelOps.WinUI.Services;

public sealed class ModelLabApiClient
{
    private readonly HttpClient _httpClient = new();
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web);

    public string BackendUrl { get; set; } = "http://127.0.0.1:8876";

    public async Task<IReadOnlyList<ModelSourceDto>> GetSourcesAsync(CancellationToken cancellationToken)
    {
        return await GetAsync<List<ModelSourceDto>>("/model-lab/sources", cancellationToken) ?? [];
    }

    public async Task<IReadOnlyList<ModelLabModelDto>> GetModelsAsync(CancellationToken cancellationToken)
    {
        return await GetAsync<List<ModelLabModelDto>>("/model-lab/models", cancellationToken) ?? [];
    }

    public async Task<IReadOnlyList<ScanJobDto>> GetJobsAsync(CancellationToken cancellationToken)
    {
        return await GetAsync<List<ScanJobDto>>("/model-lab/jobs", cancellationToken) ?? [];
    }

    public async Task<IReadOnlyList<ModelCollectionDto>> GetCollectionsAsync(CancellationToken cancellationToken)
    {
        return await GetOptionalAsync<List<ModelCollectionDto>>("/model-lab/collections", cancellationToken) ?? [];
    }

    public async Task<HardwareProfileDto?> GetHardwareAsync(CancellationToken cancellationToken)
    {
        return await GetAsync<HardwareProfileDto>("/model-lab/hardware", cancellationToken);
    }

    public async Task<ModelSourceDto?> AddSourceAsync(string path, CancellationToken cancellationToken)
    {
        var payload = new { path, recursive = true, enabled = true, trusted = false };
        using var response = await _httpClient.PostAsJsonAsync(BuildUri("/model-lab/sources"), payload, _jsonOptions, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<ModelSourceDto>(_jsonOptions, cancellationToken);
    }

    public async Task<ScanResultDto?> ScanAsync(string? sourceId, CancellationToken cancellationToken)
    {
        object payload = string.IsNullOrWhiteSpace(sourceId) ? new { } : new { source_id = sourceId };
        using var response = await _httpClient.PostAsJsonAsync(BuildUri("/model-lab/scan"), payload, _jsonOptions, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<ScanResultDto>(_jsonOptions, cancellationToken);
    }

    public async Task<ModelBundleDto?> UpdateMetadataAsync(
        string bundleId,
        ModelMetadataUpdateDto metadata,
        CancellationToken cancellationToken)
    {
        using var response = await _httpClient.PutAsJsonAsync(
            BuildUri($"/model-lab/models/{bundleId}/metadata"),
            metadata,
            _jsonOptions,
            cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<ModelBundleDto>(_jsonOptions, cancellationToken);
    }

    private async Task<T?> GetAsync<T>(string path, CancellationToken cancellationToken)
    {
        using var response = await _httpClient.GetAsync(BuildUri(path), cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<T>(_jsonOptions, cancellationToken);
    }

    private async Task<T?> GetOptionalAsync<T>(string path, CancellationToken cancellationToken)
    {
        using var response = await _httpClient.GetAsync(BuildUri(path), cancellationToken);
        if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return default;
        }
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<T>(_jsonOptions, cancellationToken);
    }

    private Uri BuildUri(string path)
    {
        return new Uri(new Uri(BackendUrl.TrimEnd('/') + "/"), path.TrimStart('/'));
    }
}
