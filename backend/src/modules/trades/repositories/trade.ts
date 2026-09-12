import { Prisma, type PrismaClient, type Trade as TradeRow } from "@prisma/client";
import type { Page } from "../../../infrastructure/http/pagination";
import type {
  ExposureDto,
  ListFilterOptionsDto,
  ListTradesDto,
  TradeFilterField,
  TradeSortKey
} from "../schemas/list-trades";
import type { MutationDecision, TradeEvent, TradeState } from "../types";
import {
  InvalidTradeTransitionError,
  TradeAlreadyExistsError,
  TradeNotFoundError,
  VersionConflictError
} from "../errors/trade";
import { toTradeCreateData, toTradeState, toTradeUpdateData } from "../mappers/trade";
import type { TradeAuditRepository } from "./trade-audit";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

/** One page of trades: the envelope is shared, only the item type is ours. */
export type TradePage = Page<TradeState>;

export type TradeExposure = {
  tradesInScope: number;
  statusCounts: { NEW: number; EXECUTED: number; CANCELLED: number };
  buyNotional: string;
  sellNotional: string;
  netNotional: string;
};

/**
 * `ORDER BY` fragments, keyed by the sort keys the schema accepts.
 *
 * A whitelist rather than interpolation: the sort key reaches SQL as an
 * identifier, which no parameter placeholder can carry. The three derived keys
 * are expressions over stored columns, so they order the whole result set
 * instead of only the page the client happens to have loaded.
 */
const SORT_EXPRESSIONS: Record<TradeSortKey, Prisma.Sql> = {
  tradeId: Prisma.sql`"tradeId"`,
  symbol: Prisma.sql`"symbol"`,
  side: Prisma.sql`"side"`,
  quantity: Prisma.sql`"quantity"`,
  price: Prisma.sql`"price"`,
  trader: Prisma.sql`"trader"`,
  book: Prisma.sql`"book"`,
  counterparty: Prisma.sql`"counterparty"`,
  tradeTimestamp: Prisma.sql`"tradeTimestamp"`,
  status: Prisma.sql`"status"`,
  version: Prisma.sql`"version"`,
  notional: Prisma.sql`("quantity" * "price")`,
  signedQuantity: Prisma.sql`(CASE WHEN "side" = 'BUY' THEN "quantity" ELSE -"quantity" END)`,
  signedNotional: Prisma.sql`(CASE WHEN "side" = 'BUY' THEN "quantity" * "price" ELSE -("quantity" * "price") END)`
};

/** The columns of `Trade`, in one place, so raw selects stay in step with the model. */
const TRADE_COLUMNS = Prisma.sql`
  "id", "tradeId", "symbol", "side", "quantity", "price", "traderUserId", "trader",
  "book", "counterparty", "tradeTimestamp", "status", "version", "createdAt", "updatedAt"
`;

/**
 * `$queryRaw` maps PostgreSQL types to the same JavaScript types Prisma's model
 * client uses — `numeric` to `Decimal`, `timestamp` to `Date`, enums to their
 * string union — so a row selected by the column list above is a `TradeRow`.
 */
type RawTradeRow = TradeRow & { totalCount: number };

type RawExposureRow = {
  tradesInScope: number;
  newCount: number;
  executedCount: number;
  cancelledCount: number;
  buyNotional: string;
  sellNotional: string;
  netNotional: string;
};

/**
 * All PostgreSQL access for trades.
 *
 * The mutation methods are deliberately use-case-specific rather than a set of
 * primitives: keeping the conditional versioned update and the audit insert
 * inside one method means a caller cannot accidentally perform one without the
 * other, which is what makes the audit trail trustworthy.
 */
