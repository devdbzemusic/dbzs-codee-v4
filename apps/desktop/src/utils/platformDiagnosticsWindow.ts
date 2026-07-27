import { backendClient } from "@/services/backendClient";

export async function openPlatformDiagnosticsWindow(): Promise<void> {
  await backendClient.openPlatformDiagnosticsWindow();
}

export async function closePlatformDiagnosticsWindow(): Promise<void> {
  await backendClient.closePlatformDiagnosticsWindow();
}
