/*
 * DBZS – Division By Zeros
 * Datei: BackendProcessService.cs
 * Bereich: Model Operations Center / WinUI Backend Bootstrap
 *
 * Zweck:
 *   Startet das lokale Codee-FastAPI-Backend fuer die native Model-Ops-App,
 *   wenn der konfigurierte Backend-Port noch nicht antwortet.
 *
 * Warum:
 *   Die WinUI-App soll beim Start nicht leer wirken, waehrend das Python-
 *   Backend noch importiert oder noch gar nicht gestartet wurde.
 *
 * Wozu:
 *   Der Splashscreen kann echte Startschritte anzeigen und das Backend bei
 *   lokaler Entwicklung selbst anwerfen.
 *
 * Input:
 *   Repo-Struktur auf dem lokalen Dateisystem, Backend-Port und optionaler
 *   Status-Callback fuer UI-Texte.
 *
 * Output:
 *   Startet einen versteckten Python/Uvicorn-Prozess und schreibt Logs in das
 *   temporaere Benutzerverzeichnis.
 *
 * Eltern:
 *   MainViewModel.InitializeAsync.
 *
 * Kinder:
 *   System.Diagnostics.Process, backend/.venv/Scripts/python.exe.
 *
 * Hinweise:
 *   Secrets werden nicht gelesen oder geloggt. Der Prozess erbt EnvVars vom
 *   Benutzerprozess, damit vorhandene API-Key-Konfigurationen funktionieren.
 */

using System.Diagnostics;
using System.Net.Sockets;

namespace DBZS.Codee.ModelOps.WinUI.Services;

public sealed class BackendProcessService
{
    private const int BackendPort = 8876;

    public string? LastLogPath { get; private set; }
    public string? LastErrorLogPath { get; private set; }

    public async Task EnsureBackendStartedAsync(Action<string>? reportStatus, CancellationToken cancellationToken)
    {
        if (await IsPortOpenAsync(cancellationToken))
        {
            reportStatus?.Invoke("Backend-Port 8876 antwortet bereits.");
            return;
        }

        var repoRoot = FindRepoRoot();
        if (repoRoot is null)
        {
            reportStatus?.Invoke("Repo-Root nicht gefunden. Warte auf extern gestartetes Backend.");
            return;
        }

        var backendDir = Path.Combine(repoRoot, "backend");
        var pythonExe = Path.Combine(backendDir, ".venv", "Scripts", "python.exe");
        if (!File.Exists(pythonExe))
        {
            reportStatus?.Invoke($"Backend-Python nicht gefunden: {pythonExe}");
            return;
        }

        var logPrefix = Path.Combine(Path.GetTempPath(), "dbzs-codee-moc-backend");
        LastLogPath = $"{logPrefix}.out.log";
        LastErrorLogPath = $"{logPrefix}.err.log";

        reportStatus?.Invoke("Starte Codee Backend über lokale Python-Umgebung...");
        var startInfo = new ProcessStartInfo
        {
            FileName = pythonExe,
            Arguments = "-m uvicorn app.main:app --host 127.0.0.1 --port 8876",
            WorkingDirectory = backendDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, args) => AppendLogLine(LastLogPath, args.Data);
        process.ErrorDataReceived += (_, args) => AppendLogLine(LastErrorLogPath, args.Data);

        if (!process.Start())
        {
            reportStatus?.Invoke("Backend-Prozess konnte nicht gestartet werden.");
            return;
        }

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        reportStatus?.Invoke($"Backend-Prozess gestartet: PID {process.Id}.");
    }

    private static async Task<bool> IsPortOpenAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var client = new TcpClient();
            await client.ConnectAsync("127.0.0.1", BackendPort, cancellationToken);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static string? FindRepoRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var backendMain = Path.Combine(current.FullName, "backend", "app", "main.py");
            if (File.Exists(backendMain))
            {
                return current.FullName;
            }

            current = current.Parent;
        }

        return null;
    }

    private static void AppendLogLine(string? path, string? line)
    {
        if (string.IsNullOrWhiteSpace(path) || line is null)
        {
            return;
        }

        try
        {
            File.AppendAllText(path, line + Environment.NewLine);
        }
        catch
        {
            // Logging darf den Backend-Start nicht abbrechen.
        }
    }
}
