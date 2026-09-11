import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useRowCursor } from "./use-row-cursor";
import type { TradeView } from "@/types/trade";

/**
 * The blotter refetches constantly, so rows reorder under the user's hands.
 * Holding the cursor by trade id rather than row index is what stops `j` then
 * `e` from executing whichever trade slid into that position — so the tests
 * here are mostly about what survives a list that changed underneath.
 */

function view(id: string): TradeView {
  return { id, tradeId: `TRD-${id}` } as TradeView;
}

const [a, b, c] = [view("a"), view("b"), view("c")];

function mount(initial: TradeView[] = [a, b, c]) {
  return renderHook(({ views }) => useRowCursor(views), { initialProps: { views: initial } });
}

describe("useRowCursor", () => {
  it("starts with nothing selected and nothing under the cursor", () => {
    const { result } = mount();
    expect(result.current.cursorId).toBeNull();
    expect(result.current.cursorTrade).toBeNull();
    expect(result.current.selectedId).toBeNull();
  });

  it("enters from the top when moving down for the first time", () => {
    const { result } = mount();
    act(() => result.current.move(1));
    expect(result.current.cursorId).toBe("a");
  });

  it("enters from the bottom when moving up for the first time", () => {
    const { result } = mount();
    act(() => result.current.move(-1));
    expect(result.current.cursorId).toBe("c");
  });

  it("clamps at both ends rather than wrapping around", () => {
    const { result } = mount();

    act(() => result.current.move(1));
    act(() => result.current.move(-1));
    // Already at the top: `k` must not jump to the bottom of the page.
    expect(result.current.cursorId).toBe("a");

    act(() => result.current.move(10));
    expect(result.current.cursorId).toBe("c");
    act(() => result.current.move(1));
    expect(result.current.cursorId).toBe("c");
  });

  it("exposes the whole trade under the cursor, not just its id", () => {
    const { result } = mount();
    act(() => result.current.move(1));
    expect(result.current.cursorTrade).toBe(a);
  });

  it("moves both the cursor and the selection on a click", () => {
    const { result } = mount();
    act(() => result.current.select(b));
    expect(result.current.selectedId).toBe("b");
    expect(result.current.cursorId).toBe("b");
  });

  /** The reason the cursor is an id: a sort change must not retarget it. */
  it("follows its trade when the rows reorder underneath", () => {
    const { result, rerender } = mount();
    act(() => result.current.select(b));

    rerender({ views: [c, b, a] });
    expect(result.current.cursorId).toBe("b");

    // And stepping continues from where that trade now sits.
    act(() => result.current.move(1));
    expect(result.current.cursorId).toBe("a");
  });

  it("reads as absent once its trade leaves the view", () => {
    const { result, rerender } = mount();
    act(() => result.current.select(b));

    rerender({ views: [a, c] });
    expect(result.current.cursorId).toBeNull();
    expect(result.current.cursorTrade).toBeNull();
  });

  it("keeps the selection while the cursor's trade is filtered away", () => {
    const { result, rerender } = mount();
    act(() => result.current.select(b));
    rerender({ views: [a, c] });

    // The footer still names the trade the user opened; only keyboard targeting lapses.
    expect(result.current.selectedId).toBe("b");
  });

  it("picks the cursor back up when its trade returns to the view", () => {
    const { result, rerender } = mount();
    act(() => result.current.select(b));

    rerender({ views: [a, c] });
    rerender({ views: [a, b, c] });
    expect(result.current.cursorId).toBe("b");
  });

  it("steps from the top again after its trade has gone", () => {
    const { result, rerender } = mount();
    act(() => result.current.select(b));
    rerender({ views: [a, c] });

    act(() => result.current.move(1));
    expect(result.current.cursorId).toBe("a");
  });

  it("has nowhere to go on an empty page", () => {
    const { result } = mount([]);
    act(() => result.current.move(1));
    act(() => result.current.move(-1));
    expect(result.current.cursorId).toBeNull();
  });
})
