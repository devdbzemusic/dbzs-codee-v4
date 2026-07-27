import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true,
  },
  webServer: [
    {
      command: "uv run uvicorn app.main:app --host 127.0.0.1 --port 8876",
      cwd: "../../backend",
      url: "http://127.0.0.1:8876/health",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "pnpm run dev:renderer",
      cwd: ".",
      port: 5173,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
});
