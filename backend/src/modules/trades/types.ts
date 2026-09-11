/**
 * The trade vocabulary, defined once.
 *
 * These const arrays are the single source for the module's enums: the Zod
 * schemas build their `z.enum` from them, and `mappers/trade.ts` asserts
 * at compile time that they still match Prisma's generated enums, so the API
 * contract and the database can never disagree about a value silently.
 */

export const TRADE_SIDES = ["BUY", "SELL"] as const;
export const TRADE_STATUSES = ["NEW", "EXECUTED", "CANCELLED"] as const;
export const TRADE_AUDIT_EVENT_TYPES = ["CREATED", "AMENDED", "EXECUTED", "CANCELLED"] as const;

export type TradeSide = (typeof TRADE_SIDES)[number];
export type TradeStatus = (typeof TRADE_STATUSES)[number];
export type TradeAuditEventType = (typeof TRADE_AUDIT_EVENT_TYPES)[number];

/**
 * The authenticated actor, passed in as a plain value. The trades module never
 * imports the auth module, so business rules stay independent of how sessions
 * are implemented.
 */
export type TradeActor = {
  id: string;
  displayName: string;
};

/** The module's internal trade representation, shared by service and repository. */
export type TradeState = {
  id: string;
  tradeId: string;
  symbol: string;
  side: TradeSide;
  quantity: number;
  price: number;
  traderUserId: string;
  trader: string;
  book: string;
  counterparty: string;
  tradeTimestamp: string;
  status: TradeStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * The state a command intends to write.
 *
 * `createdAt` and `updatedAt` are absent deliberately: they belong to the
 * database, which owns the clock. Passing our own values for them is what let
 * the API return timestamps that were never stored.
 */
export type TradeMutation = Omit<TradeState, "createdAt" | "updatedAt">;

/**
 * Everything about an audit event that is known *before* the write.
 *
 * The resulting version and the `after` snapshot are missing on purpose — the
 * repository fills them in from the row PostgreSQL actually stored, so the
 * audit log can never describe a state that was not persisted.
 */
export type TradeAuditEventIntent = {
  eventType: TradeAuditEventType;
  actorUserId: string;
  actorDisplayName: string;
  before: TradeState | null;
};

/** What the lifecycle rules decide: the intended state plus its audit intent. */
export type MutationDecision = {
  nextTrade: TradeMutation;
  audit: TradeAuditEventIntent;
};

/** The complete audit row, composed once the write has returned. */
export type TradeAuditEventDraft = TradeAuditEventIntent & {
  tradeId: string;
  tradeVersion: number;
  after: TradeState;
};

export type TradeAuditEventRecord = Omit<TradeAuditEventDraft, "tradeId"> & {
  id: string;
  createdAt: string;
};
