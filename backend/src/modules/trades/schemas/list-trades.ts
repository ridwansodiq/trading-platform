import { z } from "zod";
import { tradeSideSchema, tradeStatusSchema } from "./trade-response";

/** Sort keys backed by a column, applied directly in `ORDER BY`. */
export const STORED_SORT_KEYS = [
  "tradeId",
  "symbol",
  "side",
  "quantity",
  "price",
  "trader",
  "book",
  "counterparty",
  "tradeTimestamp",
  "status",
  "version"
] as const;

/**
 * Sort keys computed from `quantity`, `price` and `side`.
 *
 * These are not stored, but PostgreSQL can still order by the expression, so
 * they sort across the whole result set rather than only the loaded page. An
 * expression index backs `quantity * price`.
 */
export const DERIVED_SORT_KEYS = ["notional", "signedQuantity", "signedNotional"] as const;

export const TRADE_SORT_KEYS = [...STORED_SORT_KEYS, ...DERIVED_SORT_KEYS] as const;

export const tradeSortKeySchema = z.enum(TRADE_SORT_KEYS).meta({ id: "TradeSortKey" });

export const sortDirectionSchema = z.enum(["asc", "desc"]).meta({ id: "SortDirection" });

/**
 * The filter half of a trade query, shared by the list and its aggregates so
 * the exposure strip can never describe a different scope than the table.
 */
export const tradeFilterSchema = z.object({
  search: z.string().max(200).optional(),
  status: tradeStatusSchema.optional(),
  side: tradeSideSchema.optional(),
  trader: z.string().max(120).optional(),
  book: z.string().max(40).optional()
});

export const listTradesQuerySchema = tradeFilterSchema.extend({
  sortBy: tradeSortKeySchema.default("tradeTimestamp"),
  sortDirection: sortDirectionSchema.default("desc"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50)
});

export const exposureQuerySchema = tradeFilterSchema;

/**
 * High-cardinality filters are searched server-side. Restricted to an enum
 * because the value selects a database column to group by.
 */
export const tradeFilterFieldSchema = z
  .enum(["trader", "book", "counterparty"])
  .meta({ id: "TradeFilterField" });

export const filterOptionsQuerySchema = z.object({
  field: tradeFilterFieldSchema,
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const tradeFilterOptionsSchema = z
  .object({
    values: z.array(z.string()),
    /** True when the result was capped, so the UI can ask for a narrower search. */
    hasMore: z.boolean()
  })
  .meta({ id: "TradeFilterOptions" });

/**
 * A query carries no server-derived values, so what the service receives *is*
 * the validated querystring. Inferring the type keeps one definition instead of
 * a hand-written union that has to be remembered whenever a sort key or filter
 * is added.
 */
export type TradeSortKey = z.infer<typeof tradeSortKeySchema>;
export type TradeFilterField = z.infer<typeof tradeFilterFieldSchema>;
export type ListTradesInput = z.infer<typeof listTradesQuerySchema>;
export type ExposureInput = z.infer<typeof exposureQuerySchema>;
export type ListFilterOptionsInput = z.infer<typeof filterOptionsQuerySchema>;
