import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    build: {
      outDir: "out/main",
      rollupOptions: {
        input: resolve(__dirname, "electron/main.ts"),
        output: {
          format: "cjs",
          entryFileNames: "main.js"
        }
      }
    }
  },
  preload: {
    build: {
      outDir: "out/preload",
      rollupOptions: {
        input: resolve(__dirname, "electron/preload.ts"),
        output: {
          format: "cjs",
          entryFileNames: "preload.js"
        }
      }
    }
  },
  renderer: {
    root: ".",
    plugins: [react()],
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        input: resolve(__dirname, "index.html"),
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/monaco-editor") || id.includes("node_modules/@monaco-editor")) {
              return "monaco";
            }
          }
        }
      }
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "src")
      }
    }
  }
});
