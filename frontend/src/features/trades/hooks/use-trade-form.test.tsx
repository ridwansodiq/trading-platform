import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/fetch-client";
import { toTradeView } from "@/features/trades/lib/trade-view";
import type { ReactNode } from "react";
import type { Trade, TradeView } from "@/types/trade";

const createTrade = vi.fn();
const amendTrade = vi.fn();

vi.mock("@/api/generated/endpoints/trades/trades", () => ({
  createTrade: (...args: unknown[]) => createTrade(...args),
  amendTrade: (...args: unknown[]) => amendTrade(...args),
  executeTrade: vi.fn(),
  cancelTrade: vi.fn()
}));

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("sonner", () => ({ toast: { ...toast } as typeof toast }));

const { useTradeForm } = await import("./use-trade-form");

/**
 * Booking and amending. What matters here is not that a request goes out but
 * exactly *what* goes out: an amendment must carry only the fields the user
 * edited plus the version they opened, because resubmitting untouched values
 * would silently overwrite a concurrent amendment — the very thing the conflict
 * flow exists to surface.
 */

const TRADE_ID = "11111111-1111-4111-8111-111111111111";

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: TRADE_ID,
    tradeId: "TRD-0001",
    symbol: "VOD.L",
    side: "BUY",
    quantity: 1000,
    price: 12.5,
    traderUserId: "22222222-2222-4222-8222-222222222222",
    trader: "a.trader",
    book: "EQ-LDN-1",
    counterparty: "Goldman Sachs",
    tradeTimestamp: "2026-09-11T09:30:00.000Z",
    status: "NEW",
    version: 3,
    createdAt: "2026-09-11T09:30:00.000Z",
    updatedAt: "2026-09-11T09:30:00.000Z",
    ...overrides
  };
}

function view(overrides: Partial<Trade> = {}): TradeView {
  return toTradeView(trade(overrides));
}

/** A 409 shaped the way the trades API reports a lost race. */
function versionConflict(server: Trade, expectedVersion: number) {
  return new ApiError(409, {
    message: "Version conflict",
    expectedVersion,
    currentVersion: server.version,
    currentTrade: server
  });
}

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function mount() {
  return renderHook(() => useTradeForm(), { wrapper });
}

/** Opens the amend form on `subject` and types `edits` into it. */
async function amending(edits: Record<string, string> = {}, subject = view()) {
  const { result } = mount();
  act(() => result.current.startAmend(subject));
  if (Object.keys(edits).length > 0) {
    act(() => result.current.setValues({ ...result.current.values!, ...edits }));
  }
  return result;
}

beforeEach(() => {
  createTrade.mockResolvedValue({ status: 201, data: trade({ version: 1 }) });
  amendTrade.mockResolvedValue({ status: 200, data: trade({ version: 4 }) });
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
});

afterEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
});
describe("booking a trade", () => {
  it("opens on an empty form rather than on the last trade's values", async () => {
    const { result } = mount();
    act(() => result.current.startCreate());

    expect(result.current.mode).toEqual({ kind: "create" });
    expect(result.current.values).toMatchObject({ symbol: "", quantity: "", price: "", side: "BUY" });
    // Nothing is dirty on a form the user has not touched.
    expect(result.current.changed).toEqual([]);
  });

  it("sends the whole normalised request and closes on success", async () => {
    const { result } = mount();
    act(() => result.current.startCreate());
    act(() =>
      result.current.setValues({
        symbol: " vod.l ",
        side: "SELL",
        quantity: "500",
        price: "12.5",
        book: "  EQ-LDN-1 ",
        counterparty: " Goldman Sachs ",
        tradeTimestamp: "2026-09-11T09:30:00"
      })
    );
    await act(async () => await result.current.submit());

    expect(createTrade).toHaveBeenCalledExactlyOnceWith({
      symbol: "VOD.L",
      side: "SELL",
      quantity: 500,
      price: 12.5,
      book: "EQ-LDN-1",
      counterparty: "Goldman Sachs",
      tradeTimestamp: "2026-09-11T09:30:00.000Z"
    });
    expect(result.current.mode).toBeNull();
  });

  it("refuses to submit an invalid form and says which field", async () => {
    const { result } = mount();
    act(() => result.current.startCreate());
    await act(async () => await result.current.submit());

    expect(createTrade).not.toHaveBeenCalled();
    expect(result.current.errors).toMatchObject({
      quantity: "Quantity is required.",
      price: "Price is required."
    });
    // The form stays open on its values so they can be corrected.
    expect(result.current.mode).toEqual({ kind: "create" });
  });
});

