import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getTradeExposure, listTrades } from "@/api/generated/endpoints/trades/trades";
import { ok } from "@/api/unwrap";
import { EMPTY_EXPOSURE } from "@/features/trades/lib/exposure";
import { toTradeViews } from "@/features/trades/lib/trade-view";
import type { GetTradeExposureParams, ListTradesParams } from "@/api/generated/models";
import type { TableState, TradeExposure, TradeFilters, TradeSort, TradeView } from "@/types/trade";

export const TRADES_QUERY_ROOT = ["trades"] as const;

/** The filter half of the query, shared by the list and its aggregates. */
function toFilterParams(filters: TradeFilters): GetTradeExposureParams {
  return {
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.status === "ALL" ? {} : { status: filters.status }),
    ...(filters.side === "ALL" ? {} : { side: filters.side }),
    ...(filters.trader === "ALL" ? {} : { trader: filters.trader }),
    ...(filters.book === "ALL" ? {} : { book: filters.book })
  };
}

export type UseTradesResult = {
  views: TradeView[];
  total: number;
  tableState: TableState;
  isFetching: boolean;
  refetch: () => void;
};

/**
 * Trade list query.
 *
 * The server filters, sorts and pages, including the three derived columns —
 * PostgreSQL orders by the same `quantity * price` expression the UI displays.
 * Nothing is re-sorted here, so what the table shows for "sort by notional" is
 * the real ordering rather than the current page rearranged.
 */
export function useTrades(
  filters: TradeFilters,
  sort: TradeSort,
  page: number,
  pageSize: number,
  enabled: boolean
): UseTradesResult {
  const params = useMemo<ListTradesParams>(
    () => ({
      ...toFilterParams(filters),
      sortBy: sort.key,
      sortDirection: sort.direction,
      page,
      pageSize
    }),
    [filters, sort, page, pageSize]
  );

  const query = useQuery({
    queryKey: [...TRADES_QUERY_ROOT, "list", params],
    queryFn: async ({ signal }) => ok(await listTrades(params, { signal })),
    enabled,
    placeholderData: keepPreviousData
  });

  const views = useMemo(() => toTradeViews(query.data?.data ?? []), [query.data]);

  const total = query.data?.total ?? 0;
  const tableState: TableState = query.isError
    ? "error"
    : query.isLoading
      ? "loading"
      : views.length > 0
        ? "ready"
        // Matches exist, just not on this page: the page number is past the end.
        : total > 0 && page > 1
          ? "beyond-end"
          : "empty";

  return {
    views,
    total,
    tableState,
    isFetching: query.isFetching,
    refetch: () => void query.refetch()
  };
}

export type UseTradeExposureResult = {
  exposure: TradeExposure;
  isFetching: boolean;
};

/**
 * Notional and status aggregates for the current filter.
 *
 * A separate query from the list because it is scoped to the whole result set
 * rather than a page, and so paging through the blotter does not refetch
 * totals that cannot have changed.
 */
export function useTradeExposure(filters: TradeFilters, enabled: boolean): UseTradeExposureResult {
  const params = useMemo(() => toFilterParams(filters), [filters]);

  const query = useQuery({
    queryKey: [...TRADES_QUERY_ROOT, "exposure", params],
    queryFn: async ({ signal }) => ok(await getTradeExposure(params, { signal })),
    enabled,
    placeholderData: keepPreviousData
  });

  return { exposure: query.data ?? EMPTY_EXPOSURE, isFetching: query.isFetching };
}
