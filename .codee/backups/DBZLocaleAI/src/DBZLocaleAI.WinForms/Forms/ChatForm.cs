using System;
using System.Drawing;
using System.Windows.Forms;
using DBZLocaleAI.WinForms.Styles;

namespace DBZLocaleAI.WinForms.Forms
{
    /// <summary>
    /// DBZS Header: Chat-Formular
    /// Interface für die Interaktion mit LLMs
    /// Implementiert im DBZS Neon Style
    /// </summary>
    public partial class ChatForm : Form
    {
        private Panel _chatHistory;
        private Panel _inputPanel;
        private TextBox _inputBox;
        private Button _sendButton;
        private ComboBox _modelSelector;

        public ChatForm()
        {
            InitializeComponent();
            SetupUI();
            NeonStyle.Apply(this);
        }

        private void SetupUI()
        {
            this.BackColor = NeonStyle.Background;

            // Header mit Modell-Auswahl
            var header = new Panel
            {
                Dock = DockStyle.Top,
                Height = 50,
                BackColor = NeonStyle.PanelBackground,
                Padding = new Padding(10)
            };

            var lblModel = new Label { Text = "Modell:", AutoSize = true, Location = new Point(10, 15) };
            _modelSelector = new ComboBox
            {
                Location = new Point(70, 12),
                Width = 250,
                BackColor = Color.FromArgb(30, 30, 50),
                ForeColor = NeonStyle.NeonCyan,
                FlatStyle = FlatStyle.Flat
            };
            _modelSelector.Items.AddRange(new[] { "Llama-3.2-1B (Lokal)", "Mistral-7B (Lokal)", "Claude 3.5 Sonnet (API)" });
            _modelSelector.SelectedIndex = 0;

            header.Controls.Add(lblModel);
            header.Controls.Add(_modelSelector);

            // Input Panel
            _inputPanel = new Panel
            {
                Dock = DockStyle.Bottom,
                Height = 100,
                BackColor = NeonStyle.PanelBackground,
                Padding = new Padding(10)
            };

            _inputBox = new TextBox
            {
                Multiline = true,
                Dock = DockStyle.Fill,
                BackColor = Color.FromArgb(15, 15, 25),
                ForeColor = NeonStyle.TextPrimary,
                BorderStyle = BorderStyle.FixedSingle,
                Font = NeonStyle.FontMain
            };

            _sendButton = NeonStyle.CreateNeonButton("Senden");
            _sendButton.Dock = DockStyle.Right;
            _sendButton.Width = 100;
            _sendButton.Margin = new Padding(10, 0, 0, 0);

            _inputPanel.Controls.Add(_inputBox);
            _inputPanel.Controls.Add(_sendButton);

            // Chat History
            _chatHistory = new Panel
            {
                Dock = DockStyle.Fill,
                AutoScroll = true,
                Padding = new Padding(10)
            };

            this.Controls.Add(_chatHistory);
            this.Controls.Add(_inputPanel);
            this.Controls.Add(header);
        }

        private void InitializeComponent()
        {
            this.SuspendLayout();
            this.Name = "ChatForm";
            this.Text = "Chat";
            this.ResumeLayout(false);
        }
    }
}
