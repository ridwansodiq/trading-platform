import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTradeStream } from "./use-trade-stream";
import { TRADES_QUERY_ROOT } from "./use-trades";
import type { TradeEvent } from "@/api/generated/models";
import type { ReactNode } from "react";
import type { Trade, TradeAuditEventType } from "@/types/trade";

/**
 * Drives `useTradeStream` over a stand-in for `EventSource`, which jsdom does
 * not implement.
 *
 * What is worth testing here is that every signal the server can send moves the
 * screen: an event refetches, a heartbeat proves the connection, and a revoked
 * session is reported as revoked rather than as a network fault.
 */
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readyState = FakeEventSource.OPEN;
  onerror: ((event: unknown) => void) | null = null;
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    const existing = this.listeners.get(type) ?? new Set();
    existing.add(handler);
    this.listeners.set(type, existing);
  }

  removeEventListener(type: string, handler: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(handler);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  /** Delivers a frame the way the browser would, with `data` as a JSON string. */
  emit(type: string, payload: unknown = {}): void {
    for (const handler of this.listeners.get(type) ?? []) {
      handler({ data: JSON.stringify(payload) });
    }
  }
}

const TRADE_ID = "11111111-1111-4111-8111-111111111111";

const BASE_TRADE: Trade = {
  id: TRADE_ID,
  tradeId: "TRD-0001",
  symbol: "AAPL",
  side: "BUY",
  quantity: 100,
  price: 10,
  traderUserId: "22222222-2222-4222-8222-222222222222",
  trader: "a.trader",
  book: "EQ-CASH",
  counterparty: "GS",
  tradeTimestamp: "2026-09-11T10:00:00.000Z",
  status: "NEW",
  version: 1,
  createdAt: "2026-09-11T10:00:00.000Z",
  updatedAt: "2026-09-11T10:00:00.000Z"
};

function tradeEvent(
  trade: Partial<Trade> = {},
  eventType: TradeAuditEventType = "AMENDED",
  occurredAt = "2026-09-11T10:05:00.000Z"
): TradeEvent {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    eventType,
    trade: { ...BASE_TRADE, ...trade },
    occurredAt
  };
}

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function latest(): FakeEventSource {
  const source = FakeEventSource.instances.at(-1);
  if (!source) throw new Error("no stream was opened");
  return source;
}

function emit(type: string, payload: unknown = {}): void {
  act(() => {
    latest().emit(type, payload);
  });
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe("useTradeStream", () => {
  it("does not open a stream while disabled", () => {
    const { result } = renderHook(() => useTradeStream({ enabled: false }), { wrapper });

    expect(FakeEventSource.instances).toHaveLength(0);
    expect(result.current.connection).toBe("disconnected");
  });

  it("refetches trades on connect, so nothing missed while away survives", () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    renderHook(() => useTradeStream({ enabled: true }), { wrapper });

    emit("connected");

    expect(invalidate).toHaveBeenCalledWith({ queryKey: TRADES_QUERY_ROOT });
  });

  it("refetches trades on every event", () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    renderHook(() => useTradeStream({ enabled: true }), { wrapper });
    emit("connected");
    invalidate.mockClear();

    emit("trade-update", tradeEvent({ version: 2 }));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: TRADES_QUERY_ROOT });
  });

  it("reports the version an event carried, for stale-form detection", () => {
    const { result } = renderHook(() => useTradeStream({ enabled: true }), { wrapper });

    emit("trade-update", tradeEvent({ version: 3 }));

    expect(result.current.latestVersions[TRADE_ID]).toBe(3);
    expect(result.current.lastUpdateAt).toBe("2026-09-11T10:05:00.000Z");
  });

  it("ignores a frame that overtook its predecessor", () => {
    const { result } = renderHook(() => useTradeStream({ enabled: true }), { wrapper });

    emit("trade-update", tradeEvent({ version: 5 }));
    emit("trade-update", tradeEvent({ version: 4 }));

    expect(result.current.latestVersions[TRADE_ID]).toBe(5);
  });

  it("notifies the caller of a remote update, so an open form can warn", () => {
    const onRemoteUpdate = vi.fn();
    renderHook(() => useTradeStream({ enabled: true, onRemoteUpdate }), { wrapper });

    emit("trade-update", tradeEvent({ version: 2 }));

    expect(onRemoteUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ trade: expect.objectContaining({ version: 2 }) })
    );
  });

  it("drops a frame that does not match the published contract", () => {
    const { result } = renderHook(() => useTradeStream({ enabled: true }), { wrapper });

    emit("trade-update", { id: "not-a-uuid", eventType: "NONSENSE" });

    expect(result.current.lastUpdateAt).toBeNull();
  });

  it("goes live on a heartbeat", () => {
    const { result } = renderHook(() => useTradeStream({ enabled: true }), { wrapper });
    expect(result.current.connection).toBe("reconnecting");

    emit("heartbeat");

    expect(result.current.connection).toBe("live");
  });

  it("reports a revoked session as expiry rather than as a transport fault", () => {
    const onSessionExpired = vi.fn();
    const { result } = renderHook(() => useTradeStream({ enabled: true, onSessionExpired }), {
      wrapper
    });
    emit("connected");

    emit("session-expired");

    expect(onSessionExpired).toHaveBeenCalledOnce();
    expect(result.current.connection).toBe("disconnected");
  });

  it("closes the stream on unmount", () => {
    const { unmount } = renderHook(() => useTradeStream({ enabled: true }), { wrapper });
    const source = latest();

    unmount();

    expect(source.readyState).toBe(FakeEventSource.CLOSED);
  });
});
