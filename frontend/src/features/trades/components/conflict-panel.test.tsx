import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConflictPanel } from "./conflict-panel";
import type { AmendableField } from "@/features/trades/lib/trade-form";
import type { Trade } from "@/types/trade";

/**
 * Shown when someone else saved while this user was editing. The question the
 * panel has to answer is not "what is different?" but "what am I about to
 * overwrite?" — so these tests are about which fields it says will be sent, and
 * about the count in the sentence a user reads before clicking Reapply.
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
    trader: "b.trader",
    book: "EQ-LDN-1",
    counterparty: "Goldman Sachs",
    tradeTimestamp: "2026-09-11T09:30:00.000Z",
    status: "NEW",
    version: 5,
    createdAt: "2026-09-11T09:30:00.000Z",
    updatedAt: "2026-09-11T11:45:30.000Z",
    ...overrides
  };
}

function renderPanel({
  attempted = {},
  server = {},
  changedFields = ["price"] as AmendableField[],
  openedVersion = 3
}: {
  attempted?: Partial<Trade>;
  server?: Partial<Trade>;
  changedFields?: AmendableField[];
  openedVersion?: number;
} = {}) {
  const onDiscard = vi.fn();
  const onReapply = vi.fn();

  render(
    <ConflictPanel
      attempted={trade(attempted)}
      server={trade(server)}
      openedVersion={openedVersion}
      changedFields={changedFields}
      onDiscard={onDiscard}
      onReapply={onReapply}
    />
  );

  return { onDiscard, onReapply };
}

/** The comparison row for one field, as the user reads it across. */
function row(label: string) {
  const cells = within(screen.getByRole("row", { name: new RegExp(`^${label} `) })).getAllByRole("cell");
  return { mine: cells[1]?.textContent, theirs: cells[2]?.textContent, sends: cells[3]?.textContent };
}

describe("version conflict panel", () => {
  it("names both versions and who moved the trade", () => {
    renderPanel({ server: { version: 5, trader: "b.trader" }, openedVersion: 3 });
    const heading = screen.getByText(/You opened v3\./);
    expect(heading).toHaveTextContent("b.trader saved v5 at 11:45:30");
  });

  it("states plainly that nothing was merged", () => {
    renderPanel();
    expect(screen.getByText(/Nothing was merged — your input is untouched below\./)).toBeInTheDocument();
  });

  it("marks an edited field as sending the user's value", () => {
    renderPanel({ attempted: { price: 13.75 }, changedFields: ["price"] });
    expect(row("Price")).toMatchObject({ mine: "13.75", theirs: "12.50", sends: "yours" });
  });

  /**
   * The reason an amendment sends only edited fields: everything else has to
   * survive the save exactly as the other trader left it.
   */
  it("marks an untouched field as keeping the server's value", () => {
    renderPanel({ server: { quantity: 4000 }, changedFields: ["price"] });
    expect(row("Quantity")).toMatchObject({ theirs: "4,000", sends: "keeps theirs" });
  });

  it("counts only the edits that would actually replace something", () => {
    // Two edits, but the symbol matches what the server already holds.
    renderPanel({
      attempted: { price: 13.75, symbol: "BP.L" },
      server: { symbol: "BP.L" },
      changedFields: ["symbol", "price"]
    });
    expect(screen.getByText(/Reapplying sends only the 2 fields you edited/)).toHaveTextContent(
      "1 of which differs from v5 and would replace it"
    );
  });

  it("says nothing is lost when no edited field differs from the server", () => {
    renderPanel({
      attempted: { price: 13.75 },
      server: { price: 13.75, quantity: 4000 },
      changedFields: ["price"]
    });
    expect(screen.getByText(/so nothing they changed is lost/)).toBeInTheDocument();
  });

  it("uses the singular for a single overwrite", () => {
    renderPanel({ attempted: { price: 13.75 }, changedFields: ["price"] });
    expect(screen.getByText(/1 of which differs from v5/)).toBeInTheDocument();
  });

  /** Status is not amendable, so offering it as a conflict would be noise. */
  it("leaves status out of the comparison entirely", () => {
    renderPanel({ attempted: { status: "NEW" }, server: { status: "CANCELLED" } });
    expect(screen.queryByRole("row", { name: /^Status / })).not.toBeInTheDocument();
  });

  it("compares every amendable field", () => {
    renderPanel();
    for (const label of ["Symbol", "Side", "Quantity", "Price", "Book", "Counterparty", "Trade time"]) {
      expect(screen.getByRole("row", { name: new RegExp(`^${label} `) })).toBeInTheDocument();
    }
  });

  it("formats the figures the way the blotter does, not as raw JSON", () => {
    renderPanel({ attempted: { quantity: 1000000, price: 12.5 } });
    expect(row("Quantity").mine).toBe("1,000,000");
    expect(row("Price").mine).toBe("12.50");
  });

  it("offers both exits and reports which one was taken", async () => {
    const user = userEvent.setup();
    const { onDiscard, onReapply } = renderPanel({ server: { version: 5 } });

    await user.click(screen.getByRole("button", { name: "Reapply onto v5" }));
    expect(onReapply).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Discard my changes" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
})
