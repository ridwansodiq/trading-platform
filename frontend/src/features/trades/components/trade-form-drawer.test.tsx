import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { TradeFormDrawer } from "./trade-form-drawer";
import { toTradeView } from "@/features/trades/lib/trade-view";
import type { FormValues } from "@/features/trades/lib/trade-form";
import type { VersionConflict } from "@/features/trades/hooks/use-trade-mutations";
import type { TradeFormMode } from "@/features/trades/hooks/use-trade-form";
import type { SessionUser, Trade } from "@/types/trade";

/** The book/counterparty pickers search server-side; the drawer is not the place to exercise that. */
vi.mock("@/api/generated/endpoints/trades/trades", () => ({
  listTradeFilterOptions: vi.fn().mockResolvedValue({ status: 200, data: { values: [], hasMore: false } })
}));

/**
 * The drawer is fully controlled — values, dirty fields and errors all arrive
 * as props — which is what makes an incoming SSE re-render unable to disturb
 * what someone has typed. So what is worth testing is the reporting: that every
 * field's error reaches the user and the assistive tree, that "edited" marks
 * only what an amendment will actually send, and that the derived notional the
 * user checks before saving tracks their input.
 */

const USER: SessionUser = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "alex.trader@fusion.example",
  displayName: "Alex Trader",
  desk: "EQ-LDN"
};

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    tradeId: "TRD-0001",
    symbol: "VOD.L",
    side: "BUY",
    quantity: 1000,
    price: 12.5,
    traderUserId: USER.id,
    trader: "a.trader",
    book: "EQ-LDN-1",
    counterparty: "Goldman Sachs",
    tradeTimestamp: "2026-09-11T09:30:00.000Z",
    status: "NEW",
    version: 3,
    createdAt: "2026-09-11T09:30:00.000Z",
    updatedAt: "2026-09-11T09:30:00.000Z",
    ...overrides
  };
}

const VALUES: FormValues = {
  symbol: "VOD.L",
  side: "BUY",
  quantity: "1000",
  price: "12.5",
  book: "EQ-LDN-1",
  counterparty: "Goldman Sachs",
  tradeTimestamp: "2026-09-11T09:30:00"
};

type Overrides = Partial<Parameters<typeof TradeFormDrawer>[0]>;

function renderDrawer(overrides: Overrides = {}) {
  const onChange = vi.fn();
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  const onDiscardConflict = vi.fn();
  const onReapplyConflict = vi.fn();

  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TradeFormDrawer
        mode={{ kind: "create" }}
        values={VALUES}
        onChange={onChange}
        changed={[]}
        user={USER}
        pending={false}
        conflict={null}
        submitError={null}
        errors={{}}
        staleVersion={null}
        onSubmit={onSubmit}
        onClose={onClose}
        onDiscardConflict={onDiscardConflict}
        onReapplyConflict={onReapplyConflict}
        {...overrides}
      />
    </QueryClientProvider>
  );

  return { onChange, onSubmit, onClose, onDiscardConflict, onReapplyConflict };
}

const amendMode = (overrides: Partial<Trade> = {}): TradeFormMode => ({
  kind: "amend",
  trade: toTradeView(trade(overrides))
});

describe("opening the drawer", () => {
  it("stays closed with no mode", () => {
    renderDrawer({ mode: null });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("presents a booking as a new trade at v1", () => {
    renderDrawer();
    expect(screen.getByRole("heading", { name: "New trade" })).toBeInTheDocument();
    expect(screen.getByText("Booked as NEW · version v1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Book trade" })).toBeInTheDocument();
  });

  /** The version matters: it is what the amendment will be submitted against. */
  it("names the trade and the version an amendment will be based on", () => {
    renderDrawer({ mode: amendMode({ version: 4 }) });
    expect(screen.getByRole("heading", { name: "Amend trade" })).toBeInTheDocument();
    expect(screen.getByText("TRD-0001 · current version v4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save amendment" })).toBeInTheDocument();
  });

  it("shows the signed-in user as the trader, with no way to pick another", () => {
    renderDrawer();
    expect(screen.getByText("Alex Trader")).toBeInTheDocument();
    expect(screen.getByText("Signed-in user")).toBeInTheDocument();
    // Trader is derived from the session server-side; a control here would imply otherwise.
    expect(screen.queryByRole("combobox", { name: /trader/i })).not.toBeInTheDocument();
  });
});

