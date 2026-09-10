import { describe, expect, it } from "vitest";
import { compareForConflict, diffTrades } from "./audit-diff";
import type { Trade } from "@/types/trade";

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "9e3a31d9-4660-4ed4-9144-44a1a38c854f",
    tradeId: "TRD-2041",
    symbol: "TSLA",
    side: "SELL",
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

describe("audit field diff", () => {
  it("reports only the fields that changed", () => {
    const changes = diffTrades(trade(), trade({ quantity: 4200, version: 4 }));
    expect(changes).toEqual([{ label: "Quantity", before: "3,150", after: "4,200" }]);
  });

  it("formats each field the way the table does", () => {
    const changes = diffTrades(trade({ price: 262.05 }), trade({ price: 261.7 }));
    expect(changes).toEqual([{ label: "Price", before: "262.05", after: "261.70" }]);
  });

  it("reports a status transition", () => {
    const changes = diffTrades(trade(), trade({ status: "EXECUTED" }));
    expect(changes).toEqual([{ label: "Status", before: "NEW", after: "EXECUTED" }]);
  });

  it("has nothing to diff for a created event", () => {
    expect(diffTrades(null, trade())).toEqual([]);
  });

  it("ignores version and timestamps that every mutation bumps", () => {
    const changes = diffTrades(
      trade(),
      trade({ version: 4, updatedAt: "2026-09-10T10:00:00.000Z" })
    );
    expect(changes).toEqual([]);
  });
});

describe("conflict comparison", () => {
  it("marks the differing fields and leaves the rest neutral", () => {
    const rows = compareForConflict(trade({ quantity: 4200 }), trade({ quantity: 3150, version: 4 }));
    const quantity = rows.find((row) => row.label === "Quantity");
    const symbol = rows.find((row) => row.label === "Symbol");
    expect(quantity).toEqual({
      field: "quantity",
      label: "Quantity",
      mine: "4,200",
      theirs: "3,150",
      differs: true
    });
    expect(symbol?.differs).toBe(false);
  });

  it("omits status, which an amendment can never set", () => {
    const rows = compareForConflict(trade(), trade());
    expect(rows.map((row) => row.label)).not.toContain("Status");
  });
});
