import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmTransitionDialog, type TransitionKind } from "./confirm-transition-dialog";
import { toTradeView } from "@/features/trades/lib/trade-view";
import type { Trade, TradeView } from "@/types/trade";

/**
 * Execute and cancel are both terminal and neither can be undone, so the only
 * thing standing between a mis-click and an irreversible write is this dialog.
 * What it must do is restate the consequence and the economics of the specific
 * trade — a confirmation that says "are you sure?" and nothing else is no
 * safeguard at all.
 */

function view(overrides: Partial<Trade> = {}): TradeView {
  return toTradeView({
    id: "11111111-1111-4111-8111-111111111111",
    tradeId: "TRD-0042",
    symbol: "VOD.L",
    side: "BUY",
    quantity: 250000,
    price: 12.5,
    traderUserId: "22222222-2222-4222-8222-222222222222",
    trader: "a.trader",
    book: "EQ-LDN-1",
    counterparty: "Goldman Sachs",
    tradeTimestamp: "2026-09-11T09:30:00.000Z",
    status: "NEW",
    version: 3,
    createdAt: "2026-09-11T09:30:00.000Z",
    updatedAt: "2026-09-11T09:30:00.000Z",
    ...overrides
  });
}

function renderDialog(
  overrides: {
    kind?: TransitionKind | null;
    trade?: TradeView | null;
    pending?: boolean;
  } = {}
) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  const { kind = "execute", trade = view(), pending = false } = overrides;

  render(
    <ConfirmTransitionDialog
      kind={kind}
      trade={trade}
      pending={pending}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );

  return { onConfirm, onClose };
}

describe("confirming a terminal transition", () => {
  it("stays closed until a trade and a kind are both supplied", () => {
    renderDialog({ kind: null, trade: null });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays closed when a kind arrives without a trade", () => {
    renderDialog({ trade: null });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("spells out that execution cannot be undone", () => {
    renderDialog({ kind: "execute" });
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Execution is terminal. The trade moves to EXECUTED and can no longer be amended or cancelled."
    );
  });

  it("spells out that cancellation cannot be undone", () => {
    renderDialog({ kind: "cancel" });
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Cancellation is terminal. The trade moves to CANCELLED and cannot be reinstated or amended."
    );
  });

  it.each([
    ["execute", "Execute trade"],
    ["cancel", "Cancel trade"]
  ] as const)("titles and labels the %s dialog for the action", (kind, label) => {
    renderDialog({ kind });
    expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  });

  /**
   * The confirmation is only meaningful if it identifies the trade — the user
   * reached it from a row that may not still be the one they think it is.
   */
  it("restates the economics of the trade being acted on", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");

    expect(dialog).toHaveTextContent("TRD-0042");
    expect(dialog).toHaveTextContent("VOD.L");
    expect(dialog).toHaveTextContent("BUY");
    expect(dialog).toHaveTextContent("250,000");
    expect(dialog).toHaveTextContent("12.50");
    // 250,000 × 12.50, formatted the way the blotter column is.
    expect(dialog).toHaveTextContent("3,125,000.00");
  });

  it("offers a way out that is not the destructive action", async () => {
    const user = userEvent.setup();
    const { onClose, onConfirm } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Keep as is" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("closes on escape without executing anything", async () => {
    const user = userEvent.setup();
    const { onClose, onConfirm } = renderDialog();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("reports the confirmation once", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog({ kind: "cancel" });

    await user.click(screen.getByRole("button", { name: "Cancel trade" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  /** A second click while the first request is in flight would send it twice. */
  it("locks both controls while the request is in flight", () => {
    renderDialog({ pending: true });
    expect(screen.getByRole("button", { name: "Execute trade" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep as is" })).toBeDisabled();
  });

  it("cannot be double-submitted while pending", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog({ pending: true });

    await user.click(screen.getByRole("button", { name: "Execute trade" }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
})
