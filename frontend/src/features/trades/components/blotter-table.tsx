import { Check, ChevronDown, ChevronUp, Clock3, MoreHorizontal, Pencil, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { SideTag, SignedValue, StatusPill } from "@/features/trades/components/trade-badges";
import { formatPrice, formatQuantity, formatTradeTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SortKey, TableState, TradeSort, TradeView } from "@/types/trade";

export type RowAction = "amend" | "execute" | "cancel" | "audit";

type Column = {
  key: SortKey | null;
  label: string;
  align?: "right";
  className?: string;
};

/** Column order and alignment come straight from the design's table spec. */
const COLUMNS: readonly Column[] = [
  { key: "tradeId", label: "Trade ID" },
  { key: "symbol", label: "Symbol" },
  { key: "side", label: "Side" },
  { key: "quantity", label: "Quantity", align: "right" },
  { key: "price", label: "Price", align: "right" },
  { key: "notional", label: "Notional", align: "right" },
  { key: "signedQuantity", label: "Signed Qty", align: "right" },
  { key: "signedNotional", label: "Signed Notional", align: "right" },
  { key: "trader", label: "Trader" },
  { key: "book", label: "Book" },
  { key: "counterparty", label: "Counterparty" },
  { key: "tradeTimestamp", label: "Trade Time" },
  { key: "status", label: "Status" },
  { key: "version", label: "Version", align: "right" },
  { key: null, label: "Actions", align: "right" }
];

type Props = {
  views: readonly TradeView[];
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

function SortIndicator({ active, direction }: { active: boolean; direction: TradeSort["direction"] }) {
  if (!active) return null;
  const Icon = direction === "asc" ? ChevronUp : ChevronDown;
  return <Icon size={12} className="text-violet" aria-hidden />;
}

function RowActionsMenu({
  trade,
  reason,
  blocked,
  onAction
}: {
  trade: TradeView;
  /** Why the lifecycle actions are unavailable, or null when they are. */
  reason: string | null;
  blocked: boolean;
  onAction: (action: RowAction, trade: TradeView) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Actions for ${trade.tradeId}`}
          title={`Actions for ${trade.tradeId}`}
          className="size-[26px] text-ink-4 hover:bg-surface-muted-2 hover:text-ink data-[state=open]:bg-surface-muted-2 data-[state=open]:text-ink"
        >
          <MoreHorizontal size={15} />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-52">
        {/* Stated once at the top rather than repeated on each disabled row. */}
        {reason && (
          <>
            <DropdownMenuLabel className="text-mini-2 font-normal text-ink-5">
              {reason}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}

        <DropdownMenuItem
          disabled={blocked}
          onSelect={() => onAction("amend", trade)}
          className="text-cell-2"
        >
          <Pencil size={13} />
          Amend
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={blocked}
          onSelect={() => onAction("execute", trade)}
          className="text-cell-2"
        >
          <Check size={14} />
          Execute
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={blocked}
          variant="destructive"
          onSelect={() => onAction("cancel", trade)}
          className="text-cell-2"
        >
          <X size={14} />
          Cancel
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Audit is always available, including for terminal trades. */}
        <DropdownMenuItem onSelect={() => onAction("audit", trade)} className="text-cell-2">
          <Clock3 size={13} />
          Audit history
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="scrollbar-thin overflow-auto">
        <table className="w-full min-w-[1600px] border-collapse text-left">
          <thead className="sticky top-0 z-20 bg-surface-muted">
            <tr>
              {COLUMNS.map((column, index) => {
                const active = column.key !== null && sort.key === column.key;
                const sortable = column.key !== null;
                return (
                  <th
                    key={column.label}
                    scope="col"
                    aria-sort={
                      active ? (sort.direction === "asc" ? "ascending" : "descending") : undefined
                    }
                    className={cn(
                      "h-[34px] whitespace-nowrap border-b border-line px-3 text-micro font-semibold uppercase tracking-[0.04em] text-ink-4",
                      column.align === "right" && "text-right",
                      index === 0 && "sticky left-0 z-30 bg-surface-muted",
                      index === COLUMNS.length - 1 &&
                        "sticky right-0 z-30 bg-surface-muted shadow-[-2px_0_0_0_var(--line-soft)]"
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => onSortChange(column.key as SortKey)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-xs uppercase transition-colors hover:text-ink-2",
                          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                          active && "text-violet"
                        )}
                      >
                        {column.label}
                        <SortIndicator active={active} direction={sort.direction} />
                      </button>
                    ) : (
                      <span className="sr-only sm:not-sr-only">{column.label}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {state === "loading" &&
              Array.from({ length: 9 }).map((_, row) => (
                <tr key={`skeleton-${row}`} className="border-b border-line-soft">
                  {COLUMNS.map((column) => (
                    <td key={column.label} className="h-[34px] px-3">
                      <Skeleton className="h-3 w-full" />
                    </td>
                  ))}
                </tr>
              ))}

            {state === "empty" && (
              <tr>
                <td colSpan={COLUMNS.length} className="h-48 text-center align-middle">
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
                <td colSpan={COLUMNS.length} className="h-48 text-center align-middle">
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
                <td colSpan={COLUMNS.length} className="h-48 text-center align-middle">
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
              views.map((view) => {
                const selected = view.id === selectedId;
                const terminal = view.status !== "NEW";
                // Reads as a standalone sentence at the top of the actions menu.
                const reason = terminal
                  ? `${view.status.charAt(0)}${view.status.slice(1).toLowerCase()} trades cannot be changed.`
                  : null;

                return (
                  <tr
                    key={view.id}
                    /*
                     * A row is a real control: clickable, focusable, and
                     * selectable from the keyboard. Without this, the only way
                     * to reach a row is the j/k cursor, which a screen reader
                     * never announces and a tab user cannot reach at all.
                     */
                    role="row"
                    tabIndex={0}
                    aria-selected={selected}
                    onClick={() => onSelect(view)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onSelect(view);
                    }}
                    className={cn(
                      "group h-[34px] cursor-default border-b border-line-soft transition-colors",
                      "focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-ring",
                      selected ? "bg-violet-soft" : "hover:bg-surface-muted",
                      view.status === "CANCELLED" && "opacity-66"
                    )}
                  >
                    <td
                      className={cn(
                        "relative whitespace-nowrap px-3 font-mono text-cell text-ink-2",
                        STICKY_LEFT_CELL,
                        selected ? "bg-violet-soft" : "bg-surface"
                      )}
                    >
                      {view.id === cursorId && (
                        <span className="absolute left-0 top-0 h-full w-0.5 bg-violet" aria-hidden />
                      )}
                      {view.tradeId}
                    </td>
                    <td className="whitespace-nowrap px-3 text-cell-2 font-semibold text-ink">
                      {view.symbol}
                    </td>
                    <td className="px-3">
                      <SideTag side={view.side} />
                    </td>
                    <td className="px-3 text-right font-mono text-cell tabular-nums text-ink-2">
                      {formatQuantity(view.quantity)}
                    </td>
                    <td className="px-3 text-right font-mono text-cell tabular-nums text-ink-2">
                      {formatPrice(view.price)}
                    </td>
                    <td className="px-3 text-right font-mono text-cell tabular-nums text-ink">
                      {view.notional}
                    </td>
                    <td className="px-3 text-right text-cell">
                      <SignedValue value={view.signedQuantityValue} formatted={view.signedQuantity} />
                    </td>
                    <td className="px-3 text-right text-cell">
                      <SignedValue value={view.signedNotionalValue} formatted={view.signedNotional} />
                    </td>
                    <td className="whitespace-nowrap px-3 text-cell-2 text-ink-2">{view.trader}</td>
                    <td className="whitespace-nowrap px-3 font-mono text-mini-2 text-ink-3">
                      {view.book}
                    </td>
                    <td className="max-w-[170px] truncate px-3 text-cell-2 text-ink-2">
                      {view.counterparty}
                    </td>
                    <td className="whitespace-nowrap px-3 font-mono text-mini-2 text-ink-4">
                      {formatTradeTimestamp(view.tradeTimestamp)}
                    </td>
                    <td className="px-3">
                      <StatusPill status={view.status} />
                    </td>
                    <td className="px-3 text-right font-mono text-cell tabular-nums text-ink-4">
                      v{view.version}
                    </td>
                    <td
                      className={cn(
                        "px-2",
                        STICKY_RIGHT_CELL,
                        selected ? "bg-violet-soft" : "bg-surface"
                      )}
                    >
                      <div
                        className="flex items-center justify-end"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <RowActionsMenu
                          trade={view}
                          reason={reason}
                          blocked={terminal}
                          onAction={onAction}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
