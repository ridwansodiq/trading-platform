import { z } from "zod";
import type { TradeActor } from "../types";

export const transitionTradeSchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .meta({ id: "TransitionTradeRequest" });

export type TransitionTradeBody = z.infer<typeof transitionTradeSchema>;

export type TradeTransition = "EXECUTE" | "CANCEL";

export type TransitionTradeInput = {
  tradeId: string;
  transition: TradeTransition;
  expectedVersion: number;
  actor: TradeActor;
};
