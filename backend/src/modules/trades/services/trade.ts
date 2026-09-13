import { randomBytes, randomUUID } from "node:crypto";
import type { AmendTradeInput } from "../schemas/amend-trade";
import type { CreateTradeInput } from "../schemas/create-trade";
import type { ExposureInput, ListFilterOptionsInput, ListTradesInput } from "../schemas/list-trades";
import type { TradeAuditEventRecord, TradeEvent, TradeState } from "../types";
import type { TransitionTradeInput } from "../schemas/transition-trade";
import { TradeAlreadyExistsError, TradeNotFoundError } from "../errors/trade";
import type { TradeAuditRepository } from "../repositories/trade-audit";
import type {
  TradeExposure,
  TradePage,
  TradeRepository
} from "../repositories/trade";
import { decideAmend, decideCreate, decideTransition } from "./trade-lifecycle";

/** Notified after a mutation commits. Kept as a narrow port so the service does
 * not depend on the SSE transport. */
export type TradeEventPublisher = {
  publish(event: TradeEvent): void;
};

/**
 * Upper bound on one `Last-Event-ID` replay, so a client returning from a long
 * absence cannot ask the database to walk the whole audit log. Past it the
 * client is short of events the stream will not send, which is exactly the
 * situation its refetch-on-connect already covers.
 */
const MAX_REPLAY_EVENTS = 500;

/**
 * How many times a generated trade reference is retried after colliding.
 *
 * The reference is random enough that a collision is already remote; retrying
 * makes it impossible rather than merely unlikely, so a valid booking is never
 * rejected because two traders happened to draw the same suffix.
 */
const REFERENCE_ATTEMPTS = 4;

/**
 * Business rules and orchestration for trades.
 *
 * Owns the order of operations: decide, persist atomically, then publish. The
 * publication deliberately happens after the repository call returns, so a
 * rejected or rolled-back operation never produces a notification, and it
 * publishes the row that was stored rather than the one that was requested.
 */
export class TradeService {
  constructor(
    private readonly trades: TradeRepository,
    private readonly audit: TradeAuditRepository,
    private readonly events: TradeEventPublisher
  ) {}

  async list(input: ListTradesInput): Promise<TradePage> {
    return this.trades.list(input);
  }

  /**
   * Aggregates for the exposure strip and the status filter counts.
   *
   * Scoped by the same filters as the list and computed across every match, so
   * a total can never describe a different set of trades than the table.
   */
  async getExposure(input: ExposureInput): Promise<TradeExposure> {
    return this.trades.exposure(input);
  }

  async listFilterOptions(input: ListFilterOptionsInput) {
    return this.trades.listFilterOptions(input);
  }

  async getById(id: string): Promise<TradeState> {
    const trade = await this.trades.findById(id);
    if (!trade) throw new TradeNotFoundError();
    return trade;
  }

  async getAuditHistory(id: string): Promise<TradeAuditEventRecord[]> {
    // Distinguish "no history" from "no such trade".
    if (!(await this.trades.findById(id))) throw new TradeNotFoundError();
    return this.audit.listForTrade(id);
  }

  /**
   * Events committed after a point in the global stream, oldest first.
   *
   * Backs the SSE stream's reconnection replay. It reads the audit log rather
   * than any in-memory buffer, so it answers the same across every application
   * instance and survives a restart.
   */
  async listEventsSince(afterStreamSequence: string): Promise<TradeEvent[]> {
    return this.audit.listSince(afterStreamSequence, MAX_REPLAY_EVENTS);
  }

  async create(input: CreateTradeInput): Promise<TradeState> {
    return this.publishCommitted(await this.insertWithFreshReference(input));
  }

  async amend(input: AmendTradeInput): Promise<TradeState> {
    const current = await this.trades.findById(input.tradeId);
    const decision = decideAmend(current, input.changes, input.expectedVersion, input.actor);

    return this.publishCommitted(
      await this.trades.applyMutationWithAudit(input.expectedVersion, decision)
    );
  }

  async transition(input: TransitionTradeInput): Promise<TradeState> {
    const current = await this.trades.findById(input.tradeId);
    const decision = decideTransition(
      current,
      input.transition,
      input.expectedVersion,
      input.actor
    );

    return this.publishCommitted(
      await this.trades.applyMutationWithAudit(input.expectedVersion, decision)
    );
  }

  /**
   * Notify, then answer the caller with the trade that was stored.
   *
   * The event is the committed audit row, so the notification carries the same
   * identity, timestamp and `streamSequence` the log recorded — which is what
   * lets a replayed frame be the event it repeats rather than a reconstruction
   * of it.
   */
  private publishCommitted(event: TradeEvent): TradeState {
    this.events.publish(event);
    return event.trade;
  }

  /** Redraw the reference and retry if the generated one is already taken. */
  private async insertWithFreshReference(input: CreateTradeInput): Promise<TradeEvent> {
    for (let attempt = 1; ; attempt += 1) {
      const decision = decideCreate({
        id: randomUUID(),
        tradeId: nextTradeReference(),
        symbol: input.symbol,
        side: input.side,
        quantity: input.quantity,
        price: input.price,
        book: input.book,
        counterparty: input.counterparty,
        tradeTimestamp: input.tradeTimestamp,
        actor: input.actor
      });

      try {
        return await this.trades.insertWithAudit(decision);
      } catch (error) {
        const exhausted = attempt >= REFERENCE_ATTEMPTS;
        if (exhausted || !(error instanceof TradeAlreadyExistsError)) throw error;
      }
    }
  }
}

/**
 * Human-readable but collision-free. A timestamp alone repeats whenever two
 * trades are booked in the same millisecond, which would reject valid trades
 * under concurrent booking; the random suffix removes that, and the caller
 * retries on the remaining chance of a clash.
 */
function nextTradeReference(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  return `TRD-${stamp}-${randomBytes(3).toString("hex").toUpperCase()}`;
}
