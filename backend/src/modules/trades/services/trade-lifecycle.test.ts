import { describe, expect, it } from "vitest";
import { decideAmend, decideCreate, decideTransition } from "./trade-lifecycle.js";
import { VersionConflictError } from "../errors/trade.errors.js";
import type { TradeActor, TradeState } from "../dtos/trade.dto.js";

const actor: TradeActor = {
  id: "4a738e88-b7b4-4f6d-bc7f-69a76ddb2e1a",
  displayName: "Marcus Ellery"
};

function newTrade(overrides: Partial<TradeState> = {}): TradeState {
  return {
    id: "9e3a31d9-4660-4ed4-9144-44a1a38c854f",
    tradeId: "TRD-2041",
    symbol: "TSLA",
    side: "SELL",
    quantity: 3150,
    price: 262.05,
    traderUserId: actor.id,
    trader: actor.displayName,
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

const createInput = (overrides: Record<string, unknown> = {}) => ({
  id: newTrade().id,
  tradeId: "TRD-2053",
  symbol: "AAPL",
  side: "BUY" as const,
  quantity: 100,
  price: 214.32,
  book: "EQ-DELTA",
  counterparty: "Jane Street",
  tradeTimestamp: "2026-09-10T10:00:00.000Z",
  actor,
  ...overrides
});

describe("decideCreate", () => {
  it("creates a NEW version 1 trade with a matching audit intent", () => {
    const decision = decideCreate(createInput({ symbol: " aapl " }));

    expect(decision.nextTrade).toMatchObject({ symbol: "AAPL", status: "NEW", version: 1 });
    expect(decision.audit).toMatchObject({
      eventType: "CREATED",
      before: null,
      actorUserId: actor.id
    });
  });

  it("derives the trader from the actor rather than the payload", () => {
    const decision = decideCreate(createInput());

    expect(decision.nextTrade.trader).toBe(actor.displayName);
    expect(decision.nextTrade.traderUserId).toBe(actor.id);
  });

  /**
   * Timestamps belong to the database. A decision that carried its own would be
   * describing a row that does not exist yet.
   */
  it("leaves the database-owned timestamps out of the decision", () => {
    const decision = decideCreate(createInput());

    expect(decision.nextTrade).not.toHaveProperty("createdAt");
    expect(decision.nextTrade).not.toHaveProperty("updatedAt");
  });

  it.each([
    [{ quantity: 0 }, "Quantity must be a positive integer."],
    [{ price: -1 }, "Price must be positive."],
    [{ symbol: " " }, "Symbol is required."],
    [{ book: " " }, "Book and counterparty are required."]
  ])("rejects an invalid new trade (%o)", (overrides, message) => {
    expect(() => decideCreate(createInput(overrides))).toThrow(message);
  });
});

describe("decideAmend", () => {
  it("keeps the trade NEW and increments the version exactly once", () => {
    const current = newTrade();
    const decision = decideAmend(current, { quantity: 4200, price: 261.75 }, 3, actor);

    expect(decision.nextTrade).toMatchObject({
      quantity: 4200,
      price: 261.75,
      status: "NEW",
      version: 4
    });
    expect(decision.audit).toMatchObject({ eventType: "AMENDED", before: current });
  });

  it("normalises the amended symbol", () => {
    const decision = decideAmend(newTrade(), { symbol: " nvda " }, 3, actor);
    expect(decision.nextTrade.symbol).toBe("NVDA");
  });

  it("leaves untouched fields alone", () => {
    const decision = decideAmend(newTrade(), { quantity: 10 }, 3, actor);
    expect(decision.nextTrade.counterparty).toBe("Morgan Stanley");
    expect(decision.nextTrade.book).toBe("EQ-VOL");
  });

  /**
   * A partial amendment is what stops two traders editing different fields of
   * the same trade from overwriting one another.
   */
  it("applies only the fields it was given", () => {
    const current = newTrade();
    const decision = decideAmend(current, { price: 270 }, 3, actor);

    expect(decision.nextTrade).toMatchObject({
      price: 270,
      quantity: current.quantity,
      symbol: current.symbol,
      side: current.side,
      book: current.book,
      counterparty: current.counterparty,
      tradeTimestamp: current.tradeTimestamp
    });
  });

  it("never lets an amendment rewrite the booking trader", () => {
    const decision = decideAmend(newTrade(), { quantity: 10 }, 3, actor);
    expect(decision.nextTrade.trader).toBe(newTrade().trader);
    expect(decision.nextTrade.traderUserId).toBe(newTrade().traderUserId);
  });

  it("rejects a stale command without producing a decision", () => {
    expect(() => decideAmend(newTrade(), { price: 270 }, 2, actor)).toThrow(
      "Trade has changed since it was opened."
    );
  });

  /** The UI diffs against this, so a conflict must carry the trade it lost to. */
  it("attaches the current trade to a version conflict", () => {
    const current = newTrade();
    try {
      decideAmend(current, { price: 270 }, 2, actor);
      expect.unreachable("expected a version conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(VersionConflictError);
      const conflict = error as VersionConflictError;
      expect(conflict.expectedVersion).toBe(2);
      expect(conflict.currentTrade).toEqual(current);
      expect(conflict.body()).toMatchObject({ currentVersion: 3, currentTrade: current });
    }
  });

  it("reports the trade as missing when there is nothing to amend", () => {
    expect(() => decideAmend(null, { price: 270 }, 3, actor)).toThrow("Trade not found.");
  });

  it.each(["EXECUTED", "CANCELLED"] as const)("rejects amending a %s trade", (status) => {
    expect(() => decideAmend(newTrade({ status }), { price: 270 }, 3, actor)).toThrow(
      `${status} trades cannot be changed.`
    );
  });

  it.each([
    [{ quantity: 0 }, "Quantity must be a positive integer."],
    [{ price: -1 }, "Price must be positive."],
    [{ symbol: " " }, "Symbol is required."]
  ])("rejects an invalid amendment (%o)", (changes, message) => {
    expect(() => decideAmend(newTrade(), changes, 3, actor)).toThrow(message);
  });
});

describe("decideTransition", () => {
  it.each([
    ["EXECUTE", "EXECUTED"],
    ["CANCEL", "CANCELLED"]
  ] as const)("applies the %s transition and records it", (transition, status) => {
    const decision = decideTransition(newTrade(), transition, 3, actor);
    expect(decision.nextTrade).toMatchObject({ status, version: 4 });
    expect(decision.audit.eventType).toBe(status);
  });

  it.each(["EXECUTED", "CANCELLED"] as const)("refuses to re-transition a %s trade", (status) => {
    expect(() => decideTransition(newTrade({ status }), "EXECUTE", 3, actor)).toThrow(
      `${status} trades cannot be changed.`
    );
  });

  it("rejects a stale transition", () => {
    expect(() => decideTransition(newTrade(), "CANCEL", 1, actor)).toThrow(
      "Trade has changed since it was opened."
    );
  });

  it("preserves the economics of the trade it transitions", () => {
    const decision = decideTransition(newTrade(), "EXECUTE", 3, actor);
    expect(decision.nextTrade).toMatchObject({ quantity: 3150, price: 262.05, symbol: "TSLA" });
  });
});
