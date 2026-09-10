import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BlotterFooter } from "./blotter-footer";

/**
 * Pagination is almost entirely boundary conditions, and at 5,000 trades the
 * ends of the range are no longer reachable by stepping — so which control is
 * live at which page is the whole behaviour.
 */
function renderFooter(overrides: Partial<Parameters<typeof BlotterFooter>[0]> = {}) {
  const onPageChange = vi.fn();
  render(
    <BlotterFooter
      page={1}
      pageSize={25}
      total={5000}
      rowsOnPage={25}
      selectedRef={null}
      onPageChange={onPageChange}
      {...overrides}
    />
  );
  return {
    onPageChange,
    first: screen.getByRole("button", { name: "First page" }),
    previous: screen.getByRole("button", { name: "Previous page" }),
    next: screen.getByRole("button", { name: "Next page" }),
    last: screen.getByRole("button", { name: "Last page" })
  };
}

describe("pagination controls", () => {
  it("reports the page count for the whole result set", () => {
    renderFooter({ page: 7 });
    expect(screen.getByText("Page 7 of 200")).toBeInTheDocument();
  });

  it("disables both backward controls on the first page", () => {
    const { first, previous, next, last } = renderFooter({ page: 1 });
    expect(first).toBeDisabled();
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();
    expect(last).toBeEnabled();
  });

  it("disables both forward controls on the last page", () => {
    const { first, previous, next, last } = renderFooter({ page: 200 });
    expect(first).toBeEnabled();
    expect(previous).toBeEnabled();
    expect(next).toBeDisabled();
    expect(last).toBeDisabled();
  });

  it("jumps to either end in one click", async () => {
    const user = userEvent.setup();
    const { first, last, onPageChange } = renderFooter({ page: 100 });

    await user.click(last);
    expect(onPageChange).toHaveBeenCalledWith(200);

    await user.click(first);
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("still steps one page at a time", async () => {
    const user = userEvent.setup();
    const { previous, next, onPageChange } = renderFooter({ page: 100 });

    await user.click(next);
    expect(onPageChange).toHaveBeenCalledWith(101);

    await user.click(previous);
    expect(onPageChange).toHaveBeenCalledWith(99);
  });

  /**
   * Reachable from a shared link whose filters have since narrowed the result
   * set. Stepping forward is impossible, so "last" has to remain the way back.
   */
  it("keeps the last-page jump live when the page is past the end", async () => {
    const user = userEvent.setup();
    const { next, last, onPageChange } = renderFooter({ page: 999, rowsOnPage: 0 });

    expect(next).toBeDisabled();
    expect(last).toBeEnabled();

    await user.click(last);
    expect(onPageChange).toHaveBeenCalledWith(200);
  });

  it("disables every control when nothing matches", () => {
    const { first, previous, next, last } = renderFooter({ total: 0, rowsOnPage: 0 });
    for (const control of [first, previous, next, last]) expect(control).toBeDisabled();
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
  });

  it("describes the slice of the result set on show", () => {
    renderFooter({ page: 3, rowsOnPage: 25 });
    expect(screen.getByText("51–75")).toBeInTheDocument();
    expect(screen.getByText("5000")).toBeInTheDocument();
  });

  it("counts a short final page correctly", () => {
    renderFooter({ page: 200, total: 4990, rowsOnPage: 15 });
    expect(screen.getByText("4976–4990")).toBeInTheDocument();
  });
});
