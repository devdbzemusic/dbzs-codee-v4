using System;
using System.Drawing;
using System.Windows.Forms;
using DBZLocaleAI.WinForms.Styles;

namespace DBZLocaleAI.WinForms.Forms
{
    /// <summary>
    /// DBZS Header: Agenten-Workbench
    /// Interface für die Orchestrierung von KI-Agenten
    /// Implementiert im DBZS Neon Style
    /// </summary>
    public partial class AgentForm : Form
    {
        private Panel _agentList;
        private Panel _agentDetails;
        private Panel _taskMonitor;

        public AgentForm()
        {
            InitializeComponent();
            SetupUI();
            NeonStyle.Apply(this);
        }

        private void SetupUI()
        {
            this.BackColor = NeonStyle.Background;

            // Sidebar für Agenten-Liste
            _agentList = new Panel
            {
                Dock = DockStyle.Left,
                Width = 250,
                BackColor = NeonStyle.PanelBackground,
                Padding = new Padding(10)
            };

            var lblAgents = new Label
            {
                Text = "Verfügbare Agenten",
                Font = NeonStyle.FontHeader,
                ForeColor = NeonStyle.NeonCyan,
                Dock = DockStyle.Top,
                Height = 40
            };
            _agentList.Controls.Add(lblAgents);

            AddAgentItem("Planner", "Entwirft Strategien", 45);
            AddAgentItem("Coder", "Schreibt Code", 95);
            AddAgentItem("Reviewer", "Prüft Qualität", 145);
            AddAgentItem("Debugger", "Behebt Fehler", 195);

            // Task Monitor (Unten)
            _taskMonitor = new Panel
            {
                Dock = DockStyle.Bottom,
                Height = 200,
                BackColor = NeonStyle.PanelBackground,
                Padding = new Padding(10)
            };

            var lblMonitor = new Label
            {
                Text = "Task Monitor",
                Font = NeonStyle.FontHeader,
                ForeColor = NeonStyle.NeonCyan,
                Dock = DockStyle.Top,
                Height = 30
            };
            _taskMonitor.Controls.Add(lblMonitor);

            // Agent Details (Mitte)
            _agentDetails = new Panel
            {
                Dock = DockStyle.Fill,
                BackColor = NeonStyle.Background,
                Padding = new Padding(20)
            };

            var lblDetails = new Label
            {
                Text = "Agenten-Details & Workbench",
                Font = NeonStyle.FontHeader,
                ForeColor = NeonStyle.NeonCyan,
                AutoSize = true,
                Location = new Point(20, 20)
            };
            _agentDetails.Controls.Add(lblDetails);

            this.Controls.Add(_agentDetails);
            this.Controls.Add(_taskMonitor);
            this.Controls.Add(_agentList);
        }

        private void AddAgentItem(string name, string role, int y)
        {
            var p = new Panel
            {
                Location = new Point(10, y),
                Size = new Size(_agentList.Width - 20, 45),
                BackColor = Color.FromArgb(30, 30, 45),
                BorderStyle = BorderStyle.FixedSingle,
                Cursor = Cursors.Hand
            };

            var lblName = new Label { Text = name, Location = new Point(5, 5), AutoSize = true, Font = new Font("Segoe UI", 9, FontStyle.Bold) };
            var lblRole = new Label { Text = role, Location = new Point(5, 22), AutoSize = true, ForeColor = NeonStyle.TextSecondary, Font = NeonStyle.FontSmall };

            p.Controls.Add(lblName);
            p.Controls.Add(lblRole);
            _agentList.Controls.Add(p);
        }

        private void InitializeComponent()
        {
            this.SuspendLayout();
            this.Name = "AgentForm";
            this.Text = "Agenten";
            this.ResumeLayout(false);
        }
    }
}
