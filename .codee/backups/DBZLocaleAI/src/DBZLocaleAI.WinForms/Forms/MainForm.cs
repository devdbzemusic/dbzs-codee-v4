using System;
using System.Drawing;
using System.Windows.Forms;
using DBZLocaleAI.WinForms.Styles;
using DBZLocaleAI.Core.Runtime;

namespace DBZLocaleAI.WinForms.Forms
{
    /// <summary>
    /// DBZS Header: Hauptformular der Anwendung
    /// Zentrales Dashboard für Chat, Agenten und Slot-Verwaltung
    /// Implementiert im DBZS Neon Style
    /// </summary>
    public partial class MainForm : Form
    {
        private Panel _sidebar;
        private Panel _mainContent;
        private Panel _statusBar;
        private Label _statusLabel;
        private Label _gpuLabel;
        private Label _cpuLabel;
        private Label _ramLabel;

        public MainForm()
        {
            InitializeComponent();
            SetupUI();
            NeonStyle.Apply(this);
            this.Text = "DBZ Locale AI - Division By Zeros (DBZS)";
            this.Size = new Size(1280, 800);
            this.StartPosition = FormStartPosition.CenterScreen;
        }

        private void SetupUI()
        {
            // Sidebar
            _sidebar = new Panel
            {
                Dock = DockStyle.Left,
                Width = 220,
                BackColor = NeonStyle.PanelBackground,
                Padding = new Padding(10)
            };

            var logoLabel = new Label
            {
                Text = "DBZ LOCALE AI",
                Font = new Font("Segoe UI", 16, FontStyle.Bold),
                ForeColor = NeonStyle.NeonCyan,
                Dock = DockStyle.Top,
                Height = 60,
                TextAlign = ContentAlignment.MiddleCenter
            };
            _sidebar.Controls.Add(logoLabel);

            AddSidebarButton("Chat", 0);
            AddSidebarButton("Agenten", 1);
            AddSidebarButton("Modelle", 2);
            AddSidebarButton("Projekte", 3);
            AddSidebarButton("Einstellungen", 4);

            // Status Bar
            _statusBar = new Panel
            {
                Dock = DockStyle.Bottom,
                Height = 30,
                BackColor = Color.FromArgb(15, 15, 25),
                Padding = new Padding(5, 0, 5, 0)
            };

            _statusLabel = new Label { Text = "Bereit", AutoSize = true, Dock = DockStyle.Left, TextAlign = ContentAlignment.MiddleLeft };
            _gpuLabel = new Label { Text = "GPU: --", AutoSize = true, Dock = DockStyle.Right, TextAlign = ContentAlignment.MiddleLeft, ForeColor = NeonStyle.NeonBlue };
            _cpuLabel = new Label { Text = "CPU: --", AutoSize = true, Dock = DockStyle.Right, TextAlign = ContentAlignment.MiddleLeft, ForeColor = NeonStyle.NeonBlue };
            _ramLabel = new Label { Text = "RAM: --", AutoSize = true, Dock = DockStyle.Right, TextAlign = ContentAlignment.MiddleLeft, ForeColor = NeonStyle.NeonBlue };

            _statusBar.Controls.Add(_statusLabel);
            _statusBar.Controls.Add(_ramLabel);
            _statusBar.Controls.Add(new Label { Width = 20, Dock = DockStyle.Right }); // Spacer
            _statusBar.Controls.Add(_cpuLabel);
            _statusBar.Controls.Add(new Label { Width = 20, Dock = DockStyle.Right }); // Spacer
            _statusBar.Controls.Add(_gpuLabel);

            // Main Content
            _mainContent = new Panel
            {
                Dock = DockStyle.Fill,
                BackColor = NeonStyle.Background,
                Padding = new Padding(20)
            };

            // Dashboard Content (Placeholder)
            var welcomeLabel = new Label
            {
                Text = "Willkommen bei DBZ Locale AI",
                Font = NeonStyle.FontHeader,
                ForeColor = NeonStyle.NeonCyan,
                AutoSize = true,
                Location = new Point(20, 20)
            };
            _mainContent.Controls.Add(welcomeLabel);

            // Slot Panel (Inspiration von DBZS Codee)
            var slotPanel = NeonStyle.CreateNeonPanel();
            slotPanel.Size = new Size(400, 300);
            slotPanel.Location = new Point(20, 60);
            
            var slotHeader = new Label
            {
                Text = "Runtime Slots",
                Font = new Font("Segoe UI", 11, FontStyle.Bold),
                ForeColor = NeonStyle.TextPrimary,
                Dock = DockStyle.Top,
                Height = 30
            };
            slotPanel.Controls.Add(slotHeader);

            AddSlotControl(slotPanel, "fast_gpu", "Llama-3.2-1B", "Running", 30);
            AddSlotControl(slotPanel, "quality_cpu", "Mistral-7B", "Stopped", 80);
            AddSlotControl(slotPanel, "utility", "None", "Stopped", 130);

            _mainContent.Controls.Add(slotPanel);

            this.Controls.Add(_mainContent);
            this.Controls.Add(_sidebar);
            this.Controls.Add(_statusBar);
        }

        private void AddSidebarButton(string text, int index)
        {
            var btn = NeonStyle.CreateNeonButton(text);
            btn.Dock = DockStyle.Top;
            btn.Height = 45;
            btn.Margin = new Padding(0, 5, 0, 5);
            btn.Tag = index;
            btn.Click += (s, e) => { _statusLabel.Text = $"Navigiere zu: {text}"; };
            
            // Umgekehrte Reihenfolge für Dock.Top
            _sidebar.Controls.Add(btn);
            _sidebar.Controls.SetChildIndex(btn, 1); // Nach dem Logo
        }

        private void AddSlotControl(Panel parent, string id, string model, string status, int y)
        {
            var p = new Panel
            {
                Location = new Point(10, y + 10),
                Size = new Size(parent.Width - 20, 45),
                BackColor = Color.FromArgb(30, 30, 45),
                BorderStyle = BorderStyle.FixedSingle
            };

            var lblId = new Label { Text = id, Location = new Point(5, 5), AutoSize = true, Font = new Font("Segoe UI", 9, FontStyle.Bold) };
            var lblModel = new Label { Text = model, Location = new Point(5, 22), AutoSize = true, ForeColor = NeonStyle.TextSecondary, Font = NeonStyle.FontSmall };
            
            var lblStatus = new Label 
            { 
                Text = status, 
                Location = new Point(p.Width - 70, 5), 
                AutoSize = true, 
                ForeColor = status == "Running" ? NeonStyle.Success : NeonStyle.TextSecondary 
            };

            var btnStart = new Button
            {
                Text = status == "Running" ? "Stop" : "Start",
                Size = new Size(50, 20),
                Location = new Point(p.Width - 60, 22),
                FlatStyle = FlatStyle.Flat,
                Font = NeonStyle.FontSmall,
                BackColor = Color.FromArgb(40, 40, 60)
            };

            p.Controls.Add(lblId);
            p.Controls.Add(lblModel);
            p.Controls.Add(lblStatus);
            p.Controls.Add(btnStart);
            parent.Controls.Add(p);
        }

        private void InitializeComponent()
        {
            this.SuspendLayout();
            this.Name = "MainForm";
            this.Text = "MainForm";
            this.ResumeLayout(false);
        }
    }
}
