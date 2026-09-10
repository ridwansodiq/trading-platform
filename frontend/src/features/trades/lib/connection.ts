import type { ConnectionState } from "@/types/trade";

/**
 * The server sends a heartbeat every 5s, so silence past two of them plus a
 * margin means the connection is dead even though no error was raised. TCP can
 * hold a broken socket open for minutes, which is why elapsed silence — not
 * `EventSource.onerror` alone — is the primary signal.
 */
export const STREAM_SILENCE_TIMEOUT_MS = 11_000;

export type ConnectionSignals = {
  /** `navigator.onLine` — false is authoritative proof of no network. */
  browserOnline: boolean;
  /** True once `EventSource` has given up rather than scheduled a retry. */
  streamClosed: boolean;
  /** When the stream last delivered anything, or null before the first frame. */
  lastMessageAt: number | null;
  now: number;
  timeoutMs?: number;
};

/**
 * Single source of truth for what the connection indicator shows.
 *
 * Ordered by how conclusive each signal is: the browser reporting no network
 * beats everything, then a permanently closed stream, then silence.
 */
export function resolveConnection({
  browserOnline,
  streamClosed,
  lastMessageAt,
  now,
  timeoutMs = STREAM_SILENCE_TIMEOUT_MS
}: ConnectionSignals): ConnectionState {
  if (!browserOnline) return "offline";
  if (streamClosed) return "disconnected";
  // Nothing has arrived yet: opening, not broken.
  if (lastMessageAt === null) return "reconnecting";
  if (now - lastMessageAt > timeoutMs) return "disconnected";
  return "live";
}

/** True when the stream has gone quiet for longer than it should. */
export function isStreamStale(
  lastMessageAt: number | null,
  now: number,
  timeoutMs = STREAM_SILENCE_TIMEOUT_MS
): boolean {
  return lastMessageAt !== null && now - lastMessageAt > timeoutMs;
}