describe("amending a trade", () => {
  it("opens on the trade's current values, with nothing marked as edited", async () => {
    const result = await amending();
    expect(result.current.values).toMatchObject({ symbol: "VOD.L", quantity: "1000", price: "12.5" });
    expect(result.current.changed).toEqual([]);
  });

  it("tracks which fields were edited, in display order", async () => {
    const result = await amending({ price: "13.75", symbol: "BP.L" });
    expect(result.current.changed).toEqual(["symbol", "price"]);
  });

  /**
   * Retyping the same value differently is not an edit. Sending it would hand
   * the server a field to overwrite for no reason.
   */
  it("does not treat re-normalising a value as an edit", async () => {
    const result = await amending({ symbol: " vod.l ", counterparty: "Goldman Sachs " });
    expect(result.current.changed).toEqual([]);
  });

  it("sends only the edited fields, with the version the form opened on", async () => {
    const result = await amending({ price: "13.75" });
    await act(async () => await result.current.submit());

    expect(amendTrade).toHaveBeenCalledExactlyOnceWith(TRADE_ID, {
      price: 13.75,
      expectedVersion: 3
    });
  });

  it("never resubmits a field the user left alone", async () => {
    const result = await amending({ quantity: "2000" });
    await act(async () => await result.current.submit());

    const [, body] = amendTrade.mock.calls[0]!;
    expect(Object.keys(body as object).sort()).toEqual(["expectedVersion", "quantity"]);
  });

  it("saves nothing at all when the form closes unchanged", async () => {
    const result = await amending();
    await act(async () => await result.current.submit());

    expect(amendTrade).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("Nothing to save", expect.anything());
    expect(result.current.mode).toBeNull();
  });

  it("validates before sending, so a cleared field never reaches the server", async () => {
    const result = await amending({ quantity: "" });
    await act(async () => await result.current.submit());

    expect(amendTrade).not.toHaveBeenCalled();
    expect(result.current.errors.quantity).toBe("Quantity is required.");
  });
});

