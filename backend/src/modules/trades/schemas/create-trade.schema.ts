import { z } from "zod";
import { priceSchema, quantitySchema, tradeSideSchema } from "./trade-response.schema.js";

/** `trader` is absent by design — it comes from the authenticated session. */
export const createTradeSchema = z
  .object({
    symbol: z.string().min(1).max(12),
    side: tradeSideSchema,
    quantity: quantitySchema,
    price: priceSchema,
    book: z.string().min(1).max(40),
    counterparty: z.string().min(1).max(80),
    tradeTimestamp: z.string().datetime()
  })
  .meta({ id: "CreateTradeCommand" });

export type CreateTradeBody = z.infer<typeof createTradeSchema>;
