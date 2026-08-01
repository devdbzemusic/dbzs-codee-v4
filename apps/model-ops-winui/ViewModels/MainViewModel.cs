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

    private string _backendUrl = "http://127.0.0.1:8876";
    private string _newSourcePath = "";
    private string _statusText = "Bereit. Verbinde mit lokalem Codee Backend.";
    private string _scanStatusText = "Noch kein Scan ausgefuehrt.";
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
        set => SetProperty(ref _selectedModel, value);
    }

    public int ModelCount => Models.Count;
    public int SourceCount => Sources.Count;
    public int JobCount { get; private set; }

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
            var hardwareTask = _apiClient.GetHardwareAsync(CancellationToken.None);
            await Task.WhenAll(sourcesTask, modelsTask, jobsTask, hardwareTask);

            Replace(Sources, sourcesTask.Result);
            Replace(Models, modelsTask.Result);
            JobCount = jobsTask.Result.Count;
            Hardware = hardwareTask.Result;
            SelectedModel ??= Models.FirstOrDefault();
            StatusText = "Model Lab synchronisiert.";
            OnPropertyChanged(nameof(ModelCount));
            OnPropertyChanged(nameof(SourceCount));
            OnPropertyChanged(nameof(HardwareSummary));
        }
        catch (Exception exc)
        {
            StatusText = $"Backend nicht erreichbar: {exc.Message}";
        }
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
            var result = await _apiClient.ScanAsync(CancellationToken.None);
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
}