describe("losing a race to a concurrent amendment", () => {
  it("surfaces the server's version without touching what the user typed", async () => {
    const server = trade({ version: 5, price: 20, trader: "b.trader" });
    amendTrade.mockRejectedValue(versionConflict(server, 3));

    const result = await amending({ price: "13.75" });
    await act(async () => await result.current.submit());

    expect(result.current.conflict).toMatchObject({
      expectedVersion: 3,
      currentVersion: 5,
      currentTrade: server
    });
    // The form is still open, still holding their number.
    expect(result.current.mode?.kind).toBe("amend");
    expect(result.current.values?.price).toBe("13.75");
  });

  it("does not report a conflict as a plain submission error", async () => {
    amendTrade.mockRejectedValue(versionConflict(trade({ version: 5 }), 3));
    const result = await amending({ price: "13.75" });
    await act(async () => await result.current.submit());

    expect(result.current.submitError).toBeNull();
    expect(result.current.errors).toEqual({});
  });

  /**
   * Rebasing moves only the baseline. The user's edits stay, and fields they
   * never touched now read as the newer version — so saving again submits their
   * change without reverting the other trader's.
   */
  it("rebases onto the server version while keeping the user's edit", async () => {
    const server = trade({ version: 5, quantity: 4000, book: "EQ-LDN-2" });
    amendTrade.mockRejectedValue(versionConflict(server, 3));

    const result = await amending({ price: "13.75" });
    await act(async () => await result.current.submit());
    act(() => result.current.reapplyConflict(server));

    expect(result.current.conflict).toBeNull();
    expect(result.current.values?.price).toBe("13.75");
    // The other trader's quantity and book came across untouched.
    expect(result.current.values?.quantity).toBe("4000");
    expect(result.current.changed).toEqual(["price"]);
  });

  it("resubmits against the new version after a rebase", async () => {
    const server = trade({ version: 5, quantity: 4000 });
    amendTrade.mockRejectedValueOnce(versionConflict(server, 3));

    const result = await amending({ price: "13.75" });
    await act(async () => await result.current.submit());
    act(() => result.current.reapplyConflict(server));
    await act(async () => await result.current.submit());

    expect(amendTrade).toHaveBeenLastCalledWith(TRADE_ID, { price: 13.75, expectedVersion: 5 });
    expect(result.current.mode).toBeNull();
  });

  it("closes the form and says so when the user discards instead", async () => {
    const server = trade({ version: 5 });
    amendTrade.mockRejectedValue(versionConflict(server, 3));

    const result = await amending({ price: "13.75" });
    await act(async () => await result.current.submit());
    act(() => result.current.discardConflict());

    expect(result.current.mode).toBeNull();
    expect(result.current.conflict).toBeNull();
    expect(toast.info).toHaveBeenCalledWith(
      "Your edit to TRD-0001 was discarded",
      expect.anything()
    );
  });

  it("never carries a conflict over into the next form the user opens", async () => {
    amendTrade.mockRejectedValue(versionConflict(trade({ version: 5 }), 3));
    const result = await amending({ price: "13.75" });
    await act(async () => await result.current.submit());
    expect(result.current.conflict).not.toBeNull();

    act(() => result.current.startCreate());
    expect(result.current.conflict).toBeNull();
    expect(result.current.errors).toEqual({});
  });
});

describe("a submission the server rejects outright", () => {
  it("shows the server's message and maps its details onto the fields", async () => {
    amendTrade.mockRejectedValue(
      new ApiError(422, {
        message: "Trade failed validation.",
        details: [{ path: "price", message: "Price is outside the tolerance band." }]
      })
    );

    const result = await amending({ price: "13.75" });
    await act(async () => await result.current.submit());

    expect(result.current.submitError).toBe("Trade failed validation.");
    expect(result.current.errors.price).toBe("Price is outside the tolerance band.");
    // Nothing was written, so the form must stay open on their input.
    expect(result.current.mode?.kind).toBe("amend");
  });

  it("falls back to a plain message when the failure is not an API error", async () => {
    createTrade.mockRejectedValue(new TypeError("Failed to fetch"));

    const { result } = mount();
    act(() => result.current.startCreate());
    act(() =>
      result.current.setValues({
        ...result.current.values!,
        symbol: "VOD.L",
        quantity: "100",
        price: "10",
        book: "EQ-LDN-1",
        counterparty: "GS"
      })
    );
    await act(async () => await result.current.submit());

    expect(result.current.submitError).toBe(
      "The blotter service rejected this submission. No changes were written."
    );
  });
});

describe("suspending the blotter's shortcuts", () => {
  it("reports no open form on an idle blotter", () => {
    expect(mount().result.current.isOpen).toBe(false);
  });

  it("reports the form as open while it is up", () => {
    const { result } = mount();
    act(() => result.current.startCreate());
    // Otherwise typing a symbol into the drawer would book another trade.
    expect(result.current.isOpen).toBe(true);
  });

  it("stands down again once the form closes", () => {
    const { result } = mount();
    act(() => result.current.startCreate());
    act(() => result.current.close());

    expect(result.current.mode).toBeNull();
    expect(result.current.isOpen).toBe(false);
  });
});
