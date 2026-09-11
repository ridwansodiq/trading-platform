import { useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import { TopBar } from "@/components/layout/top-bar";
import { AuditDrawer } from "@/features/trades/components/audit-drawer";
import { BlotterFooter } from "@/features/trades/components/blotter-footer";
import { BlotterTable, type RowAction } from "@/features/trades/components/blotter-table";
import { BlotterToolbar } from "@/features/trades/components/blotter-toolbar";
import { ConfirmTransitionDialog } from "@/features/trades/components/confirm-transition-dialog";
import { ExposureStrip } from "@/features/trades/components/exposure-strip";
import { SimulateMenuItem } from "@/features/trades/components/simulate-menu-item";
import { TradeFormDrawer } from "@/features/trades/components/trade-form-drawer";
import { useBlotterQueryState } from "@/features/trades/hooks/use-blotter-query-state";
import { useRowCursor } from "@/features/trades/hooks/use-row-cursor";
import { useTradeStream } from "@/features/trades/hooks/use-trade-stream";
import { useTradeDialogs } from "@/features/trades/hooks/use-trade-dialogs";
import { useTradeForm } from "@/features/trades/hooks/use-trade-form";
import { useTradeExposure, useTrades } from "@/features/trades/hooks/use-trades";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useTheme } from "@/hooks/use-theme";
import type { SessionUser, TradeView } from "@/types/trade";

const PAGE_SIZE = 25;

type Props = {
  user: SessionUser;
  onSignOut: () => void;
  onSessionExpired: () => void;
};

/**
 * Blotter composition.
 *
 * The four concerns that used to sit here as a dozen `useState` calls now live
 * in their own hooks — what the user is looking at, where the keyboard cursor
 * is, what they are in the middle of doing, and what the stream is telling us —
 * leaving this component to wire them to the layout.
 */
export function BlotterScreen({ user, onSignOut, onSessionExpired }: Props) {
  const { theme, toggleTheme } = useTheme();
  const query = useBlotterQueryState();
  const form = useTradeForm();
  const dialogs = useTradeDialogs();
  const searchRef = useRef<HTMLInputElement>(null);

  const { views, total, tableState, isFetching, refetch } = useTrades(
    query.filters,
    query.sort,
    query.page,
    PAGE_SIZE,
    true
  );
  const { exposure } = useTradeExposure(query.filters, true);
  const cursor = useRowCursor(views);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const goToLastPage = useCallback(() => query.setPage(pageCount), [query, pageCount]);

  const openTradeId = form.mode?.kind === "amend" ? form.mode.trade.id : null;

  const stream = useTradeStream({
    enabled: true,
    onRemoteUpdate: useCallback(
      (event) => {
        if (event.trade.id !== openTradeId) return;
        // Never overwrite an open form; warn instead.
        toast.warning(`${event.trade.tradeId} changed on the server`, {
          description: `It is now v${event.trade.version}. Your input has been preserved.`
        });
      },
      [openTradeId]
    ),
    onSessionExpired
  });

  /**
   * The stream is a notification channel, not an authorisation one.
   *
   * Commands go over REST, which is unaffected by a stream a proxy has closed,
   * so a dropped connection must not disable the desk. It only means the table
   * may be behind, which the connection indicator already says.
   */
  const isStale = stream.connection !== "live";

  /** The version SSE last reported for the trade being amended, if it is newer. */
  const staleVersion = useMemo(() => {
    if (form.mode?.kind !== "amend") return null;
    const seen = stream.latestVersions[form.mode.trade.id];
    return seen !== undefined && seen > form.mode.trade.version ? seen : null;
  }, [form.mode, stream.latestVersions]);

  /*
   * Taken off the hooks by name rather than used through them, so this callback
   * depends on three stable functions instead of two objects rebuilt on every
   * render — the table's row handlers then survive a re-render from the stream.
   */
  const { openAudit, startTransition } = dialogs;
  const { startAmend } = form;

  const runAction = useCallback(
    (action: RowAction, trade: TradeView) => {
      if (action === "audit") {
        openAudit(trade);
        return;
      }
      if (trade.status !== "NEW") {
        toast.warning(`Action unavailable · ${trade.tradeId} · ${trade.status}`);
        return;
      }
      if (action === "amend") {
        startAmend(trade);
        return;
      }
      startTransition(action, trade);
    },
    [openAudit, startAmend, startTransition]
  );

  useHotkeys(
    {
      j: () => cursor.move(1),
      arrowdown: () => cursor.move(1),
      k: () => cursor.move(-1),
      arrowup: () => cursor.move(-1),
      n: () => form.startCreate(),
      a: () => cursor.cursorTrade && runAction("amend", cursor.cursorTrade),
      e: () => cursor.cursorTrade && runAction("execute", cursor.cursorTrade),
      c: () => cursor.cursorTrade && runAction("cancel", cursor.cursorTrade),
      h: () => cursor.cursorTrade && runAction("audit", cursor.cursorTrade),
      "/": () => searchRef.current?.focus()
    },
    !form.isOpen && !dialogs.isOpen
  );

  return (
    <div className="flex min-h-screen flex-col bg-bg-page">
      <TopBar
        user={user}
        connection={stream.connection}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSignOut={onSignOut}
        menuItems={<SimulateMenuItem />}
      />

      <ExposureStrip
        exposure={exposure}
        connection={stream.connection}
        lastUpdateAt={stream.lastUpdateAt}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-3.5">
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <BlotterToolbar
            filters={query.filters}
            onFiltersChange={query.updateFilters}
            onClearFilters={query.clearFilters}
            hasFilters={query.hasFilters}
            statusCounts={exposure.statusCounts}
            totalInScope={exposure.tradesInScope}
            isFetching={isFetching}
            isStale={isStale}
            onRefresh={refetch}
            onNewTrade={form.startCreate}
            searchRef={searchRef}
          />

          <BlotterTable
            views={views}
            state={tableState}
            sort={query.sort}
            onSortChange={query.toggleSort}
            selectedId={cursor.selectedId}
            cursorId={cursor.cursorId}
            onSelect={cursor.select}
            onAction={runAction}
            hasFilters={query.hasFilters}
            onClearFilters={query.clearFilters}
            onRetry={refetch}
            onGoToLastPage={goToLastPage}
          />

          <BlotterFooter
            page={query.page}
            pageSize={PAGE_SIZE}
            total={total}
            rowsOnPage={views.length}
            selectedRef={views.find((view) => view.id === cursor.selectedId)?.tradeId ?? null}
            onPageChange={query.setPage}
          />
        </div>
      </main>

      <TradeFormDrawer
        mode={form.mode}
        values={form.values}
        onChange={form.setValues}
        changed={form.changed}
        user={user}
        pending={form.pending}
        conflict={form.conflict}
        submitError={form.submitError}
        errors={form.errors}
        staleVersion={staleVersion}
        onSubmit={() => void form.submit()}
        onClose={form.close}
        onDiscardConflict={form.discardConflict}
        onReapplyConflict={form.reapplyConflict}
      />

      <ConfirmTransitionDialog
        kind={dialogs.confirm?.kind ?? null}
        trade={dialogs.confirm?.trade ?? null}
        pending={dialogs.transitionPending}
        onConfirm={dialogs.confirmTransition}
        onClose={dialogs.closeConfirm}
      />

      <AuditDrawer trade={dialogs.auditTrade} onClose={dialogs.closeAudit} />
    </div>
  );
}
