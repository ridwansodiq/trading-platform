import type { z } from "zod";
import type { createTradeSchema } from "../schemas/create-trade.schema.js";
import type { TradeActor } from "./trade.dto.js";

/**
 * The validated command plus the one thing the client is never allowed to
 * supply: who is booking the trade.
 */
export type CreateTradeDto = z.infer<typeof createTradeSchema> & {
  actor: TradeActor;
};
