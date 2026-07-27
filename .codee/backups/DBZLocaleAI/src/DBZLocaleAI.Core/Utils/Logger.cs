using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using System.Threading;

namespace DBZLocaleAI.Core.Utils
{
    /// <summary>
    /// DBZS Header: Logging-Framework
    /// Umfassendes Logging für alle Komponenten
    /// Unterstützt verschiedene Log-Level und Ausgabeziele
    /// </summary>
    public enum LogLevel
    {
        Debug = 0,
        Info = 1,
        Warning = 2,
        Error = 3,
        Critical = 4
    }

    public interface ILogger
    {
        void Debug(string message, Dictionary<string, object> context = null);
        void Info(string message, Dictionary<string, object> context = null);
        void Warning(string message, Dictionary<string, object> context = null);
        void Error(string message, Exception ex = null, Dictionary<string, object> context = null);
        void Critical(string message, Exception ex = null, Dictionary<string, object> context = null);
    }

    /// <summary>
    /// Centralized logger with file and console output
    /// </summary>
    public class Logger : ILogger
    {
        private readonly string _category;
        private readonly string _logFilePath;
        private readonly LogLevel _minLogLevel;
        private readonly ReaderWriterLockSlim _lock = new();
        private readonly List<string> _buffer = new();
        private const int BufferSize = 100;

        public Logger(string category, string logDirectory = null, LogLevel minLogLevel = LogLevel.Debug)
        {
            _category = category;
            _minLogLevel = minLogLevel;

            if (logDirectory == null)
            {
                logDirectory = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "DBZLocaleAI",
                    "Logs"
                );
            }

            Directory.CreateDirectory(logDirectory);
            _logFilePath = Path.Combine(
                logDirectory,
                $"dbz_locale_ai_{DateTime.Now:yyyyMMdd}.log"
            );
        }

        public void Debug(string message, Dictionary<string, object> context = null)
        {
            Log(LogLevel.Debug, message, null, context);
        }

        public void Info(string message, Dictionary<string, object> context = null)
        {
            Log(LogLevel.Info, message, null, context);
        }

        public void Warning(string message, Dictionary<string, object> context = null)
        {
            Log(LogLevel.Warning, message, null, context);
        }

        public void Error(string message, Exception ex = null, Dictionary<string, object> context = null)
        {
            Log(LogLevel.Error, message, ex, context);
        }

        public void Critical(string message, Exception ex = null, Dictionary<string, object> context = null)
        {
            Log(LogLevel.Critical, message, ex, context);
        }

        private void Log(LogLevel level, string message, Exception ex, Dictionary<string, object> context)
        {
            if (level < _minLogLevel)
                return;

            var timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
            var levelStr = level.ToString().ToUpper().PadRight(8);
            var logMessage = $"[{timestamp}] [{levelStr}] [{_category}] {message}";

            if (ex != null)
            {
                logMessage += $"\n  Exception: {ex.GetType().Name}: {ex.Message}";
                logMessage += $"\n  StackTrace: {ex.StackTrace}";
            }

            if (context != null && context.Count > 0)
            {
                logMessage += "\n  Context:";
                foreach (var kvp in context)
                {
                    logMessage += $"\n    {kvp.Key}: {kvp.Value}";
                }
            }

            _lock.EnterWriteLock();
            try
            {
                _buffer.Add(logMessage);

                // Console output
                Console.WriteLine(logMessage);

                // Flush buffer if it reaches the size limit
                if (_buffer.Count >= BufferSize)
                {
                    FlushBuffer();
                }
            }
            finally
            {
                _lock.ExitWriteLock();
            }
        }

        private void FlushBuffer()
        {
            try
            {
                File.AppendAllLines(_logFilePath, _buffer);
                _buffer.Clear();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Failed to write to log file: {ex.Message}");
            }
        }

        public void Flush()
        {
            _lock.EnterWriteLock();
            try
            {
                if (_buffer.Count > 0)
                {
                    FlushBuffer();
                }
            }
            finally
            {
                _lock.ExitWriteLock();
            }
        }

        ~Logger()
        {
            Flush();
        }
    }

    /// <summary>
    /// Global logger factory
    /// </summary>
    public static class LoggerFactory
    {
        private static readonly Dictionary<string, ILogger> _loggers = new();
        private static readonly ReaderWriterLockSlim _lock = new();
        private static string _logDirectory;
        private static LogLevel _globalMinLogLevel = LogLevel.Debug;

        public static void Configure(string logDirectory, LogLevel minLogLevel = LogLevel.Debug)
        {
            _lock.EnterWriteLock();
            try
            {
                _logDirectory = logDirectory;
                _globalMinLogLevel = minLogLevel;
                _loggers.Clear(); // Clear existing loggers to use new config
            }
            finally
            {
                _lock.ExitWriteLock();
            }
        }

        public static ILogger GetLogger(string category)
        {
            _lock.EnterUpgradeableReadLock();
            try
            {
                if (_loggers.TryGetValue(category, out var logger))
                {
                    return logger;
                }

                _lock.EnterWriteLock();
                try
                {
                    var newLogger = new Logger(category, _logDirectory, _globalMinLogLevel);
                    _loggers[category] = newLogger;
                    return newLogger;
                }
                finally
                {
                    _lock.ExitWriteLock();
                }
            }
            finally
            {
                _lock.ExitUpgradeableReadLock();
            }
        }

        public static void FlushAll()
        {
            _lock.EnterReadLock();
            try
            {
                foreach (var logger in _loggers.Values.OfType<Logger>())
                {
                    logger.Flush();
                }
            }
            finally
            {
                _lock.ExitReadLock();
            }
        }
    }
}
