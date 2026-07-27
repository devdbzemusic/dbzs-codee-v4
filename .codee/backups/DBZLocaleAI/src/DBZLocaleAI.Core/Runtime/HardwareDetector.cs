using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading.Tasks;

namespace DBZLocaleAI.Core.Runtime
{
    /// <summary>
    /// DBZS Header: Hardware-Erkennung
    /// Erkennt GPU, CPU und RAM-Konfiguration
    /// Optimiert für Nvidia GPUs und Windows-Systeme
    /// </summary>
    public class HardwareDetector
    {
        private static readonly Lazy<HardwareDetector> _instance = new(() => new HardwareDetector());
        public static HardwareDetector Instance => _instance.Value;

        private HardwareInfo _cachedHardwareInfo;
        private DateTime _cacheTime = DateTime.MinValue;
        private const int CacheDurationSeconds = 300; // 5 Minuten

        /// <summary>
        /// Erkennt die Hardware-Konfiguration
        /// </summary>
        public async Task<HardwareInfo> DetectHardwareAsync()
        {
            // Cache-Logik: Nur einmal pro 5 Minuten neu erkennen
            if (_cachedHardwareInfo != null && (DateTime.UtcNow - _cacheTime).TotalSeconds < CacheDurationSeconds)
            {
                return _cachedHardwareInfo;
            }

            var info = new HardwareInfo
            {
                OsName = GetOsName(),
                Architecture = RuntimeInformation.ProcessArchitecture.ToString(),
                CpuModel = GetCpuModel(),
                CpuCores = Environment.ProcessorCount,
                CpuThreads = Environment.ProcessorCount,
                TotalRamBytes = GetTotalRamBytes(),
            };

            // GPU-Erkennung (Nvidia)
            var gpuInfo = await DetectNvidiaGpuAsync();
            if (gpuInfo != null)
            {
                info.GpuName = gpuInfo.Name;
                info.GpuVendor = "nvidia";
                info.GpuVramBytes = gpuInfo.VramBytes;
            }

            _cachedHardwareInfo = info;
            _cacheTime = DateTime.UtcNow;

            return info;
        }

