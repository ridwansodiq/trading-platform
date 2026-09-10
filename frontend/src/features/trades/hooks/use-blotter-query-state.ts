import { useCallback, useEffect, useMemo, useState } from "react";
import { SortDirection, TradeSide, TradeSortKey, TradeStatus } from "@/api/generated/models";
import type { SortKey, TradeFilters, TradeSort } from "@/types/trade";

/**
 * What the blotter is currently looking at, kept in the URL.
 *
 * A trader who filters to a book and sorts by notional can then reload, share
 * the link, or use the browser's back button and land on the same view. Holding
 * it only in component state silently discards all of that on every refresh.
 */

export const DEFAULT_FILTERS: TradeFilters = {
  search: "",
  status: "ALL",
  side: "ALL",
  trader: "ALL",
  book: "ALL"
};

export const DEFAULT_SORT: TradeSort = { key: "tradeTimestamp", direction: "desc" };

export type BlotterQueryState = {
  filters: TradeFilters;
  sort: TradeSort;
  page: number;
  hasFilters: boolean;
  updateFilters: (next: Partial<TradeFilters>) => void;
  clearFilters: () => void;
  toggleSort: (key: SortKey) => void;
  setPage: (page: number) => void;
};

/** Only accept values the API actually defines; anything else falls back. */
function oneOf<T extends string>(values: readonly string[], raw: string | null): T | null {
  return raw && values.includes(raw) ? (raw as T) : null;
}

function readSearchParams(search: string): { filters: TradeFilters; sort: TradeSort; page: number } {
  const params = new URLSearchParams(search);
  const page = Number(params.get("page"));

  return {
    filters: {
      search: params.get("q") ?? DEFAULT_FILTERS.search,
      status: oneOf<TradeStatus>(Object.values(TradeStatus), params.get("status")) ?? "ALL",
      side: oneOf<TradeSide>(Object.values(TradeSide), params.get("side")) ?? "ALL",
      trader: params.get("trader") || "ALL",
      book: params.get("book") || "ALL"
    },
    sort: {
      key: oneOf<SortKey>(Object.values(TradeSortKey), params.get("sortBy")) ?? DEFAULT_SORT.key,
      direction:
        oneOf<SortDirection>(Object.values(SortDirection), params.get("sortDir")) ??
        DEFAULT_SORT.direction
    },
    page: Number.isInteger(page) && page > 0 ? page : 1
  };
}

/** Only non-default values are written, so a pristine blotter has a clean URL. */
function toSearchParams(filters: TradeFilters, sort: TradeSort, page: number): string {
  const params = new URLSearchParams();
  if (filters.search) params.set("q", filters.search);
  if (filters.status !== "ALL") params.set("status", filters.status);
  if (filters.side !== "ALL") params.set("side", filters.side);
  if (filters.trader !== "ALL") params.set("trader", filters.trader);
  if (filters.book !== "ALL") params.set("book", filters.book);
  if (sort.key !== DEFAULT_SORT.key) params.set("sortBy", sort.key);
  if (sort.direction !== DEFAULT_SORT.direction) params.set("sortDir", sort.direction);
  if (page !== 1) params.set("page", String(page));
  return params.toString();
}

export function useBlotterQueryState(): BlotterQueryState {
  const [state, setState] = useState(() => readSearchParams(window.location.search));

  // Mirror the state into the URL without adding a history entry per keystroke.
  useEffect(() => {
    const query = toSearchParams(state.filters, state.sort, state.page);
    const next = `${window.location.pathname}${query ? `?${query}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", next);
    }
  }, [state]);

  // Back and forward move between views rather than leaving the app.
  useEffect(() => {
    const onPopState = () => setState(readSearchParams(window.location.search));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  /** Any filter change resets to the first page; the old page may not exist. */
  const updateFilters = useCallback((next: Partial<TradeFilters>) => {
    setState((current) => ({
      ...current,
      filters: { ...current.filters, ...next },
      page: 1
    }));
  }, []);

  const clearFilters = useCallback(() => {
    setState((current) => ({ ...current, filters: DEFAULT_FILTERS, page: 1 }));
  }, []);

  const toggleSort = useCallback((key: SortKey) => {
    setState((current) => ({
      ...current,
      sort:
        current.sort.key === key
          ? { key, direction: current.sort.direction === "asc" ? "desc" : "asc" }
          : { key, direction: "asc" },
      page: 1
    }));
  }, []);

  const setPage = useCallback((page: number) => {
    setState((current) => ({ ...current, page }));
  }, []);

  const hasFilters = useMemo(
    () =>
      (Object.keys(DEFAULT_FILTERS) as Array<keyof TradeFilters>).some(
        (key) => state.filters[key] !== DEFAULT_FILTERS[key]
      ),
    [state.filters]
  );

  return {
    filters: state.filters,
    sort: state.sort,
    page: state.page,
    hasFilters,
    updateFilters,
    clearFilters,
    toggleSort,
    setPage
  };
}
