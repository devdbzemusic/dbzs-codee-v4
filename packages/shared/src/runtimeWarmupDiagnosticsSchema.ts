import { z } from "zod";

/**
 * Detaillierte Diagnoseinformationen für einen fehlgeschlagenen Modell-Warm-up.
 * PRIORITÄT 3
 */
export const RuntimeWarmupDiagnosticsSchema = z.object({
  endpoint: z.string().optional(),
  apiMode: z.string().optional(),
  requestMethod: z.string().optional(),
  requestBody: z.string().optional().describe("Request-Body ohne Secrets"),
  httpStatus: z.number().optional(),
  contentType: z.string().optional(),
  responseHeaders: z.record(z.string()).optional(),
  rawResponsePreview: z.string().optional().describe("Erste 8 KB der Rohantwort"),
  streamEvents: z.array(z.string()).optional().describe("Alle empfangenen Streaming-Eventtypen"),
  finishReason: z.string().optional(),
  promptTokens: z.number().optional(),
  completionTokens: z.number().optional(),
  stderrTail: z.string().optional().describe("Letzte Zeilen von stderr des Llama-Servers"),
  parserDecision: z.string().optional().describe("Welcher Parser-Pfad wurde gewählt"),
  chatTemplateUsed: z.string().optional(),
  stopSequencesUsed: z.array(z.string()).optional(),
  maxTokens: z.number().optional(),
  processStartMs: z.number().optional(),
  endpointReadyMs: z.number().optional(),
  modelLoadMs: z.number().optional(),
  promptEvalMs: z.number().optional(),
  firstTokenMs: z.number().optional(),
  totalWarmupMs: z.number().optional(),
});

export type RuntimeWarmupDiagnostics = z.infer<typeof RuntimeWarmupDiagnosticsSchema>;
