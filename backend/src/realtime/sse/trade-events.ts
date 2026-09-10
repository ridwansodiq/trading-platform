import { randomUUID } from "node:crypto";
import type { TradeEventPublisher, TradeState } from "../../modules/trades/index.js";
import type { SseBroker } from "./sse-broker.js";

export const TRADE_UPDATE_EVENT = "trade-update";

/**
 * Publishes committed trade mutations over SSE.
 *
 * The trade service calls this only after its transaction commits, so a
 * rejected or rolled-back command can never produce a notification. The
 * dependency runs service -> publisher and never back.
 */
export function createTradeEventPublisher(broker: SseBroker): TradeEventPublisher {
  return {
    publish(eventType, trade: TradeState) {
      broker.broadcast(
        TRADE_UPDATE_EVENT,
        { id: randomUUID(), eventType, trade, occurredAt: new Date().toISOString() },
        randomUUID()
      );
    }
  };
}
