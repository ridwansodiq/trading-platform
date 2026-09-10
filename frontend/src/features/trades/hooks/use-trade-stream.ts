import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "@/api/generated/endpoints/authentication/authentication";
import { ApiError } from "@/api/fetch-client";
import { openTradeStream } from "@/api/realtime/trade-events";
import {
  isStreamStale,
  resolveConnection,
  STREAM_SILENCE_TIMEOUT_MS
} from "@/features/trades/lib/connection";
import { TRADES_QUERY_ROOT } from "@/features/trades/hooks/use-trades";
import type { TradeEvent } from "@/api/generated/models";
import type { ConnectionState } from "@/types/trade";

/** How often the watchdog re-evaluates silence. */
const WATCHDOG_INTERVAL_MS = 1_000;

/**
 * Events are batched into one refetch over this window.
 *
 * A busy desk produces a burst of notifications, and every connected client
 * sees all of them. Refetching per event turns one trader's activity into a
 * request storm from everyone's browser; a short trailing window collapses a
 * burst into a single refetch while still feeling immediate.
 */
const REFETCH_COALESCE_MS = 250;

/**
 * How many trades' versions to remember for stale-form detection.
 *
 * Only the trade currently open in a form is ever read back, so an unbounded
 * map is pure growth in a screen that stays open all day.
 */
const TRACKED_VERSION_LIMIT = 200;

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
  /** Called only once the session is confirmed invalid, never on a network drop. */
  onSessionExpired?: () => void;
};

function browserOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** Keep the most recently seen entries, discarding the oldest. */
function withTrackedLimit(versions: Record<string, number>): Record<string, number> {
  const keys = Object.keys(versions);
  if (keys.length <= TRACKED_VERSION_LIMIT) return versions;
  return Object.fromEntries(
    keys.slice(keys.length - TRACKED_VERSION_LIMIT).map((key) => [key, versions[key] as number])
  );
}

/**
 * SSE is a notification channel, not the source of truth.
 *
 * Connection state is derived from three signals rather than from
 * `EventSource.onerror` alone, which can stay silent for minutes while a broken
 * socket sits open:
 *
 *   - `navigator.onLine` — instant and conclusive when the machine drops off.
 *   - a permanently closed `EventSource` — the browser has stopped retrying.
 *   - elapsed silence — no heartbeat for longer than two intervals.
 *
 * On connect and every reconnect we refetch REST state, so a notification
 * missed while disconnected cannot leave the blotter stale. Incoming events
 * only ever trigger a refetch and record the observed version — they never
 * write a trade into the cache directly.
 */
export function useTradeStream({ enabled, onRemoteUpdate, onSessionExpired }: Options): TradeStreamState {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<ConnectionState>("reconnecting");
  const [lastUpdateAt, setLastUpdateAt] = useState<string | null>(null);
  const [latestVersions, setLatestVersions] = useState<Record<string, number>>({});

  /** Bumped to tear down and reopen the stream immediately. */
  const [reconnectKey, setReconnectKey] = useState(0);

  const lastMessageAtRef = useRef<number | null>(null);
  const streamClosedRef = useRef(false);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateRef = useRef(onRemoteUpdate);
  const expiredRef = useRef(onSessionExpired);

  /*
   * The stream is opened once and calls back through these refs, so a new
   * callback identity never tears down a healthy connection. Writing them in an
   * effect keeps the mutation out of the render phase.
   */
  useEffect(() => {
    updateRef.current = onRemoteUpdate;
    expiredRef.current = onSessionExpired;
  });

  const recomputeConnection = useCallback(() => {
    setConnection(
      resolveConnection({
        browserOnline: browserOnline(),
        streamClosed: streamClosedRef.current,
        lastMessageAt: lastMessageAtRef.current,
        now: Date.now()
      })
    );
  }, []);

  /** Collapses a burst of notifications into one authoritative refetch. */
  const scheduleRefetch = useCallback(() => {
    if (refetchTimerRef.current !== null) return;
    refetchTimerRef.current = setTimeout(() => {
      refetchTimerRef.current = null;
      void queryClient.invalidateQueries({ queryKey: TRADES_QUERY_ROOT });
    }, REFETCH_COALESCE_MS);
  }, [queryClient]);

  const reopen = useCallback(() => {
    lastMessageAtRef.current = null;
    streamClosedRef.current = false;
    setReconnectKey((key) => key + 1);
  }, []);

  // ── The stream itself ────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;

    const stream = openTradeStream({
      onHeartbeat: () => {
        lastMessageAtRef.current = Date.now();
        streamClosedRef.current = false;
        recomputeConnection();
      },
      onConnected: () => {
        // Reconcile against authoritative state on connect and reconnect.
        void queryClient.invalidateQueries({ queryKey: TRADES_QUERY_ROOT });
      },
      onEvent: (event) => {
        setLastUpdateAt(event.occurredAt);
        setLatestVersions((current) => {
          const seen = current[event.trade.id];
          // Ignore duplicate or out-of-order notifications.
          if (seen !== undefined && seen >= event.trade.version) return current;
          return withTrackedLimit({ ...current, [event.trade.id]: event.trade.version });
        });
        updateRef.current?.(event);
        scheduleRefetch();
      },
      // The server said so, so there is nothing to confirm.
      onSessionExpired: () => {
        streamClosedRef.current = true;
        recomputeConnection();
        expiredRef.current?.();
      },
      onError: (permanentlyClosed) => {
        streamClosedRef.current = permanentlyClosed;
        recomputeConnection();

        // A closed stream is either a dead session or a dead network. Ask,
        // rather than assuming expiry and throwing up a misleading dialog.
        if (permanentlyClosed && browserOnline()) {
          getCurrentUser().catch((error) => {
            if (error instanceof ApiError && error.status === 401) expiredRef.current?.();
          });
        }
      }
    });

    return () => {
      stream.close();
      streamClosedRef.current = false;
      lastMessageAtRef.current = null;
      if (refetchTimerRef.current !== null) {
        clearTimeout(refetchTimerRef.current);
        refetchTimerRef.current = null;
      }
    };
  }, [enabled, reconnectKey, queryClient, recomputeConnection, scheduleRefetch]);

  // ── Watchdog: catches a socket that is open but silent ───────────────────
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(recomputeConnection, WATCHDOG_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled, recomputeConnection]);

  // ── Instant browser signals ──────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;

    const goOffline = () => {
      streamClosedRef.current = true;
      recomputeConnection();
    };

    // Don't wait out the browser's own retry backoff once the network returns.
    const goOnline = () => {
      recomputeConnection();
      reopen();
    };

    // Waking a backgrounded tab: the stream is usually dead but has raised
    // nothing yet, so re-evaluate and reopen if it has gone quiet.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      recomputeConnection();
      if (streamClosedRef.current || isStreamStale(lastMessageAtRef.current, Date.now())) {
        reopen();
      }
    };

    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, recomputeConnection, reopen]);

  return {
    // Derived rather than stored: with no stream open there is nothing to
    // report, and writing that into state from an effect would render one
    // frame of the previous connection before correcting itself.
    connection: enabled ? connection : "disconnected",
    lastUpdateAt,
    latestVersions
  };
}

export { STREAM_SILENCE_TIMEOUT_MS };
