import type {
  TradeError as TradeErrorPayload,
  AuthenticatedUser,
  Trade,
  TradeAuditEvent,
  TradeAuditEventType,
  TradeExposure,
  TradeSide,
  TradeSortKey,
  TradeStatus
} from "@/api/generated/models";

export type {
  Trade,
  TradeAuditEvent,
  TradeAuditEventType,
  TradeExposure,
  TradeSide,
  TradeStatus,
  TradeSortKey,
  TradeErrorPayload
};

export type SessionUser = AuthenticatedUser;

/**
 * A trade plus its derived metrics, formatted for display. These are computed
 * in the UI on every read and are never persisted, sent in a command, or stored
 * in an audit snapshot.
 *
 * Ordering by them is a separate matter: the server sorts on the same
 * expressions in SQL, so a sort covers every matching trade rather than the
 * rows that happen to be loaded.
 */
export type TradeView = Trade & {
  notional: string;
  signedQuantity: string;
  signedNotional: string;
  /** Raw values, for colouring and comparison. */
  notionalValue: number;
  signedQuantityValue: number;
  signedNotionalValue: number;
};

/** Every column is sortable server-side, derived ones included. */
export type SortKey = TradeSortKey;

export type SortDirection = "asc" | "desc";

export type TradeSort = { key: SortKey; direction: SortDirection };

export type TradeFilters = {
  search: string;
  status: TradeStatus | "ALL";
  side: TradeSide | "ALL";
  trader: string | "ALL";
  book: string | "ALL";
};

/**
 * `offline` is distinguished from `disconnected` because the user's next action
 * differs: no network on this machine versus a server we cannot reach.
 */
export type ConnectionState = "live" | "reconnecting" | "disconnected" | "offline";

/**
 * `beyond-end` is separated from `empty` because the remedy differs: nothing
 * matches the filter, versus the filter matches plenty but this page number
 * sits past the last one — reachable from a shared link whose result set has
 * since shrunk.
 */
export type TableState = "ready" | "loading" | "empty" | "beyond-end" | "error";
