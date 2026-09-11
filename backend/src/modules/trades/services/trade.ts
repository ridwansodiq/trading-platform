import { randomBytes, randomUUID } from "node:crypto";
import type { AmendTradeDto } from "../schemas/amend-trade";
import type { CreateTradeDto } from "../schemas/create-trade";
import type { ExposureDto, ListFilterOptionsDto, ListTradesDto } from "../schemas/list-trades";
import type { TradeAuditEventRecord, TradeState } from "../types";
import type { TransitionTradeDto } from "../schemas/transition-trade";
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
  publish(eventType: TradeState["status"] | "AMENDED" | "CREATED", trade: TradeState): void;
};

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
 * rejected or rolled-back command never produces a notification, and it
 * publishes the row that was stored rather than the one that was requested.
 */
export class TradeService {
  constructor(
    private readonly trades: TradeRepository,
    private readonly audit: TradeAuditRepository,
    private readonly events: TradeEventPublisher
  ) {}

  async list(input: ListTradesDto): Promise<TradePage> {
    return this.trades.list(input);
  }

  /**
   * Aggregates for the exposure strip and the status filter counts.
   *
   * Scoped by the same filters as the list and computed across every match, so
   * a total can never describe a different set of trades than the table.
   */
  async getExposure(input: ExposureDto): Promise<TradeExposure> {
    return this.trades.exposure(input);
  }

  async listFilterOptions(input: ListFilterOptionsDto) {
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

  async create(input: CreateTradeDto): Promise<TradeState> {
    const trade = await this.insertWithFreshReference(input);
    this.events.publish("CREATED", trade);
    return trade;
  }

  async amend(input: AmendTradeDto): Promise<TradeState> {
    const current = await this.trades.findById(input.tradeId);
    const decision = decideAmend(current, input.changes, input.expectedVersion, input.actor);

    const trade = await this.trades.applyMutationWithAudit(input.expectedVersion, decision);
    this.events.publish("AMENDED", trade);
    return trade;
  }

  async transition(input: TransitionTradeDto): Promise<TradeState> {
    const current = await this.trades.findById(input.tradeId);
    const decision = decideTransition(
      current,
      input.transition,
      input.expectedVersion,
      input.actor
    );

    const trade = await this.trades.applyMutationWithAudit(input.expectedVersion, decision);
    this.events.publish(decision.audit.eventType, trade);
    return trade;
  }

  /** Redraw the reference and retry if the generated one is already taken. */
  private async insertWithFreshReference(input: CreateTradeDto): Promise<TradeState> {
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
