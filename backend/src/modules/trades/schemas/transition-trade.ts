import { z } from "zod";
import type { TradeActor } from "../types";

export const transitionTradeSchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .meta({ id: "TransitionTradeCommand" });

export type TransitionTradeBody = z.infer<typeof transitionTradeSchema>;

export type TradeTransition = "EXECUTE" | "CANCEL";

export type TransitionTradeDto = {
  tradeId: string;
  transition: TradeTransition;
  expectedVersion: number;
  actor: TradeActor;
};
