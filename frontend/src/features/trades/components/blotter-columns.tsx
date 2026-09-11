import { Check, Clock3, MoreHorizontal, Pencil, X } from "lucide-react";
import {
  createColumnHelper,
  metaHelper,
  rowSortingFeature,
  tableFeatures
} from "@tanstack/react-table";
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
import type { TradeView } from "@/types/trade";

export type RowAction = "amend" | "execute" | "cancel" | "audit";

/**
 * Per-column presentation the table's markup applies, rather than the cell:
 * alignment belongs to the header as much as the body, and a sticky column
 * needs its background painted by whoever knows the row is selected.
 */
export type BlotterColumnMeta = {
  align?: "right";
  sticky?: "left" | "right";
  cellClassName?: string;
};

/**
 * What a cell needs from the blotter but cannot read from its own row.
 * `cursorId` is one row's worth of state, so it is not duplicated onto every
 * row's data.
 */
export type BlotterTableMeta = {
  cursorId: string | null;
  onAction: (action: RowAction, trade: TradeView) => void;
};

/**
 * Only sorting is registered, and only so the header can express it: the server
 * orders every matching trade, including the derived columns, so the table is
 * handed a page that is already in order (`manualSorting`). Filtering and
 * paging are likewise the server's, and live in the toolbar and footer.
 */
export const blotterFeatures = tableFeatures({
  rowSortingFeature,
  columnMeta: metaHelper<BlotterColumnMeta>(),
  tableMeta: metaHelper<BlotterTableMeta>()
});

const helper = createColumnHelper<typeof blotterFeatures, TradeView>();

function RowActionsMenu({
  trade,
  onAction
}: {
  trade: TradeView;
  onAction: (action: RowAction, trade: TradeView) => void;
}) {
  const blocked = trade.status !== "NEW";
  // Reads as a standalone sentence at the top of the actions menu.
  const reason = blocked
    ? `${trade.status.charAt(0)}${trade.status.slice(1).toLowerCase()} trades cannot be changed.`
    : null;

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

/**
 * Column order, alignment and sort keys come straight from the design's table
 * spec. Every accessor key is also a `TradeSortKey`, so a header hands the
 * column's own id back to the query state and no second mapping can drift.
 */
export const blotterColumns = helper.columns([
  helper.accessor("tradeId", {
    header: "Trade ID",
    meta: {
      sticky: "left",
      cellClassName: "relative whitespace-nowrap px-3 font-mono text-cell text-ink-2"
    },
    cell: ({ row, getValue, table }) => (
      <>
        {row.original.id === table.options.meta?.cursorId && (
          <span className="absolute left-0 top-0 h-full w-0.5 bg-violet" aria-hidden />
        )}
        {getValue()}
      </>
    )
  }),
  helper.accessor("symbol", {
    header: "Symbol",
    meta: { cellClassName: "whitespace-nowrap px-3 text-cell-2 font-semibold text-ink" }
  }),
  helper.accessor("side", {
    header: "Side",
    meta: { cellClassName: "px-3" },
    cell: ({ getValue }) => <SideTag side={getValue()} />
  }),
  helper.accessor("quantity", {
    header: "Quantity",
    meta: { align: "right", cellClassName: "px-3 font-mono text-cell tabular-nums text-ink-2" },
    cell: ({ getValue }) => formatQuantity(getValue())
  }),
  helper.accessor("price", {
    header: "Price",
    meta: { align: "right", cellClassName: "px-3 font-mono text-cell tabular-nums text-ink-2" },
    cell: ({ getValue }) => formatPrice(getValue())
  }),
  helper.accessor("notional", {
    header: "Notional",
    meta: { align: "right", cellClassName: "px-3 font-mono text-cell tabular-nums text-ink" }
  }),
  helper.accessor("signedQuantity", {
    header: "Signed Qty",
    meta: { align: "right", cellClassName: "px-3 text-cell" },
    cell: ({ row, getValue }) => (
      <SignedValue value={row.original.signedQuantityValue} formatted={getValue()} />
    )
  }),
  helper.accessor("signedNotional", {
    header: "Signed Notional",
    meta: { align: "right", cellClassName: "px-3 text-cell" },
    cell: ({ row, getValue }) => (
      <SignedValue value={row.original.signedNotionalValue} formatted={getValue()} />
    )
  }),
  helper.accessor("trader", {
    header: "Trader",
    meta: { cellClassName: "whitespace-nowrap px-3 text-cell-2 text-ink-2" }
  }),
  helper.accessor("book", {
    header: "Book",
    meta: { cellClassName: "whitespace-nowrap px-3 font-mono text-mini-2 text-ink-3" }
  }),
  helper.accessor("counterparty", {
    header: "Counterparty",
    meta: { cellClassName: "max-w-[170px] truncate px-3 text-cell-2 text-ink-2" }
  }),
  helper.accessor("tradeTimestamp", {
    header: "Trade Time",
    meta: { cellClassName: "whitespace-nowrap px-3 font-mono text-mini-2 text-ink-4" },
    cell: ({ getValue }) => formatTradeTimestamp(getValue())
  }),
  helper.accessor("status", {
    header: "Status",
    meta: { cellClassName: "px-3" },
    cell: ({ getValue }) => <StatusPill status={getValue()} />
  }),
  helper.accessor("version", {
    header: "Version",
    meta: { align: "right", cellClassName: "px-3 font-mono text-cell tabular-nums text-ink-4" },
    cell: ({ getValue }) => `v${getValue()}`
  }),
  helper.display({
    id: "actions",
    header: "Actions",
    enableSorting: false,
    meta: { align: "right", sticky: "right", cellClassName: "px-2" },
    cell: ({ row, table }) => (
      <div
        className="flex items-center justify-end"
        // A menu click is not a row selection.
        onClick={(event) => event.stopPropagation()}
      >
        <RowActionsMenu
          trade={row.original}
          onAction={(action, trade) => table.options.meta?.onAction(action, trade)}
        />
      </div>
    )
  })
]);
