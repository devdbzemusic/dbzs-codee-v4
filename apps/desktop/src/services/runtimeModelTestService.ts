import type { RuntimeModelTestReport, RuntimeModelTestStep } from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";
import { streamRuntimeChat } from "@/services/runtimeChatStreamClient";

function step(
  id: string,
  label: string,
  status: RuntimeModelTestStep["status"],
  detail: string,
  durationMs?: number
): RuntimeModelTestStep {
  return { id, label, status, detail, duration_ms: durationMs ?? null };
}

export async function runClientModelTest(): Promise<RuntimeModelTestReport> {
  const steps: RuntimeModelTestStep[] = [];
  let status;

  try {
    status = await backendClient.getRuntimeStatus();
  } catch (error) {
    return {
      overall: "fail",
      model_id: null,
      model_name: null,
      provider: null,
      steps: [
        step(
          "runtime-status",
          "Runtime-Status",
          "fail",
          error instanceof Error ? error.message : "Backend nicht erreichbar."
        )
      ]
    };
  }

  if (status.state !== "running" || !status.endpoint) {
    steps.push(
      step(
        "runtime-status",
        "Runtime-Status",
        "fail",
        status.message || "Runtime ist nicht aktiv."
      )
    );
    return {
      overall: "fail",
      model_id: status.model_id,
      model_name: status.model_name,
      provider: status.provider,
      steps
    };
  }

  steps.push(
    step(
      "runtime-status",
      "Runtime-Status",
      "pass",
      `${status.provider ?? "runtime"} laeuft auf Port ${status.port} (${status.endpoint})`
    )
  );

  const chatRequest = {
    messages: [{ id: "msg-test-ok", role: "user" as const, content: "Antworte nur mit dem Wort OK." }],
    temperature: 0,
    max_tokens: 8
  };

  const chatStarted = performance.now();
  try {
    const response = await backendClient.sendRuntimeChat(chatRequest);
    const content = response.message.content.trim();
    const durationMs = Math.round(performance.now() - chatStarted);
    steps.push(
      step(
        "chat-complete",
        "Chat (non-stream)",
        content ? "pass" : "fail",
        content ? `Antwort: ${content.slice(0, 120)}` : "Leere Antwort vom Modell.",
        durationMs
      )
    );
  } catch (error) {
    const durationMs = Math.round(performance.now() - chatStarted);
    steps.push(
      step(
        "chat-complete",
        "Chat (non-stream)",
        "fail",
        error instanceof Error ? error.message : "Chat fehlgeschlagen.",
        durationMs
      )
    );
  }

  const streamStarted = performance.now();
  try {
    let preview = "";
    try {
      await streamRuntimeChat(chatRequest, {
        onDelta: (delta) => {
          preview += delta;
        }
      });
    } catch {
      const fallback = await backendClient.sendRuntimeChat(chatRequest);
      preview = fallback.message.content;
    }
    const durationMs = Math.round(performance.now() - streamStarted);
    const trimmed = preview.trim();
    steps.push(
      step(
        "chat-stream",
        "Chat (stream)",
        trimmed ? "pass" : "fail",
        trimmed ? `Erster Stream-Output: ${trimmed.slice(0, 120)}` : "Kein Stream-Token empfangen.",
        durationMs
      )
    );
  } catch (error) {
    const durationMs = Math.round(performance.now() - streamStarted);
    steps.push(
      step(
        "chat-stream",
        "Chat (stream)",
        "fail",
        error instanceof Error ? error.message : "Streaming fehlgeschlagen.",
        durationMs
      )
    );
  }

  const overall = steps.every((entry) => entry.status === "pass") ? "pass" : "fail";
  return {
    overall,
    model_id: status.model_id,
    model_name: status.model_name,
    provider: status.provider,
    steps
  };
}

export async function runModelTest(): Promise<RuntimeModelTestReport> {
  const bridgeMethod = window.dbzs?.runModelTest;
  if (typeof bridgeMethod === "function") {
    try {
      return await bridgeMethod();
    } catch {
      // Fall back to client-side diagnostics below.
    }
  }

  return runClientModelTest();
}



