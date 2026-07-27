import { describe, expect, it } from "vitest";
import {
  collectWindowsCleanupCandidatePids,
  type WindowsProcessInfo
} from "./runtimeProcessCleanup.js";

describe("runtimeProcessCleanup", () => {
  it("collects listeners on managed ports and known runtime signatures", () => {
    const netstatOutput = [
      "  TCP    127.0.0.1:8081      0.0.0.0:0      LISTENING       4112",
      "  TCP    127.0.0.1:8876      0.0.0.0:0      LISTENING       5224",
      "  TCP    127.0.0.1:3000      0.0.0.0:0      LISTENING       9999"
    ].join("\n");

    const processes: WindowsProcessInfo[] = [
      {
        ProcessId: 4112,
        Name: "llama-server.exe",
        CommandLine: "D:\\win_runtimes\\llama\\llama-server.exe --model D:\\Models\\a.gguf --port 8081"
      },
      {
        ProcessId: 5224,
        Name: "python.exe",
        CommandLine: "python -m uvicorn app.main:app --host 127.0.0.1 --port 8876"
      },
      {
        ProcessId: 7001,
        Name: "llama-cli.exe",
        CommandLine: "D:\\win_runtimes\\llama\\llama-cli.exe --port 8084 --model D:\\Models\\b.gguf"
      },
      {
        ProcessId: 9999,
        Name: "python.exe",
        CommandLine: "python -m http.server 3000"
      }
    ];

    expect(
      collectWindowsCleanupCandidatePids({
        netstatOutput,
        processes,
        currentPid: 123
      })
    ).toEqual([4112, 5224, 7001]);
  });

  it("never targets the current electron pid", () => {
    const processes: WindowsProcessInfo[] = [
      {
        ProcessId: 1234,
        Name: "python.exe",
        CommandLine: "python -m uvicorn app.main:app --host 127.0.0.1 --port 8876"
      }
    ];

    expect(
      collectWindowsCleanupCandidatePids({
        netstatOutput: "",
        processes,
        currentPid: 1234
      })
    ).toEqual([]);
  });
});
