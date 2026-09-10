import { StreamTradeEventsResponse } from "@/api/generated/validation/trades/trades.zod";
import type { TradeEvent } from "@/api/generated/models";

/**
 * Handwritten `EventSource` adapter.
 *
 * SSE stays outside the generated REST client because OpenAPI generation targets
 * request/response operations, not long-lived streams. The *payload* is still
 * contract-driven: it is validated against the generated `TradeEvent` schema
 * before anything reaches the cache.
 */

export type TradeStreamHandlers = {
  /** Fired on first connect and on every reconnect — refetch authoritative REST state here. */
  onConnected: () => void;
  /**
   * Any server keep-alive frame. The caller uses these to tell a live stream
   * from a socket that is open but delivering nothing.
   */
  onHeartbeat: () => void;
  onEvent: (event: TradeEvent) => void;
  /**
   * The server closed the stream because the session behind it is no longer
   * valid. Conclusive, unlike a transport error, so the caller can say so
   * rather than guessing at a network fault.
   */
  onSessionExpired: () => void;
  /**
   * @param permanentlyClosed true when `EventSource` has stopped retrying, so
   * the drop will not recover on its own.
   */
  onError: (permanentlyClosed: boolean) => void;
};

export type TradeStream = { close: () => void };

export const TRADE_EVENTS_URL = "/api/events";

export function openTradeStream(handlers: TradeStreamHandlers): TradeStream {
  const source = new EventSource(TRADE_EVENTS_URL, { withCredentials: true });
  let expired = false;

  source.addEventListener("connected", () => {
    handlers.onHeartbeat();
    handlers.onConnected();
  });

  source.addEventListener("heartbeat", () => handlers.onHeartbeat());

  /*
   * The server revalidates the session on a live stream and closes it when the
   * session is revoked. Closing here too stops `EventSource` reconnecting in a
   * loop that can only ever be rejected.
   */
  source.addEventListener("session-expired", () => {
    expired = true;
    source.close();
    handlers.onSessionExpired();
  });

  source.addEventListener("trade-update", (message) => {
    handlers.onHeartbeat();
    const raw = (message as MessageEvent<string>).data;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A malformed frame is dropped; REST remains authoritative.
      return;
    }
    const result = StreamTradeEventsResponse.safeParse(parsed);
    if (!result.success) return;
    handlers.onEvent(result.data as TradeEvent);
  });

  source.onerror = () => {
    // A close we initiated is not a transport failure.
    if (expired) return;
    handlers.onError(source.readyState === EventSource.CLOSED);
  };

  return {
    close: () => {
      expired = true;
      source.close();
    }
  };
}
