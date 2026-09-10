import { describe, expect, it } from "vitest";
import { toTradeView } from "./trade-view";
import type { Trade } from "@/types/trade";

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "9e3a31d9-4660-4ed4-9144-44a1a38c854f",
    tradeId: "TRD-2041",
    symbol: "TSLA",
    side: "BUY",
    quantity: 3150,
    price: 262.05,
    traderUserId: "4a738e88-b7b4-4f6d-bc7f-69a76ddb2e1a",
    trader: "Marcus Ellery",
    book: "EQ-VOL",
    counterparty: "Morgan Stanley",
    tradeTimestamp: "2026-09-10T09:52:18.000Z",
    status: "NEW",
    version: 3,
    createdAt: "2026-09-10T09:52:18.000Z",
    updatedAt: "2026-09-10T09:52:18.000Z",
    ...overrides
  };
}

describe("derived trade metrics", () => {
  it("derives notional as quantity times price", () => {
    const view = toTradeView(trade({ quantity: 12_500, price: 214.32 }));
    expect(view.notionalValue).toBe(2_679_000);
    expect(view.notional).toBe("2,679,000.00");
  });

  it("signs a BUY positively", () => {
    const view = toTradeView(trade({ side: "BUY", quantity: 3150, price: 262.05 }));
    expect(view.signedQuantity).toBe("+3,150");
    expect(view.signedQuantityValue).toBe(3150);
    expect(view.signedNotional).toBe("+825,457.50");
  });

  it("signs a SELL negatively", () => {
    const view = toTradeView(trade({ side: "SELL", quantity: 3150, price: 262.05 }));
    expect(view.signedQuantity).toBe("−3,150");
    expect(view.signedQuantityValue).toBe(-3150);
    expect(view.signedNotionalValue).toBe(-825_457.5);
  });

  it("keeps derived values off the canonical trade shape", () => {
    const source = trade();
    toTradeView(source);
    expect(source).not.toHaveProperty("notional");
    expect(source).not.toHaveProperty("signedQuantity");
  });

  it("avoids binary floating-point drift on notional", () => {
    // 0.1 * 3 is 0.30000000000000004 in plain float arithmetic.
    const view = toTradeView(trade({ quantity: 3, price: 0.1 }));
    expect(view.notional).toBe("0.30");
  });

  /**
   * Ordering by a derived column is the database's job — it can order every
   * matching trade, where the client could only rearrange the loaded page.
   * There is deliberately no comparator here to test.
   */
  it("exposes raw values for comparison without owning the ordering", () => {
    const view = toTradeView(trade({ side: "SELL", quantity: 100, price: 10 }));
    expect(view.notionalValue).toBe(1000);
    expect(view.signedNotionalValue).toBe(-1000);
  });
});
