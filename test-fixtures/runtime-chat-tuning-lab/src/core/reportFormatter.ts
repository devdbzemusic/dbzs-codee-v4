/*
 * DBZS - Division By Zeros
 * Datei: reportFormatter.ts
 * Bereich: runtime-chat tuning lab / core
 *
 * Zweck:
 *   Refactor-Kandidat mit zu viel Verantwortung in einer Datei.
 */

import type { OrderSummary } from "./priceEngine";

export interface ReportRow {
  owner: string;
  environment: string;
  status: "ok" | "degraded" | "failed";
  summary: OrderSummary;
  notes?: string[];
}

export function formatReport(rows: ReportRow[]): string {
  let output = "Runtime Finance Report\n";
  output += "======================\n";

  for (const row of rows) {
    output += "Owner: " + row.owner + "\n";
    output += "Environment: " + row.environment + "\n";
    output += "Status: " + row.status.toUpperCase() + "\n";
    output += "Subtotal: " + cents(row.summary.subtotalCents) + "\n";
    output += "Discount: " + cents(row.summary.discountCents) + "\n";
    output += "Shipping: " + cents(row.summary.shippingCents) + "\n";
    output += "Total: " + cents(row.summary.totalCents) + "\n";

    if (row.notes && row.notes.length > 0) {
      output += "Notes:\n";
      for (const note of row.notes) {
        output += "- " + note.trim() + "\n";
      }
    }

    if (row.status === "failed") {
      output += "Action: investigate immediately\n";
    } else if (row.status === "degraded") {
      output += "Action: monitor\n";
    } else {
      output += "Action: none\n";
    }

    output += "\n";
  }

  return output.trimEnd();
}

function cents(value: number): string {
  const euros = (value / 100).toFixed(2);
  return "EUR " + euros;
}
