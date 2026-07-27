import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src")
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: [resolve(__dirname, "src/test/setup.ts")],
    globals: true,
    exclude: ["**/node_modules/**", "**/e2e/**", "**/*.spec.ts"]
  }
});
