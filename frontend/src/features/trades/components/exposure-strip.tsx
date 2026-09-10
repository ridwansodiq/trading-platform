import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { formatClock } from "@/lib/format";
import { toExposureDisplay } from "@/features/trades/lib/exposure";
import type { ConnectionState, TradeExposure } from "@/types/trade";

const CONNECTION_DOT: Record<ConnectionState, string> = {
  live: "bg-green-3",
  reconnecting: "bg-amber-3 animate-pulse",
  disconnected: "bg-ink-5",
  offline: "bg-red-2"
};

type Props = {
  exposure: TradeExposure;
  connection: ConnectionState;
  lastUpdateAt: string | null;
};

function Metric({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex-1 border-r border-line px-3.5 py-2 last:border-r-0">
      <p className="text-micro font-medium uppercase tracking-[0.04em] text-ink-5">{label}</p>
      <p className={cn("mt-0.5 font-mono text-body font-semibold tabular-nums text-ink", className)}>
        {value}
      </p>
    </div>
  );
}

/**
 * Aggregates for the current filter, computed server-side over every matching
 * trade. The label says "matching" rather than "in view" because that is what
 * the figures describe — paging through the blotter does not change them.
 */
export function ExposureStrip({ exposure, connection, lastUpdateAt }: Props) {
  const display = useMemo(() => toExposureDisplay(exposure), [exposure]);

  return (
    <section className="flex min-h-[46px] flex-wrap items-stretch border-b border-line bg-surface">
      <Metric label="Trades matching" value={display.tradesInScope} />
      <Metric label="Working" value={display.working} />
      <Metric label="Buy notional" value={display.buyNotional} />
      <Metric label="Sell notional" value={display.sellNotional} />
      <Metric
        label="Net exposure"
        value={display.netNotional}
        className={display.netIsNegative ? "text-red" : "text-green"}
      />
      <div className="flex items-center gap-2 px-3.5 py-2">
        <span className={cn("size-1.5 shrink-0 rounded-full", CONNECTION_DOT[connection])} />
        <span className="font-mono text-mini text-ink-5">
          {connection === "offline"
            ? "Offline — no network"
            : lastUpdateAt
              ? `Last update ${formatClock(lastUpdateAt)}`
              : "Awaiting updates"}
        </span>
      </div>
    </section>
  );
}
