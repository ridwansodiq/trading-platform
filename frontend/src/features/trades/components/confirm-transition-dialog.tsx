import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { SideTag } from "@/features/trades/components/trade-badges";
import { formatPrice, formatQuantity } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TradeView } from "@/types/trade";

export type TransitionKind = "execute" | "cancel";

const COPY: Record<TransitionKind, { title: string; warning: string; confirm: string; icon: typeof Check }> = {
  execute: {
    title: "Execute trade",
    warning:
      "Execution is terminal. The trade moves to EXECUTED and can no longer be amended or cancelled.",
    confirm: "Execute trade",
    icon: Check
  },
  cancel: {
    title: "Cancel trade",
    warning:
      "Cancellation is terminal. The trade moves to CANCELLED and cannot be reinstated or amended.",
    confirm: "Cancel trade",
    icon: X
  }
};

type Props = {
  kind: TransitionKind | null;
  trade: TradeView | null;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-line-soft px-3 py-2 last:border-b-0">
      <dt className="text-cell-2 text-ink-4">{label}</dt>
      <dd className="text-cell-2 font-medium text-ink">{children}</dd>
    </div>
  );
}

/**
 * Execute and cancel are irreversible, so both require an explicit confirmation
 * that restates the consequence and the trade's economics.
 */
export function ConfirmTransitionDialog({ kind, trade, pending, onConfirm, onClose }: Props) {
  const copy = kind ? COPY[kind] : null;
  const Icon = copy?.icon ?? Check;

  return (
    <Dialog open={Boolean(kind && trade)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[432px] gap-0 p-5">
        <div
          className={cn(
            "mb-3 grid size-7 place-items-center rounded-md",
            kind === "cancel" ? "bg-red-soft text-red" : "bg-green-soft text-green"
          )}
        >
          <Icon size={15} />
        </div>

        <DialogTitle className="text-body-2 font-semibold text-ink">{copy?.title}</DialogTitle>
        <DialogDescription className="mt-1.5 text-cell-2 leading-relaxed text-ink-4">
          {copy?.warning}
        </DialogDescription>

        {trade && (
          <dl className="mt-4 rounded-lg border border-line font-mono">
            <Fact label="Trade ID">{trade.tradeId}</Fact>
            <Fact label="Symbol">{trade.symbol}</Fact>
            <Fact label="Side">
              <SideTag side={trade.side} />
            </Fact>
            <Fact label="Quantity">
              <span className="tabular-nums">{formatQuantity(trade.quantity)}</span>
            </Fact>
            <Fact label="Price">
              <span className="tabular-nums">{formatPrice(trade.price)}</span>
            </Fact>
            <Fact label="Notional">
              <span className="tabular-nums">{trade.notional}</span>
            </Fact>
          </dl>
        )}

        <DialogFooter className="mt-5">
          <Button variant="outline" onClick={onClose} disabled={pending} className="h-9 text-body-2">
            Keep as is
          </Button>
          <Button
            onClick={onConfirm}
            disabled={pending}
            className={cn(
              "h-9 text-body-2",
              kind === "cancel"
                ? "bg-red-2 text-white hover:bg-red"
                : "bg-green text-white hover:bg-green-2"
            )}
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            {copy?.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
