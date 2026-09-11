import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { openTradeStream } from "@/api/realtime/trade-events";
import { TRADES_QUERY_ROOT } from "@/features/trades/hooks/use-trades";
import type { TradeEvent } from "@/api/generated/models";
import type { ConnectionState } from "@/types/trade";

/**
 * SSE is a notification channel, not the source of truth.
 *
 * The server tells us a trade changed; we ask REST what the blotter now looks
 * like. `invalidateQueries` marks the trades cache stale, every `useTrades`
 * subscriber refetches, and the table re-renders. That is the whole update
 * loop, and it is deliberately the simplest thing that is always correct: the
 * screen can only ever show what the server just said.
 *
 * The event payload is used for two things that a refetch cannot answer,
 * neither of which touches the cache — when the last update landed, and which
 * version the server last reported per trade, so a form open over a trade that
 * has moved underneath it can say so.
 *
 * ── Known trade-offs ─────────────────────────────────────────────────────
 *
 * Deliberate, and fine at take-home scale (a handful of clients, a quiet
 * desk). Each would need addressing before this ran a real floor:
 *
 *  1. One refetch per event, per client. A burst of activity is a burst of
 *     requests from every connected browser. The fix is a debounced trailing
 *     window, so a burst costs one request per client rather than N.
 *  2. A row already on screen still costs a round trip, even though the event
 *     carries the canonical trade and could be written straight into the
 *     cache. The fix is patching the cached page from the payload and
 *     refetching only what a single page cannot settle — membership and
 *     ordering.
 *  3. Connection state trusts `EventSource`. A socket that dies silently can
 *     sit open for minutes without raising `onerror`, and this will keep
 *     reporting "live" throughout. The fix is a watchdog over the 5s
 *     heartbeat, treating silence past two of them as dead.
 *  4. `latestVersions` grows for the life of the session. Bounded in practice
 *     by how many distinct trades move while the tab is open.
 */

export type TradeStreamState = {
  connection: ConnectionState;
  lastUpdateAt: string | null;
  /** Version the server last reported per trade, for stale-form detection. */
  latestVersions: Record<string, number>;
};

type Options = {
  enabled: boolean;
  /** Called when an event arrives for a trade the user currently has open. */
  onRemoteUpdate?: (event: TradeEvent) => void;
  /** Called only once the server confirms the session is gone. */
  onSessionExpired?: () => void;
};

export function useTradeStream({
  enabled,
  onRemoteUpdate,
  onSessionExpired
}: Options): TradeStreamState {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<ConnectionState>("reconnecting");
  const [lastUpdateAt, setLastUpdateAt] = useState<string | null>(null);
  const [latestVersions, setLatestVersions] = useState<Record<string, number>>({});

  const updateRef = useRef(onRemoteUpdate);
  const expiredRef = useRef(onSessionExpired);

  /*
   * The stream is opened once and calls back through these refs, so a new
   * callback identity never tears down a healthy connection. Writing them in
   * an effect keeps the mutation out of the render phase.
   */
  useEffect(() => {
    updateRef.current = onRemoteUpdate;
    expiredRef.current = onSessionExpired;
  });

  useEffect(() => {
    if (!enabled) return;

    const stream = openTradeStream({
      // Connect and every reconnect land here, so an event missed while
      // disconnected cannot leave the blotter stale.
      onConnected: () => {
        setConnection("live");
        void queryClient.invalidateQueries({ queryKey: TRADES_QUERY_ROOT });
      },

      onHeartbeat: () => setConnection("live"),

      onEvent: (event) => {
        setLastUpdateAt(event.occurredAt);
        setLatestVersions((current) => {
          const seen = current[event.trade.id];
          // Ignore a duplicate or a frame that overtook its predecessor,
          // which would otherwise raise a stale-form warning in reverse.
          if (seen !== undefined && seen >= event.trade.version) return current;
          return { ...current, [event.trade.id]: event.trade.version };
        });

        // Warn an open form before the refetch lands underneath it.
        updateRef.current?.(event);
        void queryClient.invalidateQueries({ queryKey: TRADES_QUERY_ROOT });
      },

      // The server revalidates the session behind a live stream and closes it
      // when that session is revoked, so this is conclusive — unlike an error,
      // which is equally a network fault.
      onSessionExpired: () => {
        setConnection("disconnected");
        expiredRef.current?.();
      },

      onError: () => setConnection("disconnected")
    });

    return () => stream.close();
  }, [enabled, queryClient]);

  return {
    // Derived rather than stored: with no stream open there is nothing to
    // report, and writing that into state from an effect would render one
    // frame of the previous connection before correcting itself.
    connection: enabled ? connection : "disconnected",
    lastUpdateAt,
    latestVersions
  };
}
