import { cn } from "@/lib/utils";
import type { TradeSide, TradeStatus } from "@/types/trade";

/**
 * BUY is green and SELL is red — the directional signal a trader scans for.
 * NEW is amber because it means "working, needs attention"; EXECUTED emerald
 * and CANCELLED slate are both settled.
 */

const SIDE_STYLES: Record<TradeSide, string> = {
  BUY: "bg-green-soft text-green",
  SELL: "bg-red-soft text-red"
};

export function SideTag({ side }: { side: TradeSide }) {
  return (
    <span
      className={cn(
        "inline-flex h-[19px] items-center rounded-sm px-1.5 text-micro-2 font-semibold",
        SIDE_STYLES[side]
      )}
    >
      {side}
    </span>
  );
}

const STATUS_STYLES: Record<TradeStatus, { dot: string; text: string }> = {
  NEW: { dot: "bg-amber-3", text: "text-amber" },
  EXECUTED: { dot: "bg-green-3", text: "text-green-2" },
  CANCELLED: { dot: "bg-ink-5", text: "text-ink-4" }
};

export function StatusPill({ status }: { status: TradeStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span className="inline-flex h-5 items-center gap-1.5 rounded-sm border border-line bg-surface px-1.5">
      <span className={cn("size-[5px] shrink-0 rounded-full", style.dot)} />
      <span className={cn("text-micro-2 font-semibold", style.text)}>{status}</span>
    </span>
  );
}

/** Signed derived values carry their own colour: long green, short red. */
export function SignedValue({ value, formatted }: { value: number; formatted: string }) {
  return (
    <span className={cn("font-mono tabular-nums", value < 0 ? "text-red" : "text-green")}>
      {formatted}
    </span>
  );
}
