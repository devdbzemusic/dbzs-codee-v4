using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using DBZS.Codee.ModelOps.WinUI.Models;
using DBZS.Codee.ModelOps.WinUI.Services;

namespace DBZS.Codee.ModelOps.WinUI.ViewModels;

public sealed partial class MainViewModel : ObservableObject
{
    private readonly ModelLabApiClient _apiClient = new();

    public ObservableCollection<ModelSourceDto> Sources { get; } = [];
    public ObservableCollection<ModelLabModelDto> Models { get; } = [];
    public ObservableCollection<ModelLabModelDto> FilteredModels { get; } = [];
    public ObservableCollection<ModelCollectionDto> Collections { get; } = [];

    private string _backendUrl = "http://127.0.0.1:8876";
    private string _newSourcePath = "";
    private string _modelFilterText = "";
    private string _healthFilterText = "";
    private bool _favoritesOnly;
    private string _selectedTagsText = "";
    private string _selectedNotes = "";
    private bool _selectedIsFavorite;
    private string _statusText = "Bereit. Verbinde mit lokalem Codee Backend.";
    private string _scanStatusText = "Quelle eintragen oder gespeicherte Quellen scannen.";
    private HardwareProfileDto? _hardware;
    private ModelLabModelDto? _selectedModel;

    public string BackendUrl
    {
        get => _backendUrl;
        set
        {
            if (SetProperty(ref _backendUrl, value))
            {
                _apiClient.BackendUrl = value;
            }
        }
    }

    public string NewSourcePath
    {
        get => _newSourcePath;
        set => SetProperty(ref _newSourcePath, value);
    }

    public string ModelFilterText
    {
        get => _modelFilterText;
        set
        {
            if (SetProperty(ref _modelFilterText, value))
            {
                ApplyModelFilters();
            }
        }
    }

    public string HealthFilterText
    {
        get => _healthFilterText;
        set
        {
            if (SetProperty(ref _healthFilterText, value))
            {
                ApplyModelFilters();
            }
        }
    }

    public bool FavoritesOnly
    {
        get => _favoritesOnly;
        set
        {
            if (SetProperty(ref _favoritesOnly, value))
            {
                ApplyModelFilters();
            }
        }
    }

    public string SelectedTagsText
    {
        get => _selectedTagsText;
        set => SetProperty(ref _selectedTagsText, value);
    }

    public string SelectedNotes
    {
        get => _selectedNotes;
        set => SetProperty(ref _selectedNotes, value);
    }

    public bool SelectedIsFavorite
    {
        get => _selectedIsFavorite;
        set => SetProperty(ref _selectedIsFavorite, value);
    }

    public string StatusText
    {
        get => _statusText;
        set => SetProperty(ref _statusText, value);
    }

    public string ScanStatusText
    {
        get => _scanStatusText;
        set => SetProperty(ref _scanStatusText, value);
    }

    public HardwareProfileDto? Hardware
    {
        get => _hardware;
        set
        {
            if (SetProperty(ref _hardware, value))
            {
                OnPropertyChanged(nameof(HardwareSummary));
            }
        }
    }

    public ModelLabModelDto? SelectedModel
    {
        get => _selectedModel;
        set
        {
            if (SetProperty(ref _selectedModel, value))
            {
                SyncSelectedMetadataFields();
                OnPropertyChanged(nameof(SelectedContextSummary));
            }
        }
    }

    public int ModelCount => Models.Count;
    public int FilteredModelCount => FilteredModels.Count;
    public string ModelLibrarySummary => $"{FilteredModelCount} von {ModelCount} Modellen angezeigt";
    public int SourceCount => Sources.Count;
    public int JobCount { get; private set; }
    public int CollectionCount => Collections.Count;
    public string CollectionSummary => $"Collections: {CollectionCount}";
    public string SelectedContextSummary => SelectedModel?.Bundle.Health.ContextLength is int context
        ? $"Context: {context}"
        : "Context: unbekannt";

    public string HardwareSummary
    {
        get
        {
            if (Hardware is null)
            {
                return "Hardwareprofil noch nicht geladen.";
            }

            var gpu = string.IsNullOrWhiteSpace(Hardware.GpuName) ? "keine Compute-GPU erkannt" : Hardware.GpuName;
            return $"{Hardware.CpuThreads} CPU-Threads, {Hardware.RamBytes / 1024 / 1024 / 1024} GB RAM, {gpu}";
        }
    }

    [RelayCommand]
    private async Task RefreshAsync()
    {
        try
        {
            StatusText = "Lade Model-Lab-Daten...";
            _apiClient.BackendUrl = BackendUrl;
            var sourcesTask = _apiClient.GetSourcesAsync(CancellationToken.None);
            var modelsTask = _apiClient.GetModelsAsync(CancellationToken.None);
            var jobsTask = _apiClient.GetJobsAsync(CancellationToken.None);
            var collectionsTask = _apiClient.GetCollectionsAsync(CancellationToken.None);
            var hardwareTask = _apiClient.GetHardwareAsync(CancellationToken.None);
            await Task.WhenAll(sourcesTask, modelsTask, jobsTask, collectionsTask, hardwareTask);

            Replace(Sources, sourcesTask.Result);
            Replace(Models, modelsTask.Result);
            Replace(Collections, collectionsTask.Result);
            ApplyModelFilters();
            JobCount = jobsTask.Result.Count;
            Hardware = hardwareTask.Result;
            SelectedModel ??= FilteredModels.FirstOrDefault();
            StatusText = "Model Lab synchronisiert.";
            OnPropertyChanged(nameof(ModelCount));
            OnPropertyChanged(nameof(FilteredModelCount));
            OnPropertyChanged(nameof(ModelLibrarySummary));
            OnPropertyChanged(nameof(SourceCount));
            OnPropertyChanged(nameof(CollectionCount));
            OnPropertyChanged(nameof(CollectionSummary));
            OnPropertyChanged(nameof(HardwareSummary));
        }
        catch (Exception exc)
        {
            StatusText = $"Backend nicht erreichbar: {exc.Message}";
        }
    }

