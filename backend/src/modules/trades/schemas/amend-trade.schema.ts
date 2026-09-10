import { z } from "zod";
import { createTradeSchema } from "./create-trade.schema.js";

export const amendTradeSchema = createTradeSchema
  .partial()
  .extend({ expectedVersion: z.number().int().positive() })
  .meta({ id: "AmendTradeCommand" });

export type AmendTradeBody = z.infer<typeof amendTradeSchema>;
