import { BrowserWindow, ipcMain, type BrowserWindow as ElectronBrowserWindow, type IpcMainEvent } from "electron";

export interface PromptTextRequest {
  title: string;
  label: string;
  value: string;
  confirmText?: string;
  cancelText?: string;
}

function normalizePromptValue(value: string | null | undefined): string | null {
  const entered = value?.trim() ?? "";
  return entered.length > 0 ? entered : null;
}

export async function promptTextInput(
  request: PromptTextRequest,
  parentWindow?: ElectronBrowserWindow | null
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let settled = false;
    const channel = `dbzs:prompt-input:${Date.now()}:${Math.random().toString(16).slice(2)}`;

    const finish = (value: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      ipcMain.removeListener(channel, handleResult);
      if (!promptWindow.isDestroyed()) {
        promptWindow.close();
      }
      resolve(value);
    };

    const handleResult = (_event: IpcMainEvent, value: string | null) => {
      finish(normalizePromptValue(value));
    };

    const promptWindow = new BrowserWindow({
      parent: parentWindow ?? undefined,
      modal: Boolean(parentWindow),
      show: false,
      width: 480,
      height: 220,
      resizable: false,
      title: request.title,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    ipcMain.on(channel, handleResult);

    promptWindow.once("closed", () => {
      ipcMain.removeListener(channel, handleResult);
      if (!settled) {
        settled = true;
        resolve(null);
      }
    });

    const html = `<!DOCTYPE html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: sans-serif; margin: 0; padding: 16px; background: #fff; color: #111; }
      .field { display: flex; flex-direction: column; gap: 8px; }
      label { font-size: 13px; font-weight: 600; }
      input { padding: 8px 10px; font-size: 13px; border: 1px solid #c5c5c5; border-radius: 6px; }
      .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
      button { padding: 8px 12px; border: none; border-radius: 6px; cursor: pointer; }
      button.primary { background: #2563eb; color: white; }
      button.secondary { background: #e5e7eb; color: #111; }
    </style>
  </head>
  <body>
    <form id="prompt-form" class="field">
      <label for="prompt-input">${request.label}</label>
      <input id="prompt-input" name="value" value="${(request.value ?? "").replace(/"/g, "&quot;")}" />
      <div class="actions">
        <button type="button" id="cancel" class="secondary">${request.cancelText ?? "Abbrechen"}</button>
        <button type="submit" class="primary">${request.confirmText ?? "OK"}</button>
      </div>
    </form>
    <script>
      const { ipcRenderer } = require("electron");
      const form = document.getElementById("prompt-form");
      const input = document.getElementById("prompt-input");
      input.focus();
      input.select();
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const value = input.value.trim();
        ipcRenderer.send(${JSON.stringify(channel)}, value.length > 0 ? value : null);
        window.close();
      });
      document.getElementById("cancel").addEventListener("click", () => {
        ipcRenderer.send(${JSON.stringify(channel)}, null);
        window.close();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          ipcRenderer.send(${JSON.stringify(channel)}, null);
          window.close();
        }
      });
    </script>
  </body>
</html>`;

    void promptWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    promptWindow.once("ready-to-show", () => {
      promptWindow.show();
      promptWindow.focus();
    });
  });
}
