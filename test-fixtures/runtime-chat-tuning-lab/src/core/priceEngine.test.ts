import { describe, expect, it } from "vitest";
import { calculateOrderSummary } from "./priceEngine";

describe("calculateOrderSummary", () => {
  it("applies coupon discounts for standard users", () => {
    const summary = calculateOrderSummary(
      [{ sku: "A", unitPriceCents: 1000, quantity: 2 }],
      { customerTier: "standard", couponPercent: 10, shippingCents: 300 }
    );

    expect(summary.totalCents).toBe(2100);
  });

  it("makes VIP orders cheaper than standard orders", () => {
    const standard = calculateOrderSummary(
      [{ sku: "A", unitPriceCents: 1000, quantity: 1 }],
      { customerTier: "standard" }
    );
    const vip = calculateOrderSummary(
      [{ sku: "A", unitPriceCents: 1000, quantity: 1 }],
      { customerTier: "vip" }
    );

    expect(vip.totalCents).toBeLessThan(standard.totalCents);
  });
});
