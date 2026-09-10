import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listTradeFilterOptions } from "@/api/generated/endpoints/trades/trades";
import { ok } from "@/api/unwrap";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { TradeFilterField } from "@/api/generated/models";

const OPTION_LIMIT = 50;

export type FilterOptions = {
  values: readonly string[];
  hasMore: boolean;
  loading: boolean;
};

/**
 * Distinct values for one filterable column, searched on the server.
 *
 * Only fetches while the picker is open, so opening the blotter does not pull
 * three option lists it may never show. Results are cached per search term and
 * the previous list stays visible while a new one loads, so the menu does not
 * flicker between keystrokes.
 */
export function useFilterOptions(
  field: TradeFilterField,
  search: string,
  enabled: boolean
): FilterOptions {
  const debouncedSearch = useDebouncedValue(search, 200);

  const query = useQuery({
    queryKey: ["filter-options", field, debouncedSearch],
    queryFn: async ({ signal }) =>
      ok(
        await listTradeFilterOptions(
          {
            field,
            ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
            limit: OPTION_LIMIT
          },
          { signal }
        )
      ),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 60_000
  });

  return {
    values: query.data?.values ?? [],
    hasMore: query.data?.hasMore ?? false,
    // Also true while the debounce is still settling, so the menu shows progress.
    loading: query.isFetching || search !== debouncedSearch
  };
}
