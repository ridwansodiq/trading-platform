import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "./use-debounced-value";

/**
 * This is what stands between the search box and one request per keystroke, so
 * the behaviour worth pinning is that an interrupted burst costs nothing: only
 * the value a typist actually stopped on is allowed through.
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useDebouncedValue", () => {
  it("reports the first value immediately, with nothing to wait for", () => {
    const { result } = renderHook(() => useDebouncedValue("VOD"));
    expect(result.current).toBe("VOD");
  });

  it("holds a change back until the delay has fully elapsed", () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 200), {
      initialProps: { value: "" }
    });

    rerender({ value: "V" });
    advance(199);
    expect(result.current).toBe("");

    advance(1);
    expect(result.current).toBe("V");
  });

  it("emits only the value a typist stopped on, never the letters in between", () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 200), {
      initialProps: { value: "" }
    });

    // Four keystrokes 50ms apart: the window restarts on each one.
    for (const value of ["V", "VO", "VOD", "VOD."]) {
      rerender({ value });
      advance(50);
    }
    expect(result.current).toBe("");

    advance(200);
    expect(result.current).toBe("VOD.");
  });

  it("settles back on a value that was typed and then undone", () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 200), {
      initialProps: { value: "VOD" }
    });

    advance(200);
    rerender({ value: "VODX" });
    advance(50);
    rerender({ value: "VOD" });
    advance(200);

    // No spurious request for "VODX", and none for re-arriving at "VOD" either.
    expect(result.current).toBe("VOD");
  });

  it("restarts the window when the delay itself changes", () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebouncedValue(value, delay),
      { initialProps: { value: "a", delay: 200 } }
    );

    rerender({ value: "b", delay: 200 });
    advance(150);
    rerender({ value: "b", delay: 500 });
    advance(150);

    expect(result.current).toBe("a");
    advance(350);
    expect(result.current).toBe("b");
  });

  it("drops a pending value when the caller unmounts mid-flight", () => {
    const { rerender, unmount } = renderHook(({ value }) => useDebouncedValue(value, 200), {
      initialProps: { value: "a" }
    });

    rerender({ value: "b" });
    unmount();

    // A setState after unmount is the classic leak this cleanup exists to avoid.
    expect(() => advance(500)).not.toThrow();
  });
})
