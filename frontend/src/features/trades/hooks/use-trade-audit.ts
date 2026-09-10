import { useQuery } from "@tanstack/react-query";
import { getTradeAudit } from "@/api/generated/endpoints/trades/trades";
import { ok } from "@/api/unwrap";
import type { TradeAuditEvent } from "@/types/trade";

/**
 * Its own key root so a mutation can invalidate open audit history without
 * touching the trade list, and so the drawer cannot show a version chain that
 * stops one short of the amendment the user just made.
 */
export const AUDIT_QUERY_ROOT = ["audit"] as const;

export type UseTradeAuditResult = {
  events: TradeAuditEvent[];
  isLoading: boolean;
  isError: boolean;
};

export function useTradeAudit(tradeId: string | null): UseTradeAuditResult {
  const query = useQuery({
    queryKey: [...AUDIT_QUERY_ROOT, tradeId],
    queryFn: async ({ signal }) => ok(await getTradeAudit(tradeId!, { signal })).data,
    enabled: tradeId !== null
  });

  return {
    events: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError
  };
}
