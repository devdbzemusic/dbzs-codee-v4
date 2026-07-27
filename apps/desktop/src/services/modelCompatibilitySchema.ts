import { z } from "zod";

/**
 * Definiert das Laufzeit-Kompatibilitätsprofil eines Modells.
 * Stellt sicher, dass der Runner weiß, wie er mit einem Modell interagieren muss.
 * PRIORITÄT 4
 */
export const ModelRuntimeCompatibilitySchema = z.object({
  /** API-Modus für die Inferenz (Chat- oder Completion-Endpunkt). */
  apiMode: z.enum(["chat", "completion"]),

  /** Jinja2-Template für die Chat-Formatierung, falls vom Modell benötigt. */
  chatTemplate: z.string().nullable(),

  /** Ob das Modell Streaming-Antworten unterstützt. */
  supportsStreaming: z.boolean(),

  /** Ob das Modell strukturierte Tool-Calls unterstützt. */
  supportsTools: z.boolean(),

  /** Wie das Modell Reasoning-Output liefert. */
  reasoningMode: z.enum(["none", "separate_field", "inline"]),

  /** Ein minimaler, gültiger Prompt für den Warm-up. */
  warmupPrompt: z.string(),

  /** In welchem Kanal der Antwort die erste verwertbare Ausgabe erwartet wird. */
  warmupExpectedChannel: z.string()
});

export type ModelRuntimeCompatibility = z.infer<typeof ModelRuntimeCompatibilitySchema>;
