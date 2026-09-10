import Decimal from "decimal.js";
import { formatNotional, formatSigned } from "@/lib/format";
import type { Trade, TradeView } from "@/types/trade";

/**
 * The single place derived trade metrics are calculated for display.
 *
 *   notional       = quantity * price
 *   signedQuantity = BUY ? +quantity : -quantity
 *   signedNotional = BUY ? +notional : -notional
 *
 * Derived in the UI on every read — never persisted, never sent in a command,
 * never written to an audit snapshot. Sorting by them happens in SQL over the
 * same expressions, so the table is not limited to ordering the current page.
 */
export function toTradeView(trade: Trade): TradeView {
  const sign = trade.side === "BUY" ? 1 : -1;
  const notional = new Decimal(trade.quantity).times(trade.price);
  const signedQuantity = new Decimal(trade.quantity).times(sign);
  const signedNotional = notional.times(sign);

  return {
    ...trade,
    notional: formatNotional(notional),
    signedQuantity: formatSigned(signedQuantity, 0),
    signedNotional: formatSigned(signedNotional, 2),
    notionalValue: notional.toNumber(),
    signedQuantityValue: signedQuantity.toNumber(),
    signedNotionalValue: signedNotional.toNumber()
  };
}

export function toTradeViews(trades: readonly Trade[]): TradeView[] {
  return trades.map(toTradeView);
}
