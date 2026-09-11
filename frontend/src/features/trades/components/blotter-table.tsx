import { useCallback, useMemo } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTable, type SortingState } from "@tanstack/react-table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  blotterColumns,
  blotterFeatures,
  type BlotterColumnMeta,
  type RowAction
} from "@/features/trades/components/blotter-columns";
import { cn } from "@/lib/utils";
import type { SortKey, TableState, TradeSort, TradeView } from "@/types/trade";

export type { RowAction };

type Props = {
  views: TradeView[];
  state: TableState;
  sort: TradeSort;
  onSortChange: (key: SortKey) => void;
  selectedId: string | null;
  cursorId: string | null;
  onSelect: (trade: TradeView) => void;
  onAction: (action: RowAction, trade: TradeView) => void;
  hasFilters: boolean;
  onClearFilters: () => void;
  onRetry: () => void;
  /** Recovery for a page number that sits past the end of the result set. */
  onGoToLastPage: () => void;
};

/** Trade ID stays readable while the row scrolls horizontally. */
const STICKY_LEFT_CELL =
  "sticky left-0 z-10 shadow-[2px_0_0_0_var(--line-soft)] group-hover:bg-surface-muted";

/** Actions stay reachable at any horizontal scroll position. */
const STICKY_RIGHT_CELL =
  "sticky right-0 z-10 shadow-[-2px_0_0_0_var(--line-soft)] group-hover:bg-surface-muted";

function stickyCellClass(sticky: BlotterColumnMeta["sticky"]): string | undefined {
  if (sticky === "left") return STICKY_LEFT_CELL;
  if (sticky === "right") return STICKY_RIGHT_CELL;
  return undefined;
}

function stickyHeaderClass(sticky: BlotterColumnMeta["sticky"]): string | undefined {
  if (sticky === "left") return "sticky left-0 z-30 bg-surface-muted";
  if (sticky === "right")
    return "sticky right-0 z-30 bg-surface-muted shadow-[-2px_0_0_0_var(--line-soft)]";
  return undefined;
}

function SortIndicator({ direction }: { direction: false | "asc" | "desc" }) {
  if (!direction) return null;
  const Icon = direction === "asc" ? ChevronUp : ChevronDown;
  return <Icon size={12} className="text-violet" aria-hidden />;
}

