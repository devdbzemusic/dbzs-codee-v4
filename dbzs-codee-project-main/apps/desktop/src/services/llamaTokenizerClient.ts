/**
 * DBZS – Division By Zeros
 * Datei: llamaTokenizerClient.ts
 * Bereich: Desktop Services / Llama Tokenizer Client
 *
 * Zweck:
 *   Reale Tokenanzahl via /runtime/slots/{slot_id}/tokenize (Phase 5) statt
 *   der chars/4-Heuristik — nur dort einsetzbar, wo der Slot erreichbar ist.
 *
 * Warum:
 *   "Zeichenabschätzung nur als konservativer Fallback" — echte Tokenisierung
 *   hat Vorrang, sobald die Runtime läuft.
 */

import { backendClient } from "@/services/backendClient";
import { estimateTokensCharHeuristic } from "@/runtime/context/contextSpooler";

async function resolveBackendUrl(): Promise<string> {
  try {
    const settings = await backendClient.getSettings();
    return settings.backendUrl || "http://127.0.0.1:8876";
  } catch {
    return "http://127.0.0.1:8876";
  }
}

export const llamaTokenizerClient = {
  /**
   * Real token count via the slot's own llama-server /tokenize endpoint.
   * Falls back to the chars/4 heuristic on any failure (slot not running,
   * network error, ...) — never throws, never blocks the caller.
   */
  async countTokens(slotId: string, text: string): Promise<number> {
    try {
      const backendUrl = await resolveBackendUrl();
      const response = await fetch(`${backendUrl}/runtime/slots/${slotId}/tokenize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      if (!response.ok) {
        return estimateTokensCharHeuristic(text);
      }
      const data = (await response.json()) as { token_count: number };
      return data.token_count;
    } catch {
      return estimateTokensCharHeuristic(text);
    }
  }
};
