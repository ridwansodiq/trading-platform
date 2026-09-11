import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BlotterTable } from "./blotter-table";
import { toTradeViews } from "@/features/trades/lib/trade-view";
import type { Trade, TradeView } from "@/types/trade";

/**
 * The table is headless-driven, so the things worth pinning down are the ones
 * the column definitions and the header wiring own: which key a header reports,
 * that a derived column shows its computed value rather than a stored one, and
 * that the placeholder states still span the full row.
 */

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    tradeId: "TRD-0001",
    symbol: "VOD.L",
    side: "BUY",
    quantity: 1000,
    price: 12.5,
    traderUserId: "22222222-2222-4222-8222-222222222222",
    trader: "A. Trader",
    book: "EQ-LDN-1",
    counterparty: "Goldman Sachs",
    tradeTimestamp: "2026-09-11T09:30:00.000Z",
    status: "NEW",
    version: 1,
    createdAt: "2026-09-11T09:30:00.000Z",
    updatedAt: "2026-09-11T09:30:00.000Z",
    ...overrides
  };
}

function renderTable(overrides: Partial<Parameters<typeof BlotterTable>[0]> = {}) {
  const onSortChange = vi.fn();
  const onSelect = vi.fn();
  const onAction = vi.fn();
  const views: TradeView[] = toTradeViews([trade()]);

  render(
    <BlotterTable
      views={views}
      state="ready"
      sort={{ key: "tradeTimestamp", direction: "desc" }}
      onSortChange={onSortChange}
      selectedId={null}
      cursorId={null}
      onSelect={onSelect}
      onAction={onAction}
      hasFilters={false}
      onClearFilters={vi.fn()}
      onRetry={vi.fn()}
      onGoToLastPage={vi.fn()}
      {...overrides}
    />
  );

  return { onSortChange, onSelect, onAction, views };
}

describe("blotter table", () => {
  it("renders derived columns from the view, not the stored trade", () => {
    renderTable();
    // 1000 * 12.50, then the same figures signed for a BUY.
    expect(screen.getByText("12,500.00")).toBeInTheDocument();
    expect(screen.getByText("+1,000")).toBeInTheDocument();
    expect(screen.getByText("+12,500.00")).toBeInTheDocument();
  });

  it("reports the column key on a header toggle and leaves the direction to the caller", async () => {
    const { onSortChange } = renderTable();
    await userEvent.click(screen.getByRole("button", { name: "Notional" }));
    expect(onSortChange).toHaveBeenCalledExactlyOnceWith("notional");
  });

  it("marks only the sorted column for assistive technology", () => {
    renderTable({ sort: { key: "symbol", direction: "asc" } });
    expect(screen.getByRole("columnheader", { name: /Symbol/ })).toHaveAttribute(
      "aria-sort",
      "ascending"
    );
    expect(screen.getByRole("columnheader", { name: /Price/ })).not.toHaveAttribute("aria-sort");
  });

  it("does not offer sorting on the actions column", () => {
    renderTable();
    expect(screen.queryByRole("button", { name: "Actions" })).not.toBeInTheDocument();
  });

  it("selects the trade behind a clicked row", async () => {
    const { onSelect, views } = renderTable();
    await userEvent.click(screen.getByText("TRD-0001"));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(views[0]);
  });

  it("keeps lifecycle actions off a terminal trade but still offers its history", async () => {
    const cancelled = toTradeViews([trade({ status: "CANCELLED" })]);
    const { onAction } = renderTable({ views: cancelled });

    await userEvent.click(screen.getByRole("button", { name: "Actions for TRD-0001" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Cancelled trades cannot be changed.")).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Amend" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );

    await userEvent.click(within(menu).getByRole("menuitem", { name: "Audit history" }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith("audit", cancelled[0]);
  });

  it("spans every column with the empty state", () => {
    renderTable({ state: "empty", views: [] });
    const cell = screen.getByText("No trades match these filters").closest("td");
    expect(cell).toHaveAttribute("colspan", "15");
  });
});
