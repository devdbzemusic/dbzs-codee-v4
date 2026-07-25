import { z } from "zod";

/**
 * Runtime validation for the backend's /health/startup and /health/ready
 * payloads. The desktop boot orchestrator must never blindly cast a fetch
 * response to a TS type -- a malformed or version-mismatched backend
 * payload should fail loudly (BootProtocolError) rather than produce
 * `undefined` property access deep inside a phase runner.
 */

export const BootComponentStateSchema = z.enum([
  "pending",
  "waiting",
  "running",
  "success",
  "warning",
  "failed",
  "retrying",
  "blocked",
  "skipped"
]);

export const BootComponentErrorSchema = z.object({
  code: z.string(),
  technicalDetail: z.string().optional(),
  exitCode: z.number().nullable().optional(),
  stderrTail: z.string().optional()
});

export const BootReadinessComponentSchema = z.object({
  state: BootComponentStateSchema,
  progress: z.number().nullable().optional(),
  total: z.number().nullable().optional(),
  message: z.string().nullable().optional(),
  error: BootComponentErrorSchema.nullable().optional(),
  data: z.record(z.unknown()).nullable().optional()
});

const BootRunStatusSchema = z.enum(["starting", "ready", "degraded", "failed"]);

export const BootStartupResponseSchema = z.object({
  status: BootRunStatusSchema,
  ready: z.boolean(),
  progress: z.number(),
  instanceId: z.string(),
  components: z.object({
    database: BootReadinessComponentSchema,
    modelRegistry: BootReadinessComponentSchema,
    runtimeManager: BootReadinessComponentSchema,
    residentModel: BootReadinessComponentSchema
  })
});

export const BootReadyResponseSchema = z.object({
  status: BootRunStatusSchema,
  ready: z.boolean(),
  instanceId: z.string(),
  requiredComponents: z.record(BootComponentStateSchema).optional(),
  optionalComponents: z.record(BootComponentStateSchema).optional()
});

/**
 * Structured resident-model identity (repair spec §15) -- read from a
 * component's `data` field via safeParse, never regex-extracted from its
 * free-text `message`.
 */
export const ResidentModelDataSchema = z.object({
  modelId: z.string(),
  modelName: z.string().nullable().optional(),
  slotId: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  pid: z.number().nullable().optional(),
  port: z.number().nullable().optional()
});

export class BootProtocolError extends Error {
  constructor(message: string, public readonly detail: string) {
    super(`${message}: ${detail}`);
    this.name = "BootProtocolError";
  }
}
