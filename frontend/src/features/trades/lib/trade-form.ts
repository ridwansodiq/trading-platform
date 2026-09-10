import { CreateTradeBody } from "@/api/generated/validation/trades/trades.zod";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "@/lib/format";
import type { CreateTradeCommand } from "@/api/generated/models";
import type { Trade, TradeSide } from "@/types/trade";

/**
 * The trade form's rules, kept out of the component so they can be tested.
 *
 * Validation runs the *generated* request schema rather than a hand-written
 * copy of it. A duplicated rule drifts silently — the previous version omitted
 * the server's length caps, so an over-long counterparty passed the form and
 * came back as an error the user could do nothing with.
 */

/** Every field an amendment may send, in display order. */
export const AMENDABLE_FIELDS = [
  "symbol",
  "side",
  "quantity",
  "price",
  "book",
  "counterparty",
  "tradeTimestamp"
] as const satisfies ReadonlyArray<keyof CreateTradeCommand>;

export type AmendableField = (typeof AMENDABLE_FIELDS)[number];

/** Form state is all strings: an input holds text, including a half-typed number. */
export type FormValues = {
  symbol: string;
  side: TradeSide;
  quantity: string;
  price: string;
  book: string;
  counterparty: string;
  tradeTimestamp: string;
};

export type FieldErrors = Partial<Record<keyof FormValues, string>>;

/** The scale of the `price` column, which the generated schema cannot express. */
const PRICE_SCALE = 4;

export function toFormValues(trade: Trade | null, now: Date): FormValues {
  return {
    symbol: trade?.symbol ?? "",
    side: trade?.side ?? "BUY",
    quantity: trade ? String(trade.quantity) : "",
    price: trade ? String(trade.price) : "",
    book: trade?.book ?? "",
    counterparty: trade?.counterparty ?? "",
    tradeTimestamp: toDateTimeLocalValue(trade?.tradeTimestamp ?? now)
  };
}

/** The normalised command the form would submit. */
export function toTradeCommand(values: FormValues): CreateTradeCommand {
  return {
    symbol: values.symbol.trim().toUpperCase(),
    side: values.side,
    quantity: Number(values.quantity),
    price: Number(values.price),
    book: values.book.trim(),
    counterparty: values.counterparty.trim(),
    tradeTimestamp: values.tradeTimestamp
      ? fromDateTimeLocalValue(values.tradeTimestamp)
      : new Date().toISOString()
  };
}

/**
 * Which fields differ from the values the form opened with.
 *
 * Compared as normalised commands, so retyping the same value with different
 * whitespace or casing is not treated as an edit and does not get sent.
 */
export function changedFields(baseline: FormValues, current: FormValues): AmendableField[] {
  const before = toTradeCommand(baseline);
  const after = toTradeCommand(current);
  return AMENDABLE_FIELDS.filter((field) => !Object.is(before[field], after[field]));
}

/** Decimal places of a typed value, without going through a float first. */
function typedDecimalPlaces(raw: string): number {
  return raw.split(".")[1]?.length ?? 0;
}

/**
 * Field-level messages for the whole form.
 *
 * The generated schema supplies every rule the server enforces; the two checks
 * layered on top are ones JSON Schema cannot carry — a number that was never
 * numeric, and the scale of the `price` column.
 */
export function validateTradeForm(values: FormValues): FieldErrors {
  const errors: FieldErrors = {};

  // Run these first: `Number("")` is 0, which the schema would report as a
  // bounds failure rather than as the missing value it is.
  if (values.quantity.trim() === "" || !Number.isFinite(Number(values.quantity))) {
    errors.quantity = "Quantity is required.";
  }
  if (values.price.trim() === "" || !Number.isFinite(Number(values.price))) {
    errors.price = "Price is required.";
  }
  if (!values.tradeTimestamp) {
    errors.tradeTimestamp = "Trade time is required.";
  }

  const parsed = CreateTradeBody.safeParse(toTradeCommand(values));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as keyof FormValues | undefined;
      if (field && !errors[field]) errors[field] = issue.message;
    }
  }

  if (!errors.price && typedDecimalPlaces(values.price.trim()) > PRICE_SCALE) {
    errors.price = `Price supports at most ${PRICE_SCALE} decimal places.`;
  }

  return errors;
}
