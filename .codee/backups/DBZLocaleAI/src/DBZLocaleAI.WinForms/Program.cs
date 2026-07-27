using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Serilog;
using DBZLocaleAI.Core.Services;
using DBZLocaleAI.WinForms.Forms;
using System;
using System.Windows.Forms;

namespace DBZLocaleAI.WinForms
{
    internal static class Program
    {
        /// <summary>
        /// The main entry point for the application.
        /// </summary>
        [STAThread]
        static void Main()
        {
            // Configure Serilog
            Log.Logger = new LoggerConfiguration()
                .WriteTo.File("logs/dbz-locale-ai-.txt", rollingInterval: RollingInterval.Day)
                .WriteTo.Console()
                .CreateLogger();

            try
            {
                // To customize application configuration such as set high DPI settings or default font,
                // see https://aka.ms/applicationconfiguration.
                ApplicationConfiguration.Initialize();

                // Configure services
                var services = new ServiceCollection();
                ConfigureServices(services);

                var serviceProvider = services.BuildServiceProvider();

                // Start the main form
                var mainForm = serviceProvider.GetRequiredService<MainForm>();
                Application.Run(mainForm);
            }
            catch (Exception ex)
            {
                Log.Fatal(ex, "Application terminated unexpectedly");
                MessageBox.Show($"Ein kritischer Fehler ist aufgetreten: {ex.Message}", "DBZ Locale AI - Fehler", 
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                Log.CloseAndFlush();
            }
        }

        private static void ConfigureServices(IServiceCollection services)
        {
            // Logging
            services.AddLogging(builder =>
            {
                builder.ClearProviders();
                builder.AddSerilog();
            });

            // Core services
            services.AddSingleton<IConfigurationService, ConfigurationService>();
            services.AddSingleton<IDatabaseService, DatabaseService>();
            services.AddSingleton<ILLMService, LLMService>();
            services.AddSingleton<IAgentService, AgentService>();

            // Forms
            services.AddTransient<MainForm>();
            services.AddTransient<SettingsForm>();
            services.AddTransient<ChatForm>();
            services.AddTransient<AgentForm>();
        }
    }
}

