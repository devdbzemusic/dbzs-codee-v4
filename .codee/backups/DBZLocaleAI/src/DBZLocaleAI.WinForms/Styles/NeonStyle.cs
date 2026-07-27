using System;
using System.Drawing;
using System.Windows.Forms;

namespace DBZLocaleAI.WinForms.Styles
{
    /// <summary>
    /// DBZS Header: Neon Style Definition
    /// Zentrale Definition von Farben, Schriftarten und UI-Elementen
    /// Implementiert den DBZS Neon Style: Dark Tech, Neon Blau/Cyan
    /// </summary>
    public static class NeonStyle
    {
        // Farben
        public static readonly Color Background = Color.FromArgb(10, 10, 15);
        public static readonly Color PanelBackground = Color.FromArgb(20, 20, 30);
        public static readonly Color Border = Color.FromArgb(40, 40, 60);
        public static readonly Color NeonBlue = Color.FromArgb(0, 180, 255);
        public static readonly Color NeonCyan = Color.FromArgb(0, 255, 255);
        public static readonly Color TextPrimary = Color.FromArgb(220, 220, 230);
        public static readonly Color TextSecondary = Color.FromArgb(150, 150, 170);
        public static readonly Color Success = Color.FromArgb(0, 200, 100);
        public static readonly Color Warning = Color.FromArgb(255, 180, 0);
        public static readonly Color Error = Color.FromArgb(255, 50, 50);

        // Schriftarten
        public static readonly Font FontMain = new Font("Segoe UI", 10);
        public static readonly Font FontHeader = new Font("Segoe UI", 12, FontStyle.Bold);
        public static readonly Font FontMono = new Font("Consolas", 10);
        public static readonly Font FontSmall = new Font("Segoe UI", 8);

        /// <summary>
        /// Wendet den Neon Style auf ein Control an
        /// </summary>
        public static void Apply(Control control)
        {
            control.BackColor = Background;
            control.ForeColor = TextPrimary;
            control.Font = FontMain;

            foreach (Control child in control.Controls)
            {
                ApplyToChild(child);
            }
        }

        private static void ApplyToChild(Control control)
        {
            if (control is Panel panel)
            {
                panel.BackColor = PanelBackground;
                panel.BorderStyle = BorderStyle.FixedSingle;
            }
            else if (control is Button btn)
            {
                btn.BackColor = Color.FromArgb(30, 30, 50);
                btn.ForeColor = NeonCyan;
                btn.FlatStyle = FlatStyle.Flat;
                btn.FlatAppearance.BorderColor = NeonBlue;
                btn.FlatAppearance.BorderSize = 1;
                btn.Font = new Font(FontMain, FontStyle.Bold);
            }
            else if (control is TextBox txt)
            {
                txt.BackColor = Color.FromArgb(15, 15, 25);
                txt.ForeColor = TextPrimary;
                txt.BorderStyle = BorderStyle.FixedSingle;
                txt.Font = FontMono;
            }
            else if (control is Label lbl)
            {
                lbl.ForeColor = TextPrimary;
            }
            else if (control is CheckBox chk)
            {
                chk.ForeColor = TextPrimary;
            }
            else if (control is ListBox lb)
            {
                lb.BackColor = Color.FromArgb(15, 15, 25);
                lb.ForeColor = TextPrimary;
                lb.BorderStyle = BorderStyle.FixedSingle;
            }
            else if (control is TabControl tab)
            {
                tab.BackColor = Background;
                // TabControl Styling ist in WinForms begrenzt, erfordert oft OwnerDraw
            }

            foreach (Control child in control.Controls)
            {
                ApplyToChild(child);
            }
        }

        /// <summary>
        /// Erstellt ein Panel im Neon Style
        /// </summary>
        public static Panel CreateNeonPanel()
        {
            return new Panel
            {
                BackColor = PanelBackground,
                BorderStyle = BorderStyle.FixedSingle,
                Padding = new Padding(10)
            };
        }

        /// <summary>
        /// Erstellt einen Button im Neon Style
        /// </summary>
        public static Button CreateNeonButton(string text)
        {
            return new Button
            {
                Text = text,
                BackColor = Color.FromArgb(30, 30, 50),
                ForeColor = NeonCyan,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 10, FontStyle.Bold),
                Height = 35,
                TextAlign = ContentAlignment.MiddleCenter
            };
        }
    }
}
