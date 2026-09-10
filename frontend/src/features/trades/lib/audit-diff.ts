import { formatPrice, formatQuantity, formatTradeTimestamp } from "@/lib/format";
import type { Trade } from "@/types/trade";

export type FieldChange = { label: string; before: string; after: string };

type Field = {
  key: keyof Trade;
  label: string;
  render: (trade: Trade) => string;
};

/** Only the fields an amendment can touch are worth diffing. */
const FIELDS: readonly Field[] = [
  { key: "symbol", label: "Symbol", render: (t) => t.symbol },
  { key: "side", label: "Side", render: (t) => t.side },
  { key: "quantity", label: "Quantity", render: (t) => formatQuantity(t.quantity) },
  { key: "price", label: "Price", render: (t) => formatPrice(t.price) },
  { key: "book", label: "Book", render: (t) => t.book },
  { key: "counterparty", label: "Counterparty", render: (t) => t.counterparty },
  { key: "tradeTimestamp", label: "Trade time", render: (t) => formatTradeTimestamp(t.tradeTimestamp) },
  { key: "status", label: "Status", render: (t) => t.status }
];

/**
 * Field-level diff between two trade snapshots, so audit history can show
 * `Field | before | → | after` rather than a JSON blob.
 */
export function diffTrades(before: Trade | null, after: Trade | null): FieldChange[] {
  if (!before || !after) return [];
  const changes: FieldChange[] = [];
  for (const field of FIELDS) {
    if (before[field.key] !== after[field.key]) {
      changes.push({
        label: field.label,
        before: field.render(before),
        after: field.render(after)
      });
    }
  }
  return changes;
}

export type ConflictRow = {
  /** The trade field this row describes, for matching against edited fields. */
  field: keyof Trade;
  label: string;
  mine: string;
  theirs: string;
  differs: boolean;
};

/**
 * Three-column comparison for the version-conflict panel: what the user typed
 * against what the server now holds. Nothing is merged; this only reports.
 */
export function compareForConflict(mine: Trade, theirs: Trade): ConflictRow[] {
  return FIELDS.filter((field) => field.key !== "status").map((field) => ({
    field: field.key,
    label: field.label,
    mine: field.render(mine),
    theirs: field.render(theirs),
    differs: mine[field.key] !== theirs[field.key]
  }));
}
