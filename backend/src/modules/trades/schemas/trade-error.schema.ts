import { z } from "zod";
import { apiErrorSchema } from "../../../infrastructure/errors/error.schema.js";
import { tradeSchema } from "./trade-response.schema.js";

/**
 * Trade errors extend the shared envelope with concurrency context, so a `409`
 * gives the client everything it needs to show a diff without a second request.
 */
export const tradeErrorSchema = apiErrorSchema
  .extend({
    expectedVersion: z.number().int().positive().optional(),
    currentVersion: z.number().int().positive().optional(),
    currentTrade: tradeSchema.optional()
  })
  .meta({ id: "TradeError" });
