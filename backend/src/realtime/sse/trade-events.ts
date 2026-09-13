import type { TradeEvent, TradeEventPublisher } from "../../modules/trades/index";
import type { SseBroker } from "./sse-broker";

export const TRADE_UPDATE_EVENT = "trade-update";

/**
 * Publishes committed trade mutations over SSE.
 *
 * The trade service calls this only after its transaction commits, so a
 * rejected or rolled-back operation can never produce a notification. The
 * dependency runs service -> publisher and never back.
 *
 * The frame is identified by `streamSequence`, the audit event's place in the
 * global stream. That is what a browser echoes back in `Last-Event-ID` after a
 * drop, so the id on the wire has to be the same value the replay query orders
 * by — anything generated here would be a cursor pointing at nothing.
 */
export function createTradeEventPublisher(broker: SseBroker): TradeEventPublisher {
  return {
    publish(event: TradeEvent) {
      broker.broadcast(TRADE_UPDATE_EVENT, event, event.streamSequence);
    }
  };
}
