import type { z } from "zod";
import type {
  exposureQuerySchema,
  filterOptionsQuerySchema,
  listTradesQuerySchema,
  tradeFilterFieldSchema,
  tradeSortKeySchema
} from "../schemas/list-trades.schema.js";

/**
 * A query carries no server-derived values, so what the service receives *is*
 * the validated querystring. Inferring the type keeps one definition instead of
 * a hand-written union that has to be remembered whenever a sort key or filter
 * is added.
 */
export type TradeSortKey = z.infer<typeof tradeSortKeySchema>;
export type TradeFilterField = z.infer<typeof tradeFilterFieldSchema>;
export type ListTradesDto = z.infer<typeof listTradesQuerySchema>;
export type ExposureDto = z.infer<typeof exposureQuerySchema>;
export type ListFilterOptionsDto = z.infer<typeof filterOptionsQuerySchema>;
