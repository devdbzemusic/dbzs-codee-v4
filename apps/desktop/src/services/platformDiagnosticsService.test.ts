import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectPlatformDiagnostics } from "./platformDiagnosticsService";

vi.mock("@/services/backendClient", () => ({
  backendClient: {
    getBackendHealth: vi.fn()
  }
}));

vi.mock("@/services/trajectoryService", () => ({
  trajectoryService: {
    listRecentTrajectories: vi.fn()
  }
}));

import { backendClient } from "@/services/backendClient";
import { trajectoryService } from "@/services/trajectoryService";

describe("collectPlatformDiagnostics", () => {
  beforeEach(() => {
    vi.mocked(backendClient.getBackendHealth).mockResolvedValue({
      status: "ok",
      app: "DBZS Code Assistant",
      version: "0.3.0"
    });
    vi.mocked(trajectoryService.listRecentTrajectories).mockResolvedValue([]);
    window.dbzs = {
      getRuntimeChatContext: vi.fn().mockResolvedValue({
        activeFile: null,
        contextHint: null,
        workspaceRoot: "D:/repo",
        workspaceName: "repo",
        workspaceFiles: [{ path: "D:/repo/README.md", relativePath: "README.md", name: "README.md", language: "markdown" }]
      })
    } as unknown as typeof window.dbzs;
  });

  it("marks workspace and trajectory checks as ok", async () => {
    const snapshot = await collectPlatformDiagnostics({
      workspaceRoot: "D:/repo",
      workspaceFileCount: 12
    });

    expect(snapshot.backendHealth.status).toBe("ok");
    expect(snapshot.workspaceScan.status).toBe("ok");
    expect(snapshot.trajectoryIpc.status).toBe("ok");
    expect(snapshot.chatContextIpc.status).toBe("ok");
  });
});
