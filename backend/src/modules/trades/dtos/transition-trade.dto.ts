import type { TradeActor } from "./trade.dto.js";

export type TradeTransition = "EXECUTE" | "CANCEL";

export type TransitionTradeDto = {
  tradeId: string;
  transition: TradeTransition;
  expectedVersion: number;
  actor: TradeActor;
};
