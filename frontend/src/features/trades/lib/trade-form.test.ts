import { describe, expect, it } from "vitest";
import { changedFields, toFormValues, toTradeRequest, validateTradeForm } from "./trade-form";
import type { FormValues } from "./trade-form";
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

const NOW = new Date("2026-09-10T10:00:00.000Z");

function values(overrides: Partial<FormValues> = {}): FormValues {
  return { ...toFormValues(trade(), NOW), ...overrides };
}

/**
 * Dirty-field tracking is what stops an amendment overwriting a field the user
 * never touched, so it is the most load-bearing logic in the form.
 */
describe("changedFields", () => {
  it("reports nothing for an untouched form", () => {
    const baseline = values();
    expect(changedFields(baseline, baseline)).toEqual([]);
  });

  it("reports only the field that was edited", () => {
    expect(changedFields(values(), values({ quantity: "4200" }))).toEqual(["quantity"]);
  });

  it("reports several edits together", () => {
    const edited = values({ quantity: "4200", counterparty: "Jane Street" });
    expect(changedFields(values(), edited).sort()).toEqual(["counterparty", "quantity"]);
  });

  /**
   * Comparing normalised requests rather than raw text: retyping the same value
   * differently is not an edit, and sending it would overwrite a concurrent
   * change for no reason.
   */
  it("ignores whitespace and casing that normalise away", () => {
    expect(changedFields(values(), values({ symbol: "  tsla  " }))).toEqual([]);
    expect(changedFields(values(), values({ book: " EQ-VOL " }))).toEqual([]);
  });

  it("treats a numerically equal quantity as unchanged", () => {
    expect(changedFields(values(), values({ quantity: "3150." }))).toEqual([]);
  });
});

describe("toTradeRequest", () => {
  it("normalises the values the form submits", () => {
    const request = toTradeRequest(values({ symbol: " nvda ", book: " EQ-A ", quantity: "10" }));
    expect(request).toMatchObject({ symbol: "NVDA", book: "EQ-A", quantity: 10 });
  });

  it("round-trips a trade through the form without changing it", () => {
    const source = trade();
    const request = toTradeRequest(toFormValues(source, NOW));
    expect(request).toEqual({
      symbol: source.symbol,
      side: source.side,
      quantity: source.quantity,
      price: source.price,
      book: source.book,
      counterparty: source.counterparty,
      tradeTimestamp: source.tradeTimestamp
    });
  });
});

/**
 * Validation runs the generated request schema, so the form enforces exactly
 * what the server does. These cases are the ones that used to reach the API and
 * come back as an error the form could not attribute to a field.
 */
describe("validateTradeForm", () => {
  it("accepts a valid trade", () => {
    expect(validateTradeForm(values())).toEqual({});
  });

  it("enforces the contract's length caps", () => {
    expect(validateTradeForm(values({ symbol: "A".repeat(13) })).symbol).toBeDefined();
    expect(validateTradeForm(values({ book: "B".repeat(41) })).book).toBeDefined();
    expect(validateTradeForm(values({ counterparty: "C".repeat(81) })).counterparty).toBeDefined();
  });

  it("rejects a price with more precision than the column stores", () => {
    expect(validateTradeForm(values({ price: "72.256789" })).price).toMatch(/decimal places/);
    expect(validateTradeForm(values({ price: "72.2568" })).price).toBeUndefined();
  });

  it("reports an empty numeric field as missing rather than out of range", () => {
    const errors = validateTradeForm(values({ quantity: "", price: "" }));
    expect(errors.quantity).toBe("Quantity is required.");
    expect(errors.price).toBe("Price is required.");
  });

  it.each([
    ["quantity", "0"],
    ["quantity", "-5"],
    ["quantity", "1.5"],
    ["price", "0"],
    ["price", "-1"]
  ])("rejects %s of %s", (field, value) => {
    expect(validateTradeForm(values({ [field]: value }))[field as keyof FormValues]).toBeDefined();
  });

  it("requires symbol, book and counterparty", () => {
    const errors = validateTradeForm(values({ symbol: " ", book: " ", counterparty: " " }));
    expect(errors.symbol).toBeDefined();
    expect(errors.book).toBeDefined();
    expect(errors.counterparty).toBeDefined();
  });

  it("requires a trade time", () => {
    expect(validateTradeForm(values({ tradeTimestamp: "" })).tradeTimestamp).toBe(
      "Trade time is required."
    );
  });
});
