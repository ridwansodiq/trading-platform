import { Plus, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterCombobox } from "@/features/trades/components/filter-combobox";
import { cn } from "@/lib/utils";
import type { TradeFilters, TradeStatus } from "@/types/trade";

type StatusOption = TradeStatus | "ALL";

const STATUS_DOT: Record<StatusOption, string> = {
  ALL: "bg-ink-5",
  NEW: "bg-amber-3",
  EXECUTED: "bg-green-3",
  CANCELLED: "bg-ink-5"
};

type Props = {
  filters: TradeFilters;
  onFiltersChange: (next: Partial<TradeFilters>) => void;
  onClearFilters: () => void;
  hasFilters: boolean;
  /**
   * Counts across every trade matching the other filters, from the server.
   * Counting the loaded page would label a page tally as a book tally.
   */
  statusCounts: Record<TradeStatus, number>;
  totalInScope: number;
  isFetching: boolean;
  /** The stream is down, so these rows may be behind. Commands still work. */
  isStale: boolean;
  onRefresh: () => void;
  onNewTrade: () => void;
  searchRef?: React.Ref<HTMLInputElement>;
};

/** A chip group — a compact, always-visible filter with its own live count. */
function ChipGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  dots,
  counts
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  dots?: Record<string, string>;
  counts?: Record<string, number>;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex items-center gap-0.5 rounded-lg bg-surface-muted-2 p-0.5"
    >
      {options.map((option) => {
        const active = option === value;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-micro-2 font-semibold uppercase tracking-[0.02em] transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              active ? "bg-raised text-ink shadow-xs" : "text-ink-4 hover:text-ink-2"
            )}
          >
            {dots?.[option] && <span className={cn("size-[5px] rounded-full", dots[option])} />}
            {option === "ALL" ? "All" : option}
            {counts?.[option] !== undefined && (
              <span className="font-mono text-micro tabular-nums text-ink-5">{counts[option]}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function BlotterToolbar({
  filters,
  onFiltersChange,
  onClearFilters,
  hasFilters,
  statusCounts,
  totalInScope,
  isFetching,
  isStale,
  onRefresh,
  onNewTrade,
  searchRef
}: Props) {
  const counts: Record<StatusOption, number> = { ALL: totalInScope, ...statusCounts };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3.5 py-2.5">
      <div className="relative min-w-[220px] flex-1 sm:max-w-[300px]">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-5" size={14} />
        <label className="sr-only" htmlFor="blotter-search">
          Search trades
        </label>
        <Input
          id="blotter-search"
          ref={searchRef}
          value={filters.search}
          onChange={(event) => onFiltersChange({ search: event.target.value })}
          placeholder="Search id, symbol, counterparty…"
          className="h-8 pl-8 pr-8 text-cell-2"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-xs border border-line bg-surface-muted px-1 font-mono text-micro text-ink-5">
          /
        </kbd>
      </div>

      <ChipGroup
        label="Filter by status"
        value={filters.status}
        options={["ALL", "NEW", "EXECUTED", "CANCELLED"] as const}
        onChange={(status) => onFiltersChange({ status })}
        dots={STATUS_DOT}
        counts={counts}
      />

      <ChipGroup
        label="Filter by side"
        value={filters.side}
        options={["ALL", "BUY", "SELL"] as const}
        onChange={(side) => onFiltersChange({ side })}
      />

      {/*
        Searched server-side. Deriving these from the loaded rows would cap the
        list at whatever the current page happens to contain.
      */}
      <FilterCombobox
        field="trader"
        value={filters.trader}
        onChange={(trader) => onFiltersChange({ trader: trader || "ALL" })}
        label="Filter by trader"
        placeholder="All traders"
        allLabel="All traders"
        emptyValue="ALL"
        className="min-w-[140px]"
      />

      <FilterCombobox
        field="book"
        value={filters.book}
        onChange={(book) => onFiltersChange({ book: book || "ALL" })}
        label="Filter by book"
        placeholder="All books"
        allLabel="All books"
        emptyValue="ALL"
        className="min-w-[120px]"
      />

      {hasFilters && (
        <button
          type="button"
          onClick={onClearFilters}
          className="rounded-md px-1.5 text-cell-2 font-medium text-violet hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Clear filters
        </button>
      )}

      <div className="ml-auto flex items-center gap-2">
        {/*
          The stream is only a notification channel, so a drop means these rows
          may lag — never that the desk is closed. Saying so, next to the manual
          refresh, is the whole remedy.
        */}
        {isStale && (
          <span
            role="status"
            className="inline-flex items-center gap-1.5 rounded-sm bg-amber-soft px-1.5 py-0.5 text-micro-2 font-semibold text-amber"
          >
            <span className="size-[5px] rounded-full bg-amber-3" />
            Live updates paused — refresh for the latest
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Refresh blotter"
          title="Refresh blotter"
          onClick={onRefresh}
          className="size-8"
        >
          <RefreshCw size={15} className={isFetching ? "animate-spin" : undefined} />
        </Button>
        <Button type="button" onClick={onNewTrade} className="h-8 gap-2 text-cell-2 font-medium">
          <Plus size={14} />
          New trade
          <kbd className="rounded-xs border border-white/25 px-1 font-mono text-micro">N</kbd>
        </Button>
      </div>
    </div>
  );
}
