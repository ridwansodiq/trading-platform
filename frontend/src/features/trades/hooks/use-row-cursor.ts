import { useCallback, useState } from "react";
import type { TradeView } from "@/types/trade";

export type RowCursor = {
  /** The row keyboard actions apply to. */
  cursorId: string | null;
  cursorTrade: TradeView | null;
  /** The row the user last clicked, shown in the footer. */
  selectedId: string | null;
  select: (trade: TradeView) => void;
  move: (delta: number) => void;
};

/**
 * Keyboard cursor and click selection over the visible rows.
 *
 * Both are held by trade id rather than row index, so a refetch that reorders
 * or repages the table moves the cursor with its trade instead of leaving it
 * pointing at whatever now occupies that position.
 */
export function useRowCursor(views: readonly TradeView[]): RowCursor {
  const [rawCursorId, setCursorId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /*
   * The cursor is derived, not synchronised. If its trade has left the current
   * view — a filter, a sort, a new page — it simply reads as absent. An effect
   * that reset the stored id instead would render one frame pointing at a row
   * that is no longer there.
   */
  const cursorTrade = views.find((view) => view.id === rawCursorId) ?? null;
  const cursorId = cursorTrade?.id ?? null;

  /** Move by whole rows, entering from the appropriate end. */
  const move = useCallback(
    (delta: number) => {
      setCursorId((current) => {
        if (views.length === 0) return null;
        const from = current ? views.findIndex((view) => view.id === current) : -1;
        const next =
          from < 0
            ? delta > 0
              ? 0
              : views.length - 1
            : Math.min(Math.max(from + delta, 0), views.length - 1);
        return views[next]?.id ?? null;
      });
    },
    [views]
  );

  const select = useCallback((trade: TradeView) => {
    setSelectedId(trade.id);
    setCursorId(trade.id);
  }, []);

  return { cursorId, cursorTrade, selectedId, select, move };
}
