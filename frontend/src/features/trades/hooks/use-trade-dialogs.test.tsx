import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/fetch-client";
import { toTradeView } from "@/features/trades/lib/trade-view";
import type { ReactNode } from "react";
import type { Trade, TradeView } from "@/types/trade";

const executeTrade = vi.fn();
const cancelTrade = vi.fn();

vi.mock("@/api/generated/endpoints/trades/trades", () => ({
  createTrade: vi.fn(),
  amendTrade: vi.fn(),
  executeTrade: (...args: unknown[]) => executeTrade(...args),
  cancelTrade: (...args: unknown[]) => cancelTrade(...args)
}));

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("sonner", () => ({ toast: { ...toast } as typeof toast }));

const { useTradeDialogs } = await import("./use-trade-dialogs");

/**
 * The two surfaces opened over a single row.
 *
 * Execute and cancel are irreversible, so what matters is that nothing reaches
 * the server until the user confirms, that the command carries the version they
 * confirmed against, and that the dialog closes either way — a rejected command
 * leaving its dialog up would strand them.
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
  return renderHook(() => useTradeDialogs(), { wrapper });
}

beforeEach(() => {
  executeTrade.mockResolvedValue({ status: 200, data: trade({ status: "EXECUTED", version: 4 }) });
  cancelTrade.mockResolvedValue({ status: 200, data: trade({ status: "CANCELLED", version: 4 }) });
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
});

afterEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
});
describe("terminal transitions", () => {
  it.each([
    ["execute", executeTrade],
    ["cancel", cancelTrade]
  ] as const)("sends %s with the version the user confirmed against", async (kind, endpoint) => {
    const { result } = mount();
    act(() => result.current.startTransition(kind, view()));
    expect(result.current.confirm).toMatchObject({ kind });

    await act(async () => await result.current.confirmTransition());

    expect(endpoint).toHaveBeenCalledExactlyOnceWith(TRADE_ID, { expectedVersion: 3 });
    expect(result.current.confirm).toBeNull();
  });

  it("closes the dialog even when the command is rejected", async () => {
    executeTrade.mockRejectedValue(versionConflict(trade({ version: 9 }), 3));

    const { result } = mount();
    act(() => result.current.startTransition("execute", view()));
    await act(async () => await result.current.confirmTransition());

    // The failure is reported as a toast; leaving the dialog up would strand the user.
    expect(result.current.confirm).toBeNull();
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it("does nothing when confirmed with no trade pending", async () => {
    const { result } = mount();
    await act(async () => await result.current.confirmTransition());
    expect(executeTrade).not.toHaveBeenCalled();
  });

  it("abandons the transition when the dialog is dismissed", async () => {
    const { result } = mount();
    act(() => result.current.startTransition("cancel", view()));
    act(() => result.current.closeConfirm());

    expect(result.current.confirm).toBeNull();
    expect(cancelTrade).not.toHaveBeenCalled();
  });
});

describe("reading a trade's history", () => {
  it("opens the audit drawer on the trade asked for", () => {
    const { result } = mount();
    act(() => result.current.openAudit(view()));

    expect(result.current.auditTrade).toMatchObject({ tradeId: "TRD-0001" });
    // Otherwise a single keystroke would act on the row behind the drawer.
    expect(result.current.isOpen).toBe(true);
  });

  it("stands down again once the drawer closes", () => {
    const { result } = mount();
    act(() => result.current.openAudit(view()));
    act(() => result.current.closeAudit());

    expect(result.current.auditTrade).toBeNull();
    expect(result.current.isOpen).toBe(false);
  });

  it("reports no open surface on an idle blotter", () => {
    expect(mount().result.current.isOpen).toBe(false);
  });
});