        /// <summary>
        /// Erkennt Nvidia GPU mittels nvidia-smi
        /// </summary>
        private async Task<(string Name, long VramBytes)> DetectNvidiaGpuAsync()
        {
            try
            {
                // Versuche nvidia-smi zu finden
                var nvidiaSmiBinary = GetNvidiaSmiBinary();
                if (string.IsNullOrEmpty(nvidiaSmiBinary))
                {
                    return null;
                }

                var psi = new ProcessStartInfo
                {
                    FileName = nvidiaSmiBinary,
                    Arguments = "--query-gpu=name,memory.total --format=csv,noheader",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    CreateNoWindow = true,
                };

                using (var process = Process.Start(psi))
                {
                    if (process == null)
                        return null;

                    var output = await process.StandardOutput.ReadToEndAsync();
                    process.WaitForExit(5000);

                    if (string.IsNullOrWhiteSpace(output))
                        return null;

                    var lines = output.Trim().Split('\n');
                    if (lines.Length > 0)
                    {
                        var parts = lines[0].Split(',');
                        if (parts.Length >= 2)
                        {
                            var gpuName = parts[0].Trim();
                            var vramStr = parts[1].Trim().Replace(" MiB", "").Trim();

                            if (long.TryParse(vramStr, out var vramMb))
                            {
                                return (gpuName, vramMb * 1024 * 1024);
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Fehler bei GPU-Erkennung: {ex.Message}");
            }

            return null;
        }

        /// <summary>
        /// Findet den Pfad zu nvidia-smi
        /// </summary>
        private string GetNvidiaSmiBinary()
        {
            var commonPaths = new[]
            {
                "nvidia-smi",
                "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe",
                "C:\\Program Files (x86)\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe",
                "C:\\Windows\\System32\\nvidia-smi.exe",
            };

            foreach (var path in commonPaths)
            {
                try
                {
                    var psi = new ProcessStartInfo
                    {
                        FileName = path,
                        Arguments = "--version",
                        UseShellExecute = false,
                        RedirectStandardOutput = true,
                        CreateNoWindow = true,
                    };

                    using (var process = Process.Start(psi))
                    {
                        if (process != null && process.WaitForExit(2000))
                        {
                            return path;
                        }
                    }
                }
                catch
                {
                    // Ignorieren und nächsten Pfad versuchen
                }
            }

            return null;
        }

        /// <summary>
        /// Gibt den Betriebssystem-Namen zurück
        /// </summary>
        private string GetOsName()
        {
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
                return "Windows";
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
                return "Linux";
            if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
                return "macOS";
            return "Unknown";
        }

        /// <summary>
        /// Gibt das CPU-Modell zurück (Windows)
        /// </summary>
        private string GetCpuModel()
        {
            try
            {
                if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
                {
                    var psi = new ProcessStartInfo
                    {
                        FileName = "wmic",
                        Arguments = "cpu get name",
                        UseShellExecute = false,
                        RedirectStandardOutput = true,
                        CreateNoWindow = true,
                    };

                    using (var process = Process.Start(psi))
                    {
                        if (process != null)
                        {
                            var output = process.StandardOutput.ReadToEnd();
                            process.WaitForExit(2000);

                            var lines = output.Split('\n');
                            if (lines.Length > 1)
                            {
                                return lines[1].Trim();
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Fehler bei CPU-Erkennung: {ex.Message}");
            }

            return RuntimeInformation.ProcessArchitecture.ToString();
        }

        /// <summary>
        /// Gibt die Gesamtmenge des RAM in Bytes zurück
        /// </summary>
        private long GetTotalRamBytes()
        {
            try
            {
                if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
                {
                    var psi = new ProcessStartInfo
                    {
                        FileName = "wmic",
                        Arguments = "os get TotalVisibleMemorySize",
                        UseShellExecute = false,
                        RedirectStandardOutput = true,
                        CreateNoWindow = true,
                    };

                    using (var process = Process.Start(psi))
                    {
                        if (process != null)
                        {
                            var output = process.StandardOutput.ReadToEnd();
                            process.WaitForExit(2000);

                            var lines = output.Split('\n');
                            if (lines.Length > 1 && long.TryParse(lines[1].Trim(), out var ramKb))
                            {
                                return ramKb * 1024;
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Fehler bei RAM-Erkennung: {ex.Message}");
            }

            return 0;
        }

        /// <summary>
        /// Gibt den aktuellen GPU-Speicher-Verbrauch zurück (in Bytes)
        /// </summary>
        public async Task<long> GetGpuMemoryUsageAsync()
        {
            try
            {
                var nvidiaSmiBinary = GetNvidiaSmiBinary();
                if (string.IsNullOrEmpty(nvidiaSmiBinary))
                    return 0;

                var psi = new ProcessStartInfo
                {
                    FileName = nvidiaSmiBinary,
                    Arguments = "--query-gpu=memory.used --format=csv,noheader",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    CreateNoWindow = true,
                };

                using (var process = Process.Start(psi))
                {
                    if (process == null)
                        return 0;

                    var output = await process.StandardOutput.ReadToEndAsync();
                    process.WaitForExit(5000);

                    var lines = output.Trim().Split('\n');
                    if (lines.Length > 0)
                    {
                        var usedStr = lines[0].Trim().Replace(" MiB", "").Trim();
                        if (long.TryParse(usedStr, out var usedMb))
                        {
                            return usedMb * 1024 * 1024;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Fehler bei GPU-Memory-Abfrage: {ex.Message}");
            }

            return 0;
        }

        /// <summary>
        /// Gibt den aktuellen RAM-Verbrauch zurück (in Bytes)
        /// </summary>
        public long GetRamUsage()
        {
            try
            {
                var process = Process.GetCurrentProcess();
                return process.WorkingSet64;
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Fehler bei RAM-Verbrauch-Abfrage: {ex.Message}");
            }

            return 0;
        }

        /// <summary>
        /// Gibt die verfügbare RAM (in Bytes) zurück
        /// </summary>
        public long GetAvailableRam()
        {
            try
            {
                if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
                {
                    var psi = new ProcessStartInfo
                    {
                        FileName = "wmic",
                        Arguments = "os get FreePhysicalMemory",
                        UseShellExecute = false,
                        RedirectStandardOutput = true,
                        CreateNoWindow = true,
                    };

                    using (var process = Process.Start(psi))
                    {
                        if (process != null)
                        {
                            var output = process.StandardOutput.ReadToEnd();
                            process.WaitForExit(2000);

                            var lines = output.Split('\n');
                            if (lines.Length > 1 && long.TryParse(lines[1].Trim(), out var freeKb))
                            {
                                return freeKb * 1024;
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Fehler bei verfügbarem RAM-Abfrage: {ex.Message}");
            }

            return 0;
        }
    }
}
