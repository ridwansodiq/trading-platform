import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, useBlotterQueryState } from "./use-blotter-query-state";

/**
 * The whole point of this hook is that a view is a URL: filter to a book, sort
 * by notional, then reload, share the link, or hit back and land on the same
 * blotter. So the tests read and write `window.location` directly rather than
 * asserting on internal state.
 */

function at(search: string) {
  window.history.replaceState(null, "", `/blotter${search}`);
  return renderHook(() => useBlotterQueryState());
}

function currentSearch(): string {
  return window.location.search;
}

/** Moves the browser to a URL and fires the event a back button would. */
function goBackTo(search: string) {
  act(() => {
    window.history.replaceState(null, "", `/blotter${search}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

beforeEach(() => {
  window.history.replaceState(null, "", "/blotter");
});

describe("reading a view out of the URL", () => {
  it("restores every filter and the sort from a shared link", () => {
    const { result } = at("?q=VOD&status=NEW&side=BUY&trader=a.trader&book=EQ-LDN-1&sortBy=notional&sortDir=asc&page=4");

    expect(result.current.filters).toEqual({
      search: "VOD",
      status: "NEW",
      side: "BUY",
      trader: "a.trader",
      book: "EQ-LDN-1"
    });
    expect(result.current.sort).toEqual({ key: "notional", direction: "asc" });
    expect(result.current.page).toBe(4);
  });

  it("falls back to defaults on an empty URL", () => {
    const { result } = at("");
    expect(result.current.filters).toEqual(DEFAULT_FILTERS);
    expect(result.current.sort).toEqual({ key: "tradeTimestamp", direction: "desc" });
    expect(result.current.page).toBe(1);
    expect(result.current.hasFilters).toBe(false);
  });

  /**
   * A hand-edited or stale link must not put the blotter into a state the API
   * will reject — these values go straight into a request.
   */
  it.each([
    ["an undefined status", "?status=SETTLED"],
    ["an undefined side", "?side=SHORT"],
    ["an undefined sort column", "?sortBy=pnl"],
    ["an undefined sort direction", "?sortDir=sideways"]
  ])("ignores %s", (_label, search) => {
    const { result } = at(search);
    expect(result.current.filters.status).toBe("ALL");
    expect(result.current.filters.side).toBe("ALL");
    expect(result.current.sort).toEqual({ key: "tradeTimestamp", direction: "desc" });
  });

  it.each([
    ["zero", "?page=0"],
    ["negative", "?page=-3"],
    ["fractional", "?page=1.5"],
    ["not a number", "?page=last"]
  ])("falls back to page 1 when the page is %s", (_label, search) => {
    expect(at(search).result.current.page).toBe(1);
  });
});

describe("writing the view back to the URL", () => {
  it("leaves a pristine blotter with a clean URL", () => {
    at("");
    expect(currentSearch()).toBe("");
  });

  it("records only what differs from the default", () => {
    const { result } = at("");
    act(() => result.current.updateFilters({ status: "NEW" }));

    // Not `?q=&side=ALL&…` — a shared link should read as the one thing that was set.
    expect(currentSearch()).toBe("?status=NEW");
  });

  it("drops a parameter again once it returns to its default", () => {
    const { result } = at("?status=NEW");
    act(() => result.current.updateFilters({ status: "ALL" }));
    expect(currentSearch()).toBe("");
  });

  it("survives a remount, which is what makes a link shareable", () => {
    const { result, unmount } = at("");
    act(() => result.current.updateFilters({ book: "EQ-LDN-1" }));
    act(() => result.current.toggleSort("notional"));
    const shared = currentSearch();
    unmount();

    const reopened = at(shared).result.current;
    expect(reopened.filters.book).toBe("EQ-LDN-1");
    expect(reopened.sort).toEqual({ key: "notional", direction: "asc" });
  });

  /**
   * `replaceState`, not `pushState`: a search box that pushed per keystroke
   * would need twenty presses of the back button to leave the page.
   */
  it("does not stack a history entry per keystroke", () => {
    const { result } = at("");
    const before = window.history.length;

    for (const search of ["V", "VO", "VOD"]) {
      act(() => result.current.updateFilters({ search }));
    }

    expect(window.history.length).toBe(before);
    expect(currentSearch()).toBe("?q=VOD");
  });
});

describe("moving between views", () => {
  it("sorts ascending on a newly chosen column", () => {
    const { result } = at("");
    act(() => result.current.toggleSort("symbol"));
    expect(result.current.sort).toEqual({ key: "symbol", direction: "asc" });
  });

  it("flips direction when the same column is chosen again", () => {
    const { result } = at("");
    act(() => result.current.toggleSort("symbol"));
    act(() => result.current.toggleSort("symbol"));
    expect(result.current.sort).toEqual({ key: "symbol", direction: "desc" });

    act(() => result.current.toggleSort("symbol"));
    expect(result.current.sort).toEqual({ key: "symbol", direction: "asc" });
  });

  it("starts a different column fresh rather than inheriting a direction", () => {
    const { result } = at("");
    act(() => result.current.toggleSort("symbol"));
    act(() => result.current.toggleSort("symbol"));
    act(() => result.current.toggleSort("price"));
    expect(result.current.sort).toEqual({ key: "price", direction: "asc" });
  });

  /** Page 7 of the old result set may not exist in the new one. */
  it("returns to the first page whenever a filter changes", () => {
    const { result } = at("?page=7");
    act(() => result.current.updateFilters({ status: "NEW" }));
    expect(result.current.page).toBe(1);
    expect(currentSearch()).toBe("?status=NEW");
  });

  it("returns to the first page on a re-sort too", () => {
    const { result } = at("?page=7");
    act(() => result.current.toggleSort("symbol"));
    expect(result.current.page).toBe(1);
  });

  it("keeps the filters and sort when only the page changes", () => {
    const { result } = at("?status=NEW&sortBy=symbol");
    act(() => result.current.setPage(3));

    expect(result.current.filters.status).toBe("NEW");
    expect(result.current.sort.key).toBe("symbol");
    expect(currentSearch()).toBe("?status=NEW&sortBy=symbol&page=3");
  });

  it("clears every filter at once, leaving the sort alone", () => {
    const { result } = at("?q=VOD&status=NEW&book=EQ-LDN-1&sortBy=notional&page=4");
    act(() => result.current.clearFilters());

    expect(result.current.filters).toEqual(DEFAULT_FILTERS);
    expect(result.current.page).toBe(1);
    expect(result.current.sort.key).toBe("notional");
    expect(currentSearch()).toBe("?sortBy=notional");
  });

  it.each([
    ["a search term", { search: "VOD" }],
    ["a status", { status: "NEW" as const }],
    ["a side", { side: "SELL" as const }],
    ["a trader", { trader: "a.trader" }],
    ["a book", { book: "EQ-LDN-1" }]
  ])("offers the clear control once %s is set", (_label, filter) => {
    const { result } = at("");
    expect(result.current.hasFilters).toBe(false);
    act(() => result.current.updateFilters(filter));
    expect(result.current.hasFilters).toBe(true);
  });

  it("does not count the sort or the page as a filter", () => {
    const { result } = at("?sortBy=notional&page=4");
    expect(result.current.hasFilters).toBe(false);
  });

  it("restores the previous view when the user goes back", () => {
    const { result } = at("?status=NEW");
    act(() => result.current.updateFilters({ status: "EXECUTED", book: "EQ-LDN-1" }));

    goBackTo("?status=NEW");

    // Back moves between blotter views rather than leaving the app.
    expect(result.current.filters.status).toBe("NEW");
    expect(result.current.filters.book).toBe("ALL");
  });

  it("stops listening for history moves once unmounted", () => {
    const { result, unmount } = at("?status=NEW");
    unmount();
    expect(() => goBackTo("?status=EXECUTED")).not.toThrow();
    expect(result.current.filters.status).toBe("NEW");
  });
})