    [RelayCommand]
    private async Task SaveSelectedMetadataAsync()
    {
        if (SelectedModel is null)
        {
            StatusText = "Kein Modell ausgewaehlt.";
            return;
        }

        try
        {
            var update = new ModelMetadataUpdateDto
            {
                Tags = SelectedTagsText
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .OrderBy(tag => tag)
                    .ToList(),
                IsFavorite = SelectedIsFavorite,
                Notes = SelectedNotes,
            };
            var bundle = await _apiClient.UpdateMetadataAsync(SelectedModel.Bundle.BundleId, update, CancellationToken.None);
            if (bundle is not null)
            {
                SelectedModel.Bundle = bundle;
                ApplyModelFilters();
                StatusText = "Modell-Metadaten gespeichert.";
            }
        }
        catch (Exception exc)
        {
            StatusText = $"Metadaten konnten nicht gespeichert werden: {exc.Message}";
        }
    }

    [RelayCommand]
    private void ClearModelFilters()
    {
        ModelFilterText = "";
        HealthFilterText = "";
        FavoritesOnly = false;
        ApplyModelFilters();
    }

    [RelayCommand]
    private async Task AddSourceAsync()
    {
        if (string.IsNullOrWhiteSpace(NewSourcePath))
        {
            ScanStatusText = "Bitte einen Modellpfad eintragen.";
            return;
        }

        try
        {
            var source = await _apiClient.AddSourceAsync(NewSourcePath, CancellationToken.None);
            if (source is not null)
            {
                Sources.Add(source);
                NewSourcePath = "";
                ScanStatusText = "Quelle gespeichert.";
                OnPropertyChanged(nameof(SourceCount));
            }
        }
        catch (Exception exc)
        {
            ScanStatusText = $"Quelle konnte nicht gespeichert werden: {exc.Message}";
        }
    }

    [RelayCommand]
    private async Task ScanAsync()
    {
        try
        {
            ScanStatusText = "Scan laeuft...";
            ModelSourceDto? source = null;
            if (!string.IsNullOrWhiteSpace(NewSourcePath))
            {
                source = await _apiClient.AddSourceAsync(NewSourcePath, CancellationToken.None);
                if (source is not null && Sources.All(existing => existing.Id != source.Id))
                {
                    Sources.Add(source);
                    OnPropertyChanged(nameof(SourceCount));
                }
            }

            if (source is null && Sources.Count == 0)
            {
                ScanStatusText = "Keine Modellquelle gespeichert. Bitte zuerst einen Modellordner eintragen.";
                return;
            }

            var result = await _apiClient.ScanAsync(source?.Id, CancellationToken.None);
            if (result is not null)
            {
                ScanStatusText = result.Job.Error is null
                    ? $"Scan abgeschlossen: {result.Job.ArtifactCount} Artefakte, {result.Job.BundleCount} Bundles."
                    : $"Scan fehlgeschlagen: {result.Job.Error}";
                OnPropertyChanged(nameof(JobCount));
            }
            await RefreshAsync();
        }
        catch (Exception exc)
        {
            ScanStatusText = $"Scan konnte nicht gestartet werden: {exc.Message}";
        }
    }

    private static void Replace<T>(ObservableCollection<T> target, IEnumerable<T> values)
    {
        target.Clear();
        foreach (var value in values)
        {
            target.Add(value);
        }
    }

    private void ApplyModelFilters()
    {
        var text = ModelFilterText.Trim().ToLowerInvariant();
        var health = HealthFilterText.Trim().ToLowerInvariant();
        var filtered = Models.Where(model =>
        {
            if (FavoritesOnly && !model.Bundle.IsFavorite)
            {
                return false;
            }

            if (!string.IsNullOrWhiteSpace(health) && !model.Bundle.Health.Status.ToLowerInvariant().Contains(health))
            {
                return false;
            }

            if (string.IsNullOrWhiteSpace(text))
            {
                return true;
            }

            var haystack = string.Join(" ", new[]
            {
                model.Bundle.Name,
                model.Bundle.Status,
                model.Bundle.Health.Status,
                model.Bundle.Health.ModelType,
                model.Bundle.Health.Architecture ?? "",
                model.CapabilitySummary,
                model.TagSummary,
            }).ToLowerInvariant();
            return haystack.Contains(text);
        });

        Replace(FilteredModels, filtered);
        if (SelectedModel is not null && !FilteredModels.Any(model => model.Bundle.BundleId == SelectedModel.Bundle.BundleId))
        {
            SelectedModel = FilteredModels.FirstOrDefault();
        }
        OnPropertyChanged(nameof(FilteredModelCount));
        OnPropertyChanged(nameof(ModelLibrarySummary));
    }

    private void SyncSelectedMetadataFields()
    {
        SelectedTagsText = SelectedModel is null ? "" : string.Join(", ", SelectedModel.Bundle.Tags);
        SelectedNotes = SelectedModel?.Bundle.Notes ?? "";
        SelectedIsFavorite = SelectedModel?.Bundle.IsFavorite ?? false;
    }
}
