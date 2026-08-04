import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true
  },
  webServer: {
    command: "pnpm run dev:renderer",
    cwd: ".",
    port: 5173,
    reuseExistingServer: true,
    timeout: 60_000
  },
  reporter: [["list"], ["html", { outputFolder: "playwright-report-ui-refactor", open: "never" }]]
});
