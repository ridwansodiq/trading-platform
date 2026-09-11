import { useCallback, useState } from "react";
import { useTradeMutations } from "@/features/trades/hooks/use-trade-mutations";
import type { TradeView } from "@/types/trade";

export type TransitionKind = "execute" | "cancel";

export type PendingTransition = { kind: TransitionKind; trade: TradeView };

export type TradeDialogs = {
  confirm: PendingTransition | null;
  auditTrade: TradeView | null;
  transitionPending: boolean;
  /** True while either surface is up, so the blotter's hotkeys can stand down. */
  isOpen: boolean;

  startTransition: (kind: TransitionKind, trade: TradeView) => void;
  confirmTransition: () => Promise<void>;
  closeConfirm: () => void;
  openAudit: (trade: TradeView) => void;
  closeAudit: () => void;
};

/**
 * The two surfaces the blotter opens over a single row: confirming a terminal
 * action, and reading a trade's history.
 *
 * Neither touches what the user may have half-typed into the trade form, which
 * is why they are not part of it. What they share is their shape — each holds
 * one trade and nothing else — and the reason the blotter cares about both:
 * while either is up, the single-key shortcuts have to stand down.
 *
 * Execute and cancel are irreversible, so the command is deliberately split
 * from the click that asked for it: `startTransition` only opens the dialog,
 * and nothing reaches the server until `confirmTransition`.
 */
export function useTradeDialogs(): TradeDialogs {
  const { transition } = useTradeMutations();

  const [confirm, setConfirm] = useState<PendingTransition | null>(null);
  const [auditTrade, setAuditTrade] = useState<TradeView | null>(null);

  const startTransition = useCallback((kind: TransitionKind, trade: TradeView) => {
    setConfirm({ kind, trade });
  }, []);

  const confirmTransition = useCallback(async () => {
    if (!confirm) return;
    try {
      await transition.mutateAsync({
        id: confirm.trade.id,
        kind: confirm.kind,
        expectedVersion: confirm.trade.version
      });
    } catch {
      // Surfaced as a toast by the mutation's onError handler.
    }
    // Closed either way: leaving a rejected dialog up would strand the user.
    setConfirm(null);
  }, [confirm, transition]);

  return {
    confirm,
    auditTrade,
    transitionPending: transition.isPending,
    isOpen: confirm !== null || auditTrade !== null,
    startTransition,
    confirmTransition,
    closeConfirm: useCallback(() => setConfirm(null), []),
    openAudit: setAuditTrade,
    closeAudit: useCallback(() => setAuditTrade(null), [])
  };
}
