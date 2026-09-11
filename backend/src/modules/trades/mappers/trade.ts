import type {
  Prisma,
  Trade as TradeRow,
  TradeAuditEventType as PrismaAuditEventType,
  TradeSide as PrismaTradeSide,
  TradeStatus as PrismaTradeStatus
} from "@prisma/client";
import type {
  TradeAuditEventType,
  TradeMutation,
  TradeSide,
  TradeState,
  TradeStatus
} from "../types";

/**
 * Translation between Prisma rows and the module's own trade representation.
 *
 * Keeps persistence types — `Decimal`, `Date` — out of everything above the
 * repository without introducing an abstraction layer.
 */

/**
 * The module defines its enums independently of Prisma so nothing above the
 * repository imports the database client. These assertions make that
 * independence safe: adding a value to either side without the other stops
 * compiling here, which is the one place that knows about both.
 */
type Covers<Subset, Superset> = [Subset] extends [Superset] ? true : false;
type AssertTrue<T extends true> = T;

type _SidesMatch = AssertTrue<Covers<TradeSide, PrismaTradeSide>> &
  AssertTrue<Covers<PrismaTradeSide, TradeSide>>;
type _StatusesMatch = AssertTrue<Covers<TradeStatus, PrismaTradeStatus>> &
  AssertTrue<Covers<PrismaTradeStatus, TradeStatus>>;
type _AuditTypesMatch = AssertTrue<Covers<TradeAuditEventType, PrismaAuditEventType>> &
  AssertTrue<Covers<PrismaAuditEventType, TradeAuditEventType>>;

export function toTradeState(row: TradeRow): TradeState {
  return {
    id: row.id,
    tradeId: row.tradeId,
    symbol: row.symbol,
    side: row.side,
    quantity: row.quantity,
    price: row.price.toNumber(),
    traderUserId: row.traderUserId,
    trader: row.trader,
    book: row.book,
    counterparty: row.counterparty,
    tradeTimestamp: row.tradeTimestamp.toISOString(),
    status: row.status,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

/**
 * Columns an amendment or transition may rewrite.
 *
 * `updatedAt` is absent so Prisma's `@updatedAt` sets it from the database
 * clock, and the identity columns (`id`, `tradeId`, `traderUserId`, `trader`)
 * are absent because a trade's identity and booking trader are fixed at
 * creation — leaving them out means no mutation path can rewrite them.
 */
export function toTradeUpdateData(trade: TradeMutation): Prisma.TradeUncheckedUpdateInput {
  return {
    symbol: trade.symbol,
    side: trade.side,
    quantity: trade.quantity,
    price: trade.price,
    book: trade.book,
    counterparty: trade.counterparty,
    tradeTimestamp: new Date(trade.tradeTimestamp),
    status: trade.status,
    version: trade.version
  };
}

/** Creation additionally sets the identity columns, once. */
export function toTradeCreateData(trade: TradeMutation): Prisma.TradeUncheckedCreateInput {
  return {
    id: trade.id,
    tradeId: trade.tradeId,
    symbol: trade.symbol,
    side: trade.side,
    quantity: trade.quantity,
    price: trade.price,
    traderUserId: trade.traderUserId,
    trader: trade.trader,
    book: trade.book,
    counterparty: trade.counterparty,
    tradeTimestamp: new Date(trade.tradeTimestamp),
    status: trade.status,
    version: trade.version
  };
}

/** Audit snapshots are stored as JSON columns. */
export function toJsonSnapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
