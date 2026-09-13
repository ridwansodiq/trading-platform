import type {
  MutationDecision,
  TradeActor,
  TradeAuditEventIntent,
  TradeAuditEventType,
  TradeMutation,
  TradeState
} from "../types";
import type { AmendableTradeFields } from "../schemas/amend-trade";
import {
  InvalidTradeError,
  InvalidTradeTransitionError,
  TradeNotFoundError,
  VersionConflictError
} from "../errors/trade";

/**
 * The trade lifecycle rules, as pure functions.
 *
 * A private helper of the service layer rather than a layer of its own: it has
 * no knowledge of HTTP, Prisma, or configuration, which makes it the cheapest
 * and most direct place to test create/amend/execute/cancel behaviour.
 */

export type CreateDecisionInput = {
  id: string;
  tradeId: string;
  symbol: string;
  side: TradeState["side"];
  quantity: number;
  price: number;
  book: string;
  counterparty: string;
  tradeTimestamp: string;
  actor: TradeActor;
};

function assertValid(trade: TradeMutation): void {
  if (!trade.symbol.trim()) throw new InvalidTradeError("Symbol is required.");
  if (!Number.isInteger(trade.quantity) || trade.quantity <= 0) {
    throw new InvalidTradeError("Quantity must be a positive integer.");
  }
  if (!Number.isFinite(trade.price) || trade.price <= 0) {
    throw new InvalidTradeError("Price must be positive.");
  }
  if (!trade.book.trim() || !trade.counterparty.trim()) {
    throw new InvalidTradeError("Book and counterparty are required.");
  }
  if (Number.isNaN(Date.parse(trade.tradeTimestamp))) {
    throw new InvalidTradeError("Trade timestamp must be valid.");
  }
}

function audit(
  eventType: TradeAuditEventType,
  actor: TradeActor,
  before: TradeState | null
): TradeAuditEventIntent {
  return {
    eventType,
    actorUserId: actor.id,
    actorDisplayName: actor.displayName,
    before
  };
}

/** A trade always starts at version 1 in `NEW`, with the actor as its trader. */
export function decideCreate(input: CreateDecisionInput): MutationDecision {
  const nextTrade: TradeMutation = {
    id: input.id,
    tradeId: input.tradeId,
    symbol: input.symbol.trim().toUpperCase(),
    side: input.side,
    quantity: input.quantity,
    price: input.price,
    traderUserId: input.actor.id,
    trader: input.actor.displayName,
    book: input.book.trim(),
    counterparty: input.counterparty.trim(),
    tradeTimestamp: input.tradeTimestamp,
    status: "NEW",
    version: 1
  };
  assertValid(nextTrade);
  return { nextTrade, audit: audit("CREATED", input.actor, null) };
}

/**
 * Guards shared by every non-create operation: the trade must exist, must still
 * be working, and the caller must hold the current version.
 *
 * Order matters. A terminal trade is checked before the version because it
 * cannot be amended at *any* version — reporting a conflict there would invite
 * the client to retry with the current version, which would fail identically.
 * It is also the order the repository uses when its compare-and-swap matches no
 * row, so an operation rejected in memory and one that loses a race report the
 * same reason.
 *
 * The conflict carries the trade it read, so the caller sees what changed
 * without a second lookup.
 */
function assertMutable(current: TradeState | null, expectedVersion: number): TradeState {
  if (!current) throw new TradeNotFoundError();
  if (current.status !== "NEW") throw new InvalidTradeTransitionError(current.status);
  if (current.version !== expectedVersion) {
    throw new VersionConflictError(expectedVersion, current);
  }
  return current;
}

/** An amendment changes economics but leaves the trade `NEW`. */
export function decideAmend(
  current: TradeState | null,
  changes: AmendableTradeFields,
  expectedVersion: number,
  actor: TradeActor
): MutationDecision {
  const trade = assertMutable(current, expectedVersion);
  const nextTrade: TradeMutation = {
    ...toMutation(trade),
    ...changes,
    symbol: changes.symbol?.trim().toUpperCase() ?? trade.symbol,
    book: changes.book?.trim() ?? trade.book,
    counterparty: changes.counterparty?.trim() ?? trade.counterparty,
    version: trade.version + 1
  };
  assertValid(nextTrade);
  return { nextTrade, audit: audit("AMENDED", actor, trade) };
}

/** Execute and cancel are terminal, and share everything but the target status. */
export function decideTransition(
  current: TradeState | null,
  transition: "EXECUTE" | "CANCEL",
  expectedVersion: number,
  actor: TradeActor
): MutationDecision {
  const trade = assertMutable(current, expectedVersion);
  const status = transition === "EXECUTE" ? "EXECUTED" : "CANCELLED";
  const nextTrade: TradeMutation = {
    ...toMutation(trade),
    status,
    version: trade.version + 1
  };
  return { nextTrade, audit: audit(status, actor, trade) };
}

/** Drop the database-owned timestamps from a state we are about to rewrite. */
function toMutation(trade: TradeState): TradeMutation {
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...mutation } = trade;
  return mutation;
}