export function BlotterTable({
  views,
  state,
  sort,
  onSortChange,
  selectedId,
  cursorId,
  onSelect,
  onAction,
  hasFilters,
  onClearFilters,
  onRetry,
  onGoToLastPage
}: Props) {
  const sorting = useMemo<SortingState>(
    () => [{ id: sort.key, desc: sort.direction === "desc" }],
    [sort]
  );

  /*
   * A header toggle only names the column. Which direction that produces is
   * `useBlotterQueryState`'s decision, because the sort lives in the URL and
   * has to survive a reload, a shared link and the back button — so the table
   * never owns the slice it renders.
   */
  const handleSortingChange = useCallback(
    (updater: SortingState | ((previous: SortingState) => SortingState)) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const key = next[0]?.id;
      if (key) onSortChange(key as SortKey);
    },
    [sorting, onSortChange]
  );

  const meta = useMemo(() => ({ cursorId, onAction }), [cursorId, onAction]);

  const table = useTable({
    features: blotterFeatures,
    columns: blotterColumns,
    data: views,
    /* Keyed by trade id so a refetch reuses a row rather than rebuilding it. */
    getRowId: (trade) => trade.id,
    /*
     * The server sorts and pages: this page arrives in its final order, and
     * paging is the footer's, so no pagination feature is registered here.
     */
    manualSorting: true,
    /* A blotter is always sorted by something — there is no third click. */
    enableSortingRemoval: false,
    enableMultiSort: false,
    state: { sorting },
    onSortingChange: handleSortingChange,
    meta
  });

  const columnCount = table.getAllLeafColumns().length;

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="scrollbar-thin overflow-auto">
        <table className="w-full min-w-[1600px] border-collapse text-left">
          <thead className="sticky top-0 z-20 bg-surface-muted">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const column = header.column;
                  const columnMeta = column.columnDef.meta;
                  const sorted = column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        sorted ? (sorted === "asc" ? "ascending" : "descending") : undefined
                      }
                      className={cn(
                        "h-[34px] whitespace-nowrap border-b border-line px-3 text-micro font-semibold uppercase tracking-[0.04em] text-ink-4",
                        columnMeta?.align === "right" && "text-right",
                        stickyHeaderClass(columnMeta?.sticky)
                      )}
                    >
                      {header.isPlaceholder ? null : column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={column.getToggleSortingHandler()}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-xs uppercase transition-colors hover:text-ink-2",
                            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                            sorted && "text-violet"
                          )}
                        >
                          <table.FlexRender header={header} />
                          <SortIndicator direction={sorted} />
                        </button>
                      ) : (
                        <span className="sr-only sm:not-sr-only">
                          <table.FlexRender header={header} />
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          <tbody>
            {state === "loading" &&
              Array.from({ length: 9 }).map((_, row) => (
                <tr key={`skeleton-${row}`} className="border-b border-line-soft">
                  {table.getAllLeafColumns().map((column) => (
                    <td key={column.id} className="h-[34px] px-3">
                      <Skeleton className="h-3 w-full" />
                    </td>
                  ))}
                </tr>
              ))}

            {state === "empty" && (
              <tr>
                <td colSpan={columnCount} className="h-48 text-center align-middle">
                  <p className="text-body-2 font-medium text-ink">No trades match these filters</p>
                  <p className="mt-1 text-cell-2 text-ink-4">
                    {hasFilters
                      ? "Try widening the search, status or side filters."
                      : "No trades have been booked yet."}
                  </p>
                  {hasFilters && (
                    <Button variant="outline" onClick={onClearFilters} className="mt-4 h-8 text-cell-2">
                      Clear filters
                    </Button>
                  )}
                </td>
              </tr>
            )}

            {state === "beyond-end" && (
              <tr>
                <td colSpan={columnCount} className="h-48 text-center align-middle">
                  <p className="text-body-2 font-medium text-ink">Nothing on this page</p>
                  <p className="mt-1 text-cell-2 text-ink-4">
                    There are matching trades, but fewer pages than this one.
                  </p>
                  <Button
                    variant="outline"
                    onClick={onGoToLastPage}
                    className="mt-4 h-8 text-cell-2"
                  >
                    Go to last page
                  </Button>
                </td>
              </tr>
            )}

            {state === "error" && (
              <tr>
                <td colSpan={columnCount} className="h-48 text-center align-middle">
                  <p className="text-body-2 font-medium text-ink">Unable to load trades</p>
                  <p className="mt-1 text-cell-2 text-ink-4">
                    The blotter service did not respond. Data shown may be stale.
                  </p>
                  <Button variant="outline" onClick={onRetry} className="mt-4 h-8 text-cell-2">
                    Retry
                  </Button>
                </td>
              </tr>
            )}

            {state === "ready" &&
              table.getRowModel().rows.map((row) => {
                const trade = row.original;
                const selected = trade.id === selectedId;

                return (
                  <tr
                    key={row.id}
                    /*
                     * A row is a real control: clickable, focusable, and
                     * selectable from the keyboard. Without this, the only way
                     * to reach a row is the j/k cursor, which a screen reader
                     * never announces and a tab user cannot reach at all.
                     */
                    role="row"
                    tabIndex={0}
                    aria-selected={selected}
                    onClick={() => onSelect(trade)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onSelect(trade);
                    }}
                    className={cn(
                      "group h-[34px] cursor-default border-b border-line-soft transition-colors",
                      "focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-ring",
                      selected ? "bg-violet-soft" : "hover:bg-surface-muted",
                      trade.status === "CANCELLED" && "opacity-66"
                    )}
                  >
                    {row.getAllCells().map((cell) => {
                      const columnMeta = cell.column.columnDef.meta;
                      return (
                        <td
                          key={cell.id}
                          className={cn(
                            columnMeta?.cellClassName,
                            columnMeta?.align === "right" && "text-right",
                            stickyCellClass(columnMeta?.sticky),
                            /* A sticky cell scrolls over other rows, so it
                             * cannot inherit the row's background. */
                            columnMeta?.sticky && (selected ? "bg-violet-soft" : "bg-surface")
                          )}
                        >
                          <table.FlexRender cell={cell} />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
