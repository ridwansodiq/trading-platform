import { z } from "zod";
import {
  TRADE_AUDIT_EVENT_TYPES,
  TRADE_SIDES,
  TRADE_STATUSES
} from "../dtos/trade.dto.js";

/**
 * Response shapes for the trades module, and the reusable OpenAPI components
 * the generated frontend client is built from.
 *
 * `.meta({ id })` registers a schema as a component, so the document references
 * one definition instead of inlining a copy per operation and status code.
 */

export const tradeStatusSchema = z.enum(TRADE_STATUSES).meta({ id: "TradeStatus" });
export const tradeSideSchema = z.enum(TRADE_SIDES).meta({ id: "TradeSide" });
export const tradeAuditEventTypeSchema = z
  .enum(TRADE_AUDIT_EVENT_TYPES)
  .meta({ id: "TradeAuditEventType" });

/**
 * `price` is stored as `numeric(18,4)`.
 *
 * Both bounds below exist to stop the database silently changing a value we
 * accepted: without the scale check, `72.256789` is echoed back to the client
 * and written to the audit snapshot while PostgreSQL rounds the stored row to
 * `72.2568`. The magnitude cap keeps a price inside the range a JSON number
 * round-trips exactly (a 4dp value with at most 10 integer digits is 14
 * significant digits, well within a double's 15).
 */
export const MAX_PRICE = 1_000_000_000;
export const PRICE_SCALE = 4;

/** Bounded so `quantity * price` cannot overflow `numeric(28,4)`. */
export const MAX_QUANTITY = 1_000_000_000;

/** Counts the decimal places of a JSON-sourced number, exponent form included. */
export function decimalPlaces(value: number): number {
  const text = value.toString();
  const [base, exponent] = text.split(/[eE]/);
  const fraction = base?.split(".")[1]?.length ?? 0;
  return Math.max(0, fraction - Number(exponent ?? 0));
}

export const priceSchema = z
  .number()
  .positive()
  .max(MAX_PRICE)
  .refine((value) => decimalPlaces(value) <= PRICE_SCALE, {
    message: `Price supports at most ${PRICE_SCALE} decimal places.`
  });

export const quantitySchema = z.number().int().positive().max(MAX_QUANTITY);

export const tradeSchema = z
  .object({
    id: z.string().uuid(),
    tradeId: z.string(),
    symbol: z.string(),
    side: tradeSideSchema,
    quantity: quantitySchema,
    price: priceSchema,
    traderUserId: z.string().uuid(),
    trader: z.string(),
    book: z.string(),
    counterparty: z.string(),
    tradeTimestamp: z.string().datetime(),
    status: tradeStatusSchema,
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .meta({ id: "Trade" });

export const tradePageSchema = z
  .object({
    data: z.array(tradeSchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative()
  })
  .meta({ id: "TradePage" });

/**
 * Aggregates over every trade matching the filter, not just the current page.
 *
 * Notionals are decimal strings: a sum of `quantity * price` can exceed the
 * range a JSON number represents exactly, and an exposure figure that is
 * approximately right is worse than useless on a trading screen.
 */
export const tradeExposureSchema = z
  .object({
    tradesInScope: z.number().int().nonnegative(),
    statusCounts: z
      .object({
        NEW: z.number().int().nonnegative(),
        EXECUTED: z.number().int().nonnegative(),
        CANCELLED: z.number().int().nonnegative()
      })
      .meta({ id: "TradeStatusCounts" }),
    buyNotional: z.string(),
    sellNotional: z.string(),
    netNotional: z.string()
  })
  .meta({ id: "TradeExposure" });

/**
 * `before` and `after` are typed as full trades rather than `unknown`, so the
 * frontend can render a field-level diff instead of a JSON blob.
 */
export const tradeAuditEventSchema = z
  .object({
    id: z.string().uuid(),
    tradeVersion: z.number().int().positive(),
    eventType: tradeAuditEventTypeSchema,
    actorUserId: z.string().uuid(),
    actorDisplayName: z.string(),
    before: tradeSchema.nullable(),
    after: tradeSchema,
    createdAt: z.string().datetime()
  })
  .meta({ id: "TradeAuditEvent" });

export const tradeAuditPageSchema = z
  .object({ data: z.array(tradeAuditEventSchema) })
  .meta({ id: "TradeAuditPage" });

/**
 * SSE payload. Published as a component so the frontend gets both a type and a
 * runtime validator even though connection handling is handwritten.
 */
export const tradeEventSchema = z
  .object({
    id: z.string().uuid(),
    eventType: tradeAuditEventTypeSchema,
    trade: tradeSchema,
    occurredAt: z.string().datetime()
  })
  .meta({ id: "TradeEvent" });
