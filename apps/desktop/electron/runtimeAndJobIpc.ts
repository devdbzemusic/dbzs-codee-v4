/*
 * DBZS – Division By Zeros
 * Datei: runtimeAndJobIpc.ts
 * Bereich: Electron Main / IPC
 *
 * Zweck:
 *   Registriert Runtime-, Orchestration- und Job-Spooler-IPC-Handler.
 *
 * Warum:
 *   main.ts soll Orchestrierung und App-Lifecycle bleiben statt alle
 *   Runtime-/Transport-Handler inline zu enthalten.
 *
 * Wozu:
 *   Reduziert die Groesse von electron/main.ts und kapselt Runtime-Fehler-,
 *   Fallback- und Streaming-Logik in einem eigenen Main-Process-Modul.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { IPC_CHANNEL } from "@dbzs/shared";
import type {
  JobArtifactCreateRequest,
  JobClaimRequest,
  JobEnqueueRequest,
  JobStatus,
  JobVerifyRequest,
  JobWaypointRequest,
  RuntimeChatRequest
} from "@dbzs/shared";
import { streamRuntimeChatViaBackend } from "./runtimeChatStream.js";
import { markRunActive, markRunInactive } from "./activeRunTracker.js";
import { classifyRuntimeStreamError, shouldAttemptNonStreamFallback } from "./runtimeChatFallbackPolicy.js";
import {
  buildToolFreeRuntimeChatFallbackRequest,
  shouldDisableNonStreamFallbackForRequest
} from "./runtimeChatFallback.js";

interface RegisterRuntimeAndJobIpcOptions {
  backendUrl: string;
  requestBackend: <T>(pathname: string, init?: RequestInit) => Promise<T>;
  isAbortError: (error: unknown) => boolean;
  isRuntimeContextOverflowError: (error: unknown) => boolean;
  isRuntimeToolPayloadError: (error: unknown) => boolean;
  buildRuntimeContextOverflowResponse: () => {
    message: { id: string; role: "assistant"; content: string };
    model_id: string | null;
    model_name: string | null;
    safe_fallback: true;
    provider_error: {
      kind: "provider_error";
      code: string;
      stage: string;
      userMessage: string;
      retryable: boolean;
      correlationId: string;
    };
  };
  buildRuntimeChatSafeResponse: (
    message: string,
    code?:
      | "context_overflow"
      | "model_unavailable"
      | "slot_busy"
      | "invalid_request"
      | "connection_failed"
      | "provider_internal_error"
      | "timeout"
  ) => {
    message: { id: string; role: "assistant"; content: string };
    model_id: string | null;
    model_name: string | null;
    safe_fallback: true;
    provider_error: {
      kind: "provider_error";
      code: string;
      stage: string;
      userMessage: string;
      retryable: boolean;
      correlationId: string;
    };
  };
}

export function registerRuntimeAndJobIpcHandlers(options: RegisterRuntimeAndJobIpcOptions): void {
  const {
    backendUrl,
    requestBackend,
    isAbortError,
    isRuntimeContextOverflowError,
    isRuntimeToolPayloadError,
    buildRuntimeContextOverflowResponse,
    buildRuntimeChatSafeResponse
  } = options;

  const activeRuntimeChatAbortControllers = new Map<string, AbortController>();
  const activeChatStreamAbortControllers = new Map<string, AbortController>();

  function buildRuntimeChatFallbackRequest(chatRequest: RuntimeChatRequest): RuntimeChatRequest {
    return buildToolFreeRuntimeChatFallbackRequest(chatRequest);
  }

  function buildRuntimeChatMinimalRequest(chatRequest: RuntimeChatRequest): RuntimeChatRequest {
    const lastUser = [...chatRequest.messages].reverse().find((message) => message.role === "user");
    const fallbackUserMessage = lastUser ?? {
      id: `msg-${Date.now().toString(36)}-fallback`,
      role: "user" as const,
      content: "Bitte antworte kurz und direkt."
    };

    return {
      messages: [fallbackUserMessage],
      max_tokens: 256,
      temperature: 0.2,
      file_context: null,
      model_id: chatRequest.model_id,
      slot_id: chatRequest.slot_id,
      fallback_policy: chatRequest.fallback_policy,
      provider: chatRequest.provider,
      routing_reason: chatRequest.routing_reason,
      decision_id: chatRequest.decision_id
    };
  }

  ipcMain.handle(IPC_CHANNEL.modelsIndex, () => requestBackend("/models/index"));
  ipcMain.handle(
    "dbzs:models:multimodal-pairings:manual",
    (_event, request: { base_model_id: string; projector_artifact_id: string }) =>
      requestBackend("/models/multimodal-pairings/manual", {
        method: "POST",
        body: JSON.stringify(request),
      })
  );
  ipcMain.handle(IPC_CHANNEL.runtimeStatus, () => requestBackend("/runtime/status"));
  ipcMain.handle(IPC_CHANNEL.runtimeStart, (_event, modelId: string, profile?: string) =>
    requestBackend("/runtime/start", {
      method: "POST",
      body: JSON.stringify({ model_id: modelId, ...(profile ? { profile } : {}) })
    })
  );
  ipcMain.handle(IPC_CHANNEL.runtimeStop, () =>
    requestBackend("/runtime/stop", {
      method: "POST",
      body: JSON.stringify({})
    })
  );

  ipcMain.handle(IPC_CHANNEL.runtimeChat, async (_event, chatRequest: RuntimeChatRequest, requestId?: string) => {
    const normalizedRequestId =
      typeof requestId === "string" && requestId.trim().length > 0
        ? requestId.trim()
        : `runtime-chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const abortController = new AbortController();
    activeRuntimeChatAbortControllers.set(normalizedRequestId, abortController);
    markRunActive(chatRequest.run_id);
    const backendChatRequest = { ...chatRequest, request_id: normalizedRequestId };
    try {
      return await requestBackend("/runtime/chat", {
        method: "POST",
        body: JSON.stringify(backendChatRequest),
        signal: abortController.signal
      });
    } catch (error) {
      if (abortController.signal.aborted || isAbortError(error)) {
        throw error;
      }

      if (isRuntimeContextOverflowError(error)) {
        return buildRuntimeContextOverflowResponse();
      }

      if (!isRuntimeToolPayloadError(error)) {
        return buildRuntimeChatSafeResponse(
          "Runtime konnte die Anfrage nicht ausführen. Bitte Diagnose-Log prüfen."
        );
      }

      const fallbackRequest = buildRuntimeChatFallbackRequest(chatRequest);
      try {
        return await requestBackend("/runtime/chat", {
          method: "POST",
          body: JSON.stringify({ ...fallbackRequest, request_id: normalizedRequestId }),
          signal: abortController.signal
        });
      } catch {
        if (abortController.signal.aborted) {
          throw new Error("aborted");
        }

        try {
          const minimalRequest = buildRuntimeChatMinimalRequest(chatRequest);
          return await requestBackend("/runtime/chat", {
            method: "POST",
            body: JSON.stringify({ ...minimalRequest, request_id: normalizedRequestId }),
            signal: abortController.signal
          });
        } catch (minimalError) {
          if (abortController.signal.aborted || isAbortError(minimalError)) {
            throw minimalError;
          }
          return buildRuntimeChatSafeResponse(
            "Runtime hat die Anfrage abgelehnt (HTTP 400). Bitte kuerzere Eingabe oder Runtime-Profil pruefen."
          );
        }
      }
    } finally {
      activeRuntimeChatAbortControllers.delete(normalizedRequestId);
      markRunInactive(chatRequest.run_id);
    }
  });

  ipcMain.handle(IPC_CHANNEL.runtimeChatStreamCancel, (_event: IpcMainInvokeEvent, requestId?: string) => {
    const normalizedRequestId = typeof requestId === "string" ? requestId.trim() : "";
    if (!normalizedRequestId) {
      for (const controller of activeChatStreamAbortControllers.values()) {
        controller.abort();
      }
      activeChatStreamAbortControllers.clear();
      return { status: "cancelled_all" };
    }

    const active = activeChatStreamAbortControllers.get(normalizedRequestId);
    if (!active) {
      return { status: "not_found" };
    }

    active.abort();
    activeChatStreamAbortControllers.delete(normalizedRequestId);
    return { status: "cancelled" };
  });

  ipcMain.handle(IPC_CHANNEL.runtimeChatCancel, (_event: IpcMainInvokeEvent, requestId: string) => {
    const normalizedRequestId = typeof requestId === "string" ? requestId.trim() : "";
    if (!normalizedRequestId) {
      return { status: "invalid_request_id" };
    }

    const active = activeRuntimeChatAbortControllers.get(normalizedRequestId);
    if (!active) {
      return { status: "not_found" };
    }

    active.abort();
    activeRuntimeChatAbortControllers.delete(normalizedRequestId);
    return { status: "cancelled" };
  });

  ipcMain.handle(IPC_CHANNEL.runtimeChatStream, async (event, chatRequest: RuntimeChatRequest, requestId?: string) => {
    const normalizedRequestId =
      typeof requestId === "string" && requestId.trim().length > 0
        ? requestId.trim()
        : `runtime-stream-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    activeChatStreamAbortControllers.get(normalizedRequestId)?.abort();
    activeChatStreamAbortControllers.delete(normalizedRequestId);
    const activeChatStreamAbortController = new AbortController();
    activeChatStreamAbortControllers.set(normalizedRequestId, activeChatStreamAbortController);
    const streamSignal = activeChatStreamAbortController.signal;
    const backendChatRequest = { ...chatRequest, request_id: normalizedRequestId };
    const sendStreamChunk = (payload: { delta: string; totalLength: number }) => {
      if (!streamSignal.aborted) {
        event.sender.send(IPC_CHANNEL.runtimeChatStreamChunk, {
          requestId: normalizedRequestId,
          ...payload
        });
      }
    };

    markRunActive(chatRequest.run_id);
    try {
      try {
        const result = await streamRuntimeChatViaBackend(backendUrl, backendChatRequest, (chunk) => {
          sendStreamChunk(chunk);
        }, streamSignal);
        return result;
      } catch (error) {
        if (streamSignal.aborted) {
          return {
            message: { id: `msg-${Date.now().toString(36)}-cancelled`, role: "assistant", content: "" },
            model_id: null,
            model_name: null
          };
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        const streamErrorMeta = classifyRuntimeStreamError(error);
        const isToolError = streamErrorMeta.isToolError;
        const isContextOverflow = streamErrorMeta.isContextOverflow || isRuntimeContextOverflowError(error);
        const isTimeout = streamErrorMeta.isTimeout || errorMessage.includes("Timeout") || errorMessage.includes("timeout");

        if (isTimeout) {
          return buildRuntimeChatSafeResponse(
            "Modell antwortet nicht (Timeout). Bitte später erneut versuchen oder kürzere Anfrage stellen.",
            "timeout"
          );
        }

        if (isContextOverflow) {
          return buildRuntimeContextOverflowResponse();
        }

        if (
          shouldAttemptNonStreamFallback(streamErrorMeta) &&
          !shouldDisableNonStreamFallbackForRequest(chatRequest)
        ) {
          try {
            const fallbackRequest = buildRuntimeChatFallbackRequest(chatRequest);
            const fallback = await requestBackend<{
              message: { role: "assistant"; content: string };
              model_id: string | null;
              model_name: string | null;
            }>("/runtime/chat", {
              method: "POST",
              body: JSON.stringify({ ...fallbackRequest, request_id: normalizedRequestId }),
              signal: streamSignal
            });

            if (fallback.message.content) {
              sendStreamChunk({
                delta: fallback.message.content,
                totalLength: fallback.message.content.length
              });
            }

            return fallback;
          } catch (fallbackError) {
            if (streamSignal.aborted || isAbortError(fallbackError)) {
              throw fallbackError;
            }

            return buildRuntimeChatSafeResponse(
              isToolError
                ? "Runtime hat die Anfrage abgelehnt. Bitte ohne Tools oder mit weniger Kontext erneut senden."
                : "Verbindung unterbrochen. Bitte Nachricht erneut senden.",
              isToolError ? "invalid_request" : "connection_failed"
            );
          }
        }

        return buildRuntimeChatSafeResponse(
          "Runtime konnte die Anfrage nicht ausführen. Bitte Diagnose-Log prüfen.",
          "provider_internal_error"
        );
      }
    } finally {
      if (activeChatStreamAbortControllers.get(normalizedRequestId)?.signal === streamSignal) {
        activeChatStreamAbortControllers.delete(normalizedRequestId);
      }
      markRunInactive(chatRequest.run_id);
    }
  });

  ipcMain.handle("dbzs:runtime:benchmark", () =>
    requestBackend("/runtime/benchmark", {
      method: "POST",
      body: JSON.stringify({})
    })
  );
  ipcMain.handle("dbzs:runtime:model-test", () =>
    requestBackend("/runtime/model-test", {
      method: "POST",
      body: JSON.stringify({})
    })
  );
  ipcMain.handle("dbzs:runtime:doctor", () => requestBackend("/runtime/doctor"));
  ipcMain.handle("dbzs:runtime:doctor-dry-run", (_event, payload: { model_id: string; profile_name?: string | null }) =>
    requestBackend("/runtime/doctor/dry-run", {
      method: "POST",
      body: JSON.stringify(payload)
    })
  );
  ipcMain.handle("dbzs:runtime:doctor-probe", (_event, payload: { allow_start: boolean; model_id?: string | null }) =>
    requestBackend("/runtime/doctor/probe", {
      method: "POST",
      body: JSON.stringify(payload)
    })
  );
  ipcMain.handle("dbzs:runtime:route", (_event, payload: unknown) =>
    requestBackend("/runtime/route", {
      method: "POST",
      body: JSON.stringify(payload)
    })
  );
  ipcMain.handle("dbzs:runtime:logs", () => requestBackend("/runtime/logs"));
  ipcMain.handle("dbzs:orchestration:tools", () => requestBackend("/orchestration/tools"));
  ipcMain.handle("dbzs:orchestration:prepare", (_event, request: unknown) =>
    requestBackend("/orchestration/context/prepare", {
      method: "POST",
      body: JSON.stringify(request)
    })
  );
  ipcMain.handle("dbzs:orchestration:execute", (_event, request: unknown) =>
    requestBackend("/orchestration/tools/execute", {
      method: "POST",
      body: JSON.stringify(request)
    })
  );

  ipcMain.handle("dbzs:job-spooler:list", (_event, status?: JobStatus, limit?: number) => {
    const params = new URLSearchParams();
    if (status) {
      params.set("status", status);
    }
    if (limit !== undefined) {
      params.set("limit", String(limit));
    }
    const query = params.toString();
    return requestBackend(`/job-spooler${query ? `?${query}` : ""}`);
  });
  ipcMain.handle("dbzs:job-spooler:enqueue", (_event, request: JobEnqueueRequest) =>
    requestBackend("/job-spooler/enqueue", {
      method: "POST",
      body: JSON.stringify(request)
    })
  );
  ipcMain.handle("dbzs:job-spooler:claim", (_event, request: JobClaimRequest) =>
    requestBackend("/job-spooler/claim", {
      method: "POST",
      body: JSON.stringify(request)
    })
  );
  ipcMain.handle("dbzs:job-spooler:detail", (_event, jobId: string) =>
    requestBackend(`/job-spooler/${encodeURIComponent(jobId)}/detail`)
  );
  ipcMain.handle("dbzs:job-spooler:waypoint", (_event, jobId: string, request: JobWaypointRequest) =>
    requestBackend(`/job-spooler/${encodeURIComponent(jobId)}/waypoints`, {
      method: "POST",
      body: JSON.stringify(request)
    })
  );
  ipcMain.handle("dbzs:job-spooler:artifact", (_event, jobId: string, request: JobArtifactCreateRequest) =>
    requestBackend(`/job-spooler/${encodeURIComponent(jobId)}/artifacts`, {
      method: "POST",
      body: JSON.stringify(request)
    })
  );
  ipcMain.handle("dbzs:job-spooler:verify", (_event, jobId: string, request: JobVerifyRequest) =>
    requestBackend(`/job-spooler/${encodeURIComponent(jobId)}/verify`, {
      method: "POST",
      body: JSON.stringify(request)
    })
  );
  ipcMain.handle("dbzs:job-spooler:requeue-stale", () =>
    requestBackend("/job-spooler/requeue-stale", {
      method: "POST",
      body: JSON.stringify({})
    })
  );
  ipcMain.handle("dbzs:job-spooler:clear-all", () =>
    requestBackend("/job-spooler/clear-all", {
      method: "POST",
      body: JSON.stringify({})
    })
  );
  ipcMain.handle("dbzs:job-spooler:prune-finished", () =>
    requestBackend("/job-spooler/prune-finished", {
      method: "POST",
      body: JSON.stringify({})
    })
  );
  ipcMain.handle("dbzs:trajectories:job", (_event, jobId: string) =>
    requestBackend(`/trajectories/jobs/${encodeURIComponent(jobId)}`)
  );
  ipcMain.handle("dbzs:trajectories:recent", (_event, limit = 100) =>
    requestBackend(`/trajectories/recent?limit=${encodeURIComponent(String(limit))}`)
  );
}
