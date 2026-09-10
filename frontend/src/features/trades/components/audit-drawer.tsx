import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { useTradeAudit } from "@/features/trades/hooks/use-trade-audit";
import { diffTrades } from "@/features/trades/lib/audit-diff";
import { formatQuantity, formatTradeTimestamp, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TradeAuditEvent, TradeAuditEventType, TradeView } from "@/types/trade";

const EVENT_STYLES: Record<TradeAuditEventType, { dot: string; halo: string; text: string }> = {
  CREATED: { dot: "bg-violet", halo: "ring-violet-soft-2", text: "text-violet-ink" },
  AMENDED: { dot: "bg-amber-3", halo: "ring-amber-soft-2", text: "text-amber" },
  EXECUTED: { dot: "bg-green-3", halo: "ring-green-soft-2", text: "text-green-2" },
  CANCELLED: { dot: "bg-ink-5", halo: "ring-surface-muted-2", text: "text-ink-4" }
};

function CreatedNote({ event }: { event: TradeAuditEvent }) {
  const trade = event.after;
  return (
    <p className="mt-1.5 text-cell-2 text-ink-3">
      {trade.side} {formatQuantity(trade.quantity)} {trade.symbol} booked to {trade.book}.
    </p>
  );
}

function ChangeTable({ event }: { event: TradeAuditEvent }) {
  const changes = diffTrades(event.before, event.after);
  if (changes.length === 0) {
    return <p className="mt-1.5 text-cell-2 text-ink-5">No field values changed.</p>;
  }
  return (
    <table className="mt-2 w-full border-collapse">
      <tbody>
        {changes.map((change) => (
          <tr key={change.label}>
            <td className="py-0.5 pr-2 align-top text-cell text-ink-4">{change.label}</td>
            <td className="py-0.5 pr-1.5 text-right font-mono text-cell tabular-nums text-ink-5 line-through">
              {change.before}
            </td>
            <td className="py-0.5 pr-1.5 text-cell text-ink-5">→</td>
            <td className="py-0.5 text-right font-mono text-cell font-medium tabular-nums text-ink">
              {change.after}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type Props = { trade: TradeView | null; onClose: () => void };

/**
 * Immutable history, oldest first. Each entry shows what changed field by
 * field, never a raw snapshot blob.
 */
export function AuditDrawer({ trade, onClose }: Props) {
  const audit = useTradeAudit(trade?.id ?? null);

  return (
    <Sheet open={Boolean(trade)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-[440px]">
        <SheetHeader className="border-b border-line px-4 py-3">
          <SheetTitle className="font-mono text-body-2 font-semibold text-ink">
            {trade?.tradeId}
          </SheetTitle>
          <SheetDescription className="text-mini-2 text-ink-5">
            Immutable record. Newest last.
          </SheetDescription>
        </SheetHeader>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4">
          {audit.isLoading && (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-16 w-full" />
              ))}
            </div>
          )}

          {audit.isError && <p className="text-cell-2 text-red">Unable to load audit history.</p>}

          {audit.events.map((event, index) => {
            const style = EVENT_STYLES[event.eventType] ?? EVENT_STYLES.CREATED;
            const last = index === audit.events.length - 1;
            return (
              <div key={event.id} className="relative flex gap-3 pb-5">
                <div className="relative shrink-0 pt-1">
                  <span className={cn("block size-[9px] rounded-full ring-3", style.dot, style.halo)} />
                  {!last && (
                    <span className="absolute left-1/2 top-4 h-[calc(100%-4px)] w-px -translate-x-1/2 bg-line" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={cn("text-cell-2 font-semibold", style.text)}>
                      {event.eventType}
                    </span>
                    <span className="font-mono text-mini text-ink-5">
                      {formatTradeTimestamp(event.createdAt)}
                    </span>
                  </div>

                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="rounded-sm border border-line px-1 font-mono text-micro-2 text-ink-4">
                      v{event.tradeVersion}
                    </span>
                    <span className="grid size-[18px] place-items-center rounded-sm bg-violet-soft-2 text-[9px] font-semibold text-violet-ink">
                      {initials(event.actorDisplayName)}
                    </span>
                    <span className="text-cell text-ink-3">{event.actorDisplayName}</span>
                  </div>

                  {event.eventType === "CREATED" ? (
                    <CreatedNote event={event} />
                  ) : (
                    <ChangeTable event={event} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
