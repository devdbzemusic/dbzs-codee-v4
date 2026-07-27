using System;
using System.Drawing;
using System.Windows.Forms;
using DBZLocaleAI.WinForms.Styles;

namespace DBZLocaleAI.WinForms.Forms
{
    /// <summary>
    /// DBZS Header: Einstellungen
    /// Konfiguration von APIs, Modellen und Systemparametern
    /// Implementiert im DBZS Neon Style
    /// </summary>
    public partial class SettingsForm : Form
    {
        private TabControl _settingsTabs;

        public SettingsForm()
        {
            InitializeComponent();
            SetupUI();
            NeonStyle.Apply(this);
        }

        private void SetupUI()
        {
            this.BackColor = NeonStyle.Background;

            _settingsTabs = new TabControl
            {
                Dock = DockStyle.Fill,
                Padding = new Point(10, 5)
            };

            AddSettingsTab("Allgemein");
            AddSettingsTab("API-Keys");
            AddSettingsTab("Modelle");
            AddSettingsTab("Hardware");
            AddSettingsTab("Plugins");

            this.Controls.Add(_settingsTabs);
        }

        private void AddSettingsTab(string title)
        {
            var tab = new TabPage(title)
            {
                BackColor = NeonStyle.Background,
                Padding = new Padding(20)
            };

            var lblTitle = new Label
            {
                Text = $"{title} Einstellungen",
                Font = NeonStyle.FontHeader,
                ForeColor = NeonStyle.NeonCyan,
                AutoSize = true,
                Location = new Point(20, 20)
            };
            tab.Controls.Add(lblTitle);

            _settingsTabs.TabPages.Add(tab);
        }

        private void InitializeComponent()
        {
            this.SuspendLayout();
            this.Name = "SettingsForm";
            this.Text = "Einstellungen";
            this.ResumeLayout(false);
        }
    }
}
