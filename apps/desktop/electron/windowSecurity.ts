import type { BrowserWindow } from "electron";

interface WindowSecurityOptions {
  allowedFileRoot: string;
  devRendererUrl?: string;
}

function normalizeUrlPrefix(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

export function configureWindowSecurity(
  window: BrowserWindow,
  options: WindowSecurityOptions,
  openExternal: (url: string) => void
): void {
  const allowedFileRoot = normalizeUrlPrefix(options.allowedFileRoot);
  const devRendererUrl = options.devRendererUrl?.trim();

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const allowed =
      url.startsWith(allowedFileRoot) ||
      (devRendererUrl ? url.startsWith(devRendererUrl) : false);

    if (!allowed) {
      event.preventDefault();
      openExternal(url);
    }
  });
}
