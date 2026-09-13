import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  amendTrade,
  cancelTrade,
  createTrade,
  executeTrade
} from "@/api/generated/endpoints/trades/trades";
import { ApiError } from "@/api/fetch-client";
import { ok } from "@/api/unwrap";
import { AUDIT_QUERY_ROOT } from "@/features/trades/hooks/use-trade-audit";
import { TRADES_QUERY_ROOT } from "@/features/trades/hooks/use-trades";
import { formatNotional } from "@/lib/format";
import type { AmendTradeRequest, CreateTradeRequest } from "@/api/generated/models";
import type { Trade, TradeErrorPayload } from "@/types/trade";

export type VersionConflict = {
  expectedVersion: number | undefined;
  currentVersion: number | undefined;
  currentTrade: Trade | undefined;
};

/** Narrow an unknown rejection into a version conflict, if that is what it is. */
export function asVersionConflict(error: unknown): VersionConflict | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const body = error.body as TradeErrorPayload;
  return {
    expectedVersion: body.expectedVersion,
    currentVersion: body.currentVersion,
    currentTrade: body.currentTrade
  };
}

/**
 * The server reports every invalid field, so a rejected submission can say
 * which ones rather than showing one sentence about the whole form.
 */
export function apiFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  const body = error.body as TradeErrorPayload | undefined;
  return Object.fromEntries(
    (body?.details ?? []).map((detail) => [detail.path, detail.message])
  );
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const body = error.body as TradeErrorPayload | undefined;
    return body?.message ?? fallback;
  }
  return fallback;
}

function tradeDetail(trade: Trade): string {
  return `${trade.tradeId} · ${trade.symbol} · $${formatNotional(trade.quantity * trade.price)}`;
}

export function useTradeMutations() {
  const queryClient = useQueryClient();

  /**
   * A mutation changes both the list and the trade's history, and the audit
   * drawer can be open while it happens.
   */
  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: TRADES_QUERY_ROOT });
    void queryClient.invalidateQueries({ queryKey: AUDIT_QUERY_ROOT });
  }, [queryClient]);

  const create = useMutation({
    mutationFn: async (body: CreateTradeRequest) => ok(await createTrade(body)),
    onSuccess: (trade) => {
      invalidate();
      toast.success("Trade booked", { description: tradeDetail(trade) });
    }
  });

  /**
   * `body` carries only the fields the user actually edited. Sending the whole
   * form would resubmit untouched values over whatever a concurrent amendment
   * had written to them.
   */
  const amend = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: AmendTradeRequest }) =>
      ok(await amendTrade(id, body)),
    onSuccess: (trade) => {
      invalidate();
      toast.success(`Amendment saved · now v${trade.version}`, { description: tradeDetail(trade) });
    }
  });

  const transition = useMutation({
    mutationFn: async ({
      id,
      kind,
      expectedVersion
    }: {
      id: string;
      kind: "execute" | "cancel";
      expectedVersion: number;
    }) => {
      const call = kind === "execute" ? executeTrade : cancelTrade;
      return ok(await call(id, { expectedVersion }));
    },
    onSuccess: (trade, variables) => {
      invalidate();
      toast.success(variables.kind === "execute" ? "Trade executed" : "Trade cancelled", {
        description: tradeDetail(trade)
      });
    },
    onError: (error, variables) => {
      const conflict = asVersionConflict(error);
      toast.error(
        conflict
          ? `${variables.kind === "execute" ? "Execution" : "Cancellation"} rejected · the trade moved to v${conflict.currentVersion}`
          : apiErrorMessage(error, "The blotter service rejected this request."),
        conflict
          ? { description: "Reopen the trade to see the current version before retrying." }
          : undefined
      );
      // The trade moved on, so what the table shows is already out of date.
      if (conflict) invalidate();
    }
  });

  return { create, amend, transition };
}
