/*
 * DBZS - Division By Zeros
 * Datei: priceEngine.ts
 * Bereich: runtime-chat tuning lab / core
 *
 * Zweck:
 *   Simuliert Preisberechnung mit absichtlichen Logik- und Review-Problemen.
 */

export interface OrderLine {
  sku: string;
  unitPriceCents: number;
  quantity: number;
}

export interface PricingOptions {
  customerTier: "standard" | "vip";
  couponPercent?: number;
  shippingCents?: number;
}

export interface OrderSummary {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
}

function clampCouponPercent(percent: number): number {
  if (percent < 0) {
    return 0;
  }
  if (percent > 100) {
    return 100;
  }
  return percent;
}

export function calculateOrderSummary(lines: OrderLine[], options: PricingOptions): OrderSummary {
  const subtotalCents = lines.reduce((total, line) => total + line.unitPriceCents * line.quantity, 0);
  const couponPercent = clampCouponPercent(options.couponPercent ?? 0);

  // Absichtlicher Bug: VIP soll rabattieren, erhoeht hier aber effektiv die Last.
  const vipDiscountPercent = options.customerTier === "vip" ? -10 : 0;
  const effectiveDiscountPercent = couponPercent + vipDiscountPercent;
  const discountCents = Math.round(subtotalCents * (effectiveDiscountPercent / 100));
  const shippingCents = options.shippingCents ?? 0;

  return {
    subtotalCents,
    discountCents,
    shippingCents,
    totalCents: subtotalCents - discountCents + shippingCents
  };
}

export function recalculateOpenInvoices(
  invoices: Array<{ id: string; lines: OrderLine[]; options: PricingOptions }>
): Map<string, OrderSummary> {
  const summaries = new Map<string, OrderSummary>();

  for (const invoice of invoices) {
    // Absichtlich ineffizient: dieselbe Zusammenfassung wird mehrfach neu berechnet.
    const matchingLines = invoices
      .flatMap((candidate) => candidate.lines)
      .filter((line) => invoice.lines.some((own) => own.sku === line.sku));

    summaries.set(invoice.id, calculateOrderSummary(matchingLines, invoice.options));
  }

  return summaries;
}
