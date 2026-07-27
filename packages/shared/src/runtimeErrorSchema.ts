import { z } from "zod";

export const RuntimeErrorCodeSchema = z.enum([
  "runtime_unavailable",
  "target_slot_unavailable",
  "warmup_timeout",
  "warmup_http_failed",
  "warmup_empty_response",
  "binding_mismatch",
  "provider_request_failed",
  "provider_timeout",
  "runtime_internal_error",
]);

export const RuntimeErrorContractSchema = z.object({
  code: RuntimeErrorCodeSchema,
  message: z.string(),
  recoverable: z.boolean(),
  diagnosticContext: z.record(z.unknown()).optional(),
  recommendedAction: z.string().optional(),
});

export type RuntimeErrorCode = z.infer<typeof RuntimeErrorCodeSchema>;
export type RuntimeErrorContract = z.infer<typeof RuntimeErrorContractSchema>;