describe("editing the form", () => {
  it("reports each keystroke up rather than holding its own copy", async () => {
    const user = userEvent.setup();
    const { onChange } = renderDrawer();

    await user.type(screen.getByLabelText("Quantity"), "5");
    expect(onChange).toHaveBeenCalledWith({ ...VALUES, quantity: "10005" });
  });

  it("upper-cases a symbol as it is typed", async () => {
    const user = userEvent.setup();
    const { onChange } = renderDrawer({ values: { ...VALUES, symbol: "" } });

    await user.type(screen.getByLabelText("Symbol"), "b");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ symbol: "B" }));
  });

  it("switches side through a pressed-state toggle", async () => {
    const user = userEvent.setup();
    const { onChange } = renderDrawer();

    expect(screen.getByRole("button", { name: "BUY" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "SELL" })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "SELL" }));
    expect(onChange).toHaveBeenCalledWith({ ...VALUES, side: "SELL" });
  });

  it("submits through the form, so enter in a field saves", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDrawer();

    await user.click(screen.getByLabelText("Quantity"));
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("the notional preview", () => {
  it("shows the working and the result of the multiplication", () => {
    renderDrawer({ values: { ...VALUES, quantity: "250000", price: "12.5" } });
    expect(screen.getByText("250,000 × 12.5")).toBeInTheDocument();
    expect(screen.getByText("3,125,000.00")).toBeInTheDocument();
  });

  it.each([
    ["a price that is not a number", { price: "12.5.5" }],
    ["an empty quantity", { quantity: "" }],
    ["a non-numeric quantity", { quantity: "1e" }],
    ["a zero price", { price: "0" }],
    ["a negative quantity", { quantity: "-100" }]
  ])("asks for input rather than showing a figure for %s", (_label, patch) => {
    renderDrawer({ values: { ...VALUES, ...patch } });
    expect(screen.getByText("Enter a quantity and price.")).toBeInTheDocument();
  });
});

describe("reporting problems", () => {
  it("puts each message under its own field", () => {
    renderDrawer({
      errors: {
        symbol: "Symbol is required.",
        quantity: "Quantity is required.",
        price: "Price supports at most 4 decimal places.",
        book: "Book is required.",
        counterparty: "Counterparty is required.",
        tradeTimestamp: "Trade time is required."
      }
    });

    for (const message of [
      "Symbol is required.",
      "Quantity is required.",
      "Price supports at most 4 decimal places.",
      "Book is required.",
      "Counterparty is required.",
      "Trade time is required."
    ]) {
      expect(screen.getByText(message)).toBeInTheDocument();
    }
  });

  it("marks the offending inputs invalid for assistive technology", () => {
    renderDrawer({ errors: { quantity: "Quantity is required." } });
    expect(screen.getByLabelText("Quantity")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Price")).not.toHaveAttribute("aria-invalid", "true");
  });

  it("announces a rejected submission and says nothing was written", () => {
    renderDrawer({ submitError: "The blotter service rejected this submission." });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The blotter service rejected this submission."
    );
  });

  it("warns that a newer version arrived without overwriting the form", () => {
    renderDrawer({ mode: amendMode(), staleVersion: 7, values: { ...VALUES, price: "99" } });

    expect(screen.getByRole("status")).toHaveTextContent("A newer version (v7) arrived");
    // The whole point of the warning is that their number is still there.
    expect(screen.getByLabelText("Price")).toHaveValue("99");
  });
});

describe("a version conflict", () => {
  const conflict: VersionConflict = {
    expectedVersion: 3,
    currentVersion: 5,
    currentTrade: trade({ version: 5, quantity: 4000, trader: "b.trader" })
  };

  it("raises the comparison above the form, which stays filled in", () => {
    renderDrawer({
      mode: amendMode(),
      conflict,
      changed: ["price"],
      values: { ...VALUES, price: "13.75" }
    });

    expect(screen.getByText("This trade changed while you were editing")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Price/)).toHaveValue("13.75");
  });

  it("compares the server's version against what the user typed, not what was loaded", () => {
    renderDrawer({
      mode: amendMode(),
      conflict,
      changed: ["price"],
      values: { ...VALUES, price: "13.75" }
    });

    // "Your value" has to be their in-progress input, or the panel is advising on the wrong thing.
    expect(screen.getByRole("row", { name: /^Price / })).toHaveTextContent("13.75");
  });

  it("hands the server's trade back when the user reapplies", async () => {
    const user = userEvent.setup();
    const { onReapplyConflict } = renderDrawer({ mode: amendMode(), conflict, changed: ["price"] });

    await user.click(screen.getByRole("button", { name: "Reapply onto v5" }));
    expect(onReapplyConflict).toHaveBeenCalledExactlyOnceWith(conflict.currentTrade);
  });

  it("suppresses the stale-version notice, which the panel supersedes", () => {
    renderDrawer({ mode: amendMode(), conflict, changed: ["price"], staleVersion: 5 });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("suppresses the generic error, which the panel supersedes", () => {
    renderDrawer({ mode: amendMode(), conflict, changed: ["price"], submitError: "Version conflict" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("leaves a booking alone — there is no prior version to conflict with", () => {
    renderDrawer({ mode: { kind: "create" }, conflict, changed: ["price"] });
    expect(screen.queryByText("This trade changed while you were editing")).not.toBeInTheDocument();
  });
});

describe("marking what an amendment will send", () => {
  it("badges only the edited fields", () => {
    renderDrawer({ mode: amendMode(), changed: ["price", "quantity"] });
    expect(screen.getAllByText("edited")).toHaveLength(2);
  });

  it("says how many fields the save will write", () => {
    renderDrawer({ mode: amendMode(), changed: ["price"] });
    expect(screen.getByText("Sends 1 changed field.")).toBeInTheDocument();
  });

  it("pluralises the count", () => {
    renderDrawer({ mode: amendMode(), changed: ["price", "quantity", "book"] });
    expect(screen.getByText("Sends 3 changed fields.")).toBeInTheDocument();
  });

  /** Status moves only through execute/cancel, never through an amendment. */
  it("explains why an untouched amend form has nothing to send", () => {
    renderDrawer({ mode: amendMode(), changed: [] });
    expect(
      screen.getByText("Status is set by execution events, not by amendment.")
    ).toBeInTheDocument();
  });

  it("never badges a booking, where every field is new", () => {
    renderDrawer({ mode: { kind: "create" }, changed: ["price", "quantity"] });
    expect(screen.queryByText("edited")).not.toBeInTheDocument();
    expect(screen.getByText("Booked as NEW. Status changes via execute or cancel.")).toBeInTheDocument();
  });
});

describe("while a save is in flight", () => {
  it("locks both footer controls so the request cannot be sent twice", () => {
    renderDrawer({ pending: true });
    expect(screen.getByRole("button", { name: /Saving/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("closes on request when idle", async () => {
    const user = userEvent.setup();
    const { onClose, onSubmit } = renderDrawer();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
})
