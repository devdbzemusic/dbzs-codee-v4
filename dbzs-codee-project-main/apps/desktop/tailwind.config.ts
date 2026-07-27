import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        dbzs: {
          bg: "#070b10",
          panel: "#0d141c",
          panelSoft: "#101b26",
          border: "#223140",
          text: "#e8f0f7",
          muted: "#89a1b4",
          cyan: "#21d6c7",
          green: "#7bd88f",
          amber: "#f3b45b",
          red: "#ff6b6b"
        }
      },
      boxShadow: {
        panel: "0 18px 50px rgba(0, 0, 0, 0.36)"
      }
    }
  },
  plugins: []
} satisfies Config;
