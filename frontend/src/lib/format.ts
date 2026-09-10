import Decimal from "decimal.js";

/**
 * Blotter formatting. Every numeric column is tabular and fixed-precision so
 * decimal points align down the column and figures reconcile exactly — never
 * compact notation, which would make a notional unreadable as money.
 */

const integer = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

const decimal2 = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

/** Quantity: thousands separators, no decimals. */
export function formatQuantity(quantity: number): string {
  return integer.format(quantity);
}

/** Price: always 2dp so the column aligns. */
export function formatPrice(price: number): string {
  return decimal2.format(price);
}

/** Notional: always 2dp, full precision. */
export function formatNotional(notional: Decimal.Value): string {
  return decimal2.format(new Decimal(notional).toDecimalPlaces(2).toNumber());
}

/** Signed value with an explicit sign, for the derived signed columns. */
export function formatSigned(value: Decimal.Value, fractionDigits: 0 | 2): string {
  const amount = new Decimal(value);
  const magnitude = amount.abs();
  const body =
    fractionDigits === 0
      ? integer.format(magnitude.toNumber())
      : decimal2.format(magnitude.toDecimalPlaces(2).toNumber());
  return `${amount.isNegative() ? "−" : "+"}${body}`;
}

/**
 * Abbreviated money for the exposure strip only, where the spec asks for
 * `$1.23M`. Never used inside the table.
 */
export function formatExposure(value: Decimal.Value): string {
  const amount = new Decimal(value);
  const sign = amount.isNegative() ? "−" : "";
  const magnitude = amount.abs();
  const units: Array<[Decimal.Value, string]> = [
    [1_000_000_000, "B"],
    [1_000_000, "M"],
    [1_000, "K"]
  ];
  for (const [threshold, suffix] of units) {
    if (magnitude.gte(threshold)) {
      return `${sign}$${magnitude.div(threshold).toDecimalPlaces(2).toFixed(2)}${suffix}`;
    }
  }
  return `${sign}$${magnitude.toDecimalPlaces(2).toFixed(2)}`;
}

/**
 * Trade timestamps render as `YYYY-MM-DD HH:MM:SS` in UTC. Trading timestamps
 * are compared across desks, so a local-time rendering would be ambiguous.
 */
export function formatTradeTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().replace("T", " ").slice(0, 19);
}

/** Clock-only form for the "Last update" indicator. */
export function formatClock(value: string | number | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().slice(11, 19);
}

/**
 * `datetime-local` inputs read and write wall-clock UTC here, matching the
 * table. Deriving this from `toISOString` and parsing it back as local time
 * would shift the timestamp by the viewer's offset on every amendment.
 *
 * Seconds are kept. The input is rendered with `step="1"`, so truncating to
 * minutes here would silently rewrite an execution time the moment someone
 * opened the amend form.
 */
export function toDateTimeLocalValue(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 19);
}

/**
 * Inverse of {@link toDateTimeLocalValue} — treats the input as UTC.
 *
 * A browser may hand back either `YYYY-MM-DDTHH:MM` or `…:SS` depending on
 * whether the seconds field was touched, so both are accepted.
 */
export function fromDateTimeLocalValue(value: string): string {
  const normalized = value.length === 16 ? `${value}:00` : value;
  return new Date(`${normalized}Z`).toISOString();
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
