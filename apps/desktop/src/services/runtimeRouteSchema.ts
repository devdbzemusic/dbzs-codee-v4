import { z } from "zod";

/**
 * Definiert die finale, verbindliche Routing-Entscheidung für einen Run.
 * Dies ist der Zod-Teil des gemeinsamen Protokollvertrags (P1-Task).
 */
export const ResolvedRuntimeRouteSchema = z.object({
  modelId: z.string(),
  modelName: z.string(),
  slotId: z.string(),
  profile: z.string(),
  provider: z.string(),
  reasons: z.array(z.string()),
  source: z.enum(["role_setting", "automatic", "fallback", "resident_continue", "explicit_fallback"])
});

export type ResolvedRuntimeRoute = z.infer<typeof ResolvedRuntimeRouteSchema>;
