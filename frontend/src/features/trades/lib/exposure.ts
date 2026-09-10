import Decimal from "decimal.js";
import { formatExposure, formatQuantity } from "@/lib/format";
import type { TradeExposure } from "@/types/trade";

export type ExposureDisplay = {
  tradesInScope: string;
  working: string;
  buyNotional: string;
  sellNotional: string;
  netNotional: string;
  /** Drives the sign colour; the value itself stays exact as a string. */
  netIsNegative: boolean;
};

/**
 * Formats the server's aggregates for the exposure strip.
 *
 * The figures are *not* recomputed here. They are calculated in SQL across
 * every trade matching the current filter, because summing the loaded page
 * would label a page total as a book total — a number that silently changes
 * when the user turns the page.
 *
 * Notionals arrive as decimal strings rather than JSON numbers: a sum of
 * `quantity * price` can exceed the range a double represents exactly.
 */
export function toExposureDisplay(exposure: TradeExposure): ExposureDisplay {
  const net = new Decimal(exposure.netNotional);

  return {
    tradesInScope: formatQuantity(exposure.tradesInScope),
    working: formatQuantity(exposure.statusCounts.NEW),
    buyNotional: formatExposure(new Decimal(exposure.buyNotional)),
    sellNotional: formatExposure(new Decimal(exposure.sellNotional)),
    netNotional: formatExposure(net),
    netIsNegative: net.isNegative()
  };
}

/** What the strip shows before the first aggregate arrives. */
export const EMPTY_EXPOSURE: TradeExposure = {
  tradesInScope: 0,
  statusCounts: { NEW: 0, EXECUTED: 0, CANCELLED: 0 },
  buyNotional: "0",
  sellNotional: "0",
  netNotional: "0"
};