export class TradeRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: TradeAuditRepository
  ) {}

  /**
   * One statement, so `total` and `data` are read from a single snapshot.
   *
   * Running the page and its count as two queries — even inside a transaction —
   * lets them disagree under the default READ COMMITTED isolation, which shows
   * up as a footer that contradicts the rows above it.
   */
  async list(filters: ListTradesDto): Promise<TradePage> {
    const order = SORT_EXPRESSIONS[filters.sortBy];
    const direction = filters.sortDirection === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const offset = (filters.page - 1) * filters.pageSize;

    const rows = await this.prisma.$queryRaw<RawTradeRow[]>`
      SELECT ${TRADE_COLUMNS}, COUNT(*) OVER()::int AS "totalCount"
      FROM "Trade"
      ${this.whereClause(filters)}
      -- A stable tiebreak keeps pagination deterministic on equal sort keys.
      ORDER BY ${order} ${direction}, "tradeId" ASC
      LIMIT ${filters.pageSize} OFFSET ${offset}
    `;

    return {
      data: rows.map(toTradeState),
      page: filters.page,
      pageSize: filters.pageSize,
      // An empty page reports no rows, so the window function gives nothing.
      total: rows[0]?.totalCount ?? (await this.count(filters))
    };
  }

  /**
   * Aggregates across every matching trade, not just the current page.
   *
   * Notionals come back as text: `SUM(quantity * price)` can exceed the range a
   * JSON number holds exactly, and an exposure total is the last figure on the
   * screen that should be approximate.
   */
  async exposure(filters: ExposureDto): Promise<TradeExposure> {
    const buy = Prisma.sql`COALESCE(SUM("quantity" * "price") FILTER (WHERE "side" = 'BUY'), 0)`;
    const sell = Prisma.sql`COALESCE(SUM("quantity" * "price") FILTER (WHERE "side" = 'SELL'), 0)`;

    const [row] = await this.prisma.$queryRaw<RawExposureRow[]>`
      SELECT
        COUNT(*)::int AS "tradesInScope",
        COUNT(*) FILTER (WHERE "status" = 'NEW')::int AS "newCount",
        COUNT(*) FILTER (WHERE "status" = 'EXECUTED')::int AS "executedCount",
        COUNT(*) FILTER (WHERE "status" = 'CANCELLED')::int AS "cancelledCount",
        ${buy}::text AS "buyNotional",
        ${sell}::text AS "sellNotional",
        (${buy} - ${sell})::text AS "netNotional"
      FROM "Trade"
      ${this.whereClause(filters)}
    `;

    return {
      tradesInScope: row?.tradesInScope ?? 0,
      statusCounts: {
        NEW: row?.newCount ?? 0,
        EXECUTED: row?.executedCount ?? 0,
        CANCELLED: row?.cancelledCount ?? 0
      },
      buyNotional: row?.buyNotional ?? "0",
      sellNotional: row?.sellNotional ?? "0",
      netNotional: row?.netNotional ?? "0"
    };
  }

  async findById(id: string): Promise<TradeState | null> {
    const row = await this.prisma.trade.findUnique({ where: { id } });
    return row ? toTradeState(row) : null;
  }

  /**
   * Distinct values for one filterable column, searched and capped in the
   * database. The blotter cannot derive these from the current page, and cannot
   * load every value once there are thousands, so this runs as a `GROUP BY`.
   */
  async listFilterOptions(
    input: ListFilterOptionsDto
  ): Promise<{ values: string[]; hasMore: boolean }> {
    const match = input.search?.trim()
      ? { contains: input.search.trim(), mode: "insensitive" as const }
      : undefined;
    // One extra row tells us whether the list was truncated.
    const take = input.limit + 1;

    /*
     * One closure per column rather than an indexed lookup, so Prisma's
     * generated types still check the column name and the projection. The
     * dispatch table keeps that type safety without repeating the query.
     */
    const groupers: Record<TradeFilterField, () => Promise<string[]>> = {
      trader: async () =>
        (
          await this.prisma.trade.groupBy({
            by: ["trader"],
            ...(match ? { where: { trader: match } } : {}),
            orderBy: { trader: "asc" },
            take
          })
        ).map((row) => row.trader),
      book: async () =>
        (
          await this.prisma.trade.groupBy({
            by: ["book"],
            ...(match ? { where: { book: match } } : {}),
            orderBy: { book: "asc" },
            take
          })
        ).map((row) => row.book),
      counterparty: async () =>
        (
          await this.prisma.trade.groupBy({
            by: ["counterparty"],
            ...(match ? { where: { counterparty: match } } : {}),
            orderBy: { counterparty: "asc" },
            take
          })
        ).map((row) => row.counterparty)
    };

    const values = await groupers[input.field]();
    return { values: values.slice(0, input.limit), hasMore: values.length > input.limit };
  }

  /**
   * Insert the trade and its `CREATED` audit event in one transaction.
   *
   * Returns the committed audit event, which carries the row PostgreSQL stored
   * rather than the state we asked it to store: `price` is `numeric(18,4)` and
   * the timestamps are database-owned, so the two are not always the same
   * value. The audit snapshot is taken from the same row, so the log can only
   * ever describe what was actually written.
   */
  async insertWithAudit(decision: MutationDecision): Promise<TradeEvent> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.trade.create({ data: toTradeCreateData(decision.nextTrade) });
        const stored = toTradeState(row);
        return this.audit.insert(tx, {
          ...decision.audit,
          tradeId: stored.id,
          tradeVersion: stored.version,
          after: stored
        });
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new TradeAlreadyExistsError();
      }
      throw error;
    }
  }

  /**
   * Apply a decided mutation with compare-and-swap semantics.
   *
   * The update is conditional on `id`, `expectedVersion` and `status = NEW`, so
   * a command that raced another one matches no row and the whole transaction
   * rolls back. An in-memory version check alone cannot close that window.
   */
  async applyMutationWithAudit(
    expectedVersion: number,
    decision: MutationDecision
  ): Promise<TradeEvent> {
    const id = decision.nextTrade.id;

    return this.prisma.$transaction(async (tx) => {
      const update = await tx.trade.updateMany({
        where: { id, version: expectedVersion, status: "NEW" },
        data: toTradeUpdateData(decision.nextTrade)
      });

      if (update.count !== 1) {
        /*
         * The condition covers three distinct situations and the count alone
         * cannot tell them apart. Reading the row inside the same transaction
         * reports the real one, so a race no longer returns 409 where a
         * sequential request would have returned 404 or 422.
         */
        const current = await tx.trade.findUnique({ where: { id } });
        if (!current) throw new TradeNotFoundError();
        if (current.status !== "NEW") throw new InvalidTradeTransitionError(current.status);
        throw new VersionConflictError(expectedVersion, toTradeState(current));
      }

      // `updateMany` reports a count, not a row, so read back what it wrote.
      const stored = toTradeState(await tx.trade.findUniqueOrThrow({ where: { id } }));
      return this.audit.insert(tx, {
        ...decision.audit,
        tradeId: stored.id,
        tradeVersion: stored.version,
        after: stored
      });
    });
  }

  /** Fallback for a page beyond the end of the result set. */
  private async count(filters: ExposureDto): Promise<number> {
    const [row] = await this.prisma.$queryRaw<[{ total: number }]>`
      SELECT COUNT(*)::int AS "total" FROM "Trade" ${this.whereClause(filters)}
    `;
    return row?.total ?? 0;
  }

  /**
   * The filter half of every trade query, built once so the table, its total
   * and its aggregates can never describe different scopes.
   *
   * The free-text search is a case-insensitive substring match across the five
   * columns a trader would search by; trigram indexes make that usable at
   * volume rather than a full scan per keystroke.
   */
  private whereClause(filters: ExposureDto): Prisma.Sql {
    const conditions: Prisma.Sql[] = [];

    if (filters.status) {
      conditions.push(Prisma.sql`"status" = ${filters.status}::"TradeStatus"`);
    }
    if (filters.side) {
      conditions.push(Prisma.sql`"side" = ${filters.side}::"TradeSide"`);
    }
    if (filters.trader) conditions.push(Prisma.sql`"trader" = ${filters.trader}`);
    if (filters.book) conditions.push(Prisma.sql`"book" = ${filters.book}`);

    const search = filters.search?.trim();
    if (search) {
      const pattern = `%${escapeLikeWildcards(search)}%`;
      conditions.push(Prisma.sql`(
        "tradeId" ILIKE ${pattern}
        OR "symbol" ILIKE ${pattern}
        OR "trader" ILIKE ${pattern}
        OR "book" ILIKE ${pattern}
        OR "counterparty" ILIKE ${pattern}
      )`);
    }

    if (conditions.length === 0) return Prisma.empty;
    return Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
  }
}

/**
 * A user typing `%` or `_` means those characters literally, not as wildcards.
 * Without this, `_` matches any character and `%` matches everything.
 */
function escapeLikeWildcards(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
