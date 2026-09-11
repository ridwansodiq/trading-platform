import { renderHook } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHotkeys, type HotkeyMap } from "./use-hotkeys";

/**
 * The blotter binds single letters — `n` books a trade, `/` focuses search — so
 * the guard around them is the whole point: a trader typing a symbol into a
 * field must never book a trade by spelling one. These tests are mostly about
 * when a shortcut must *not* fire.
 */

function mount(map: HotkeyMap, enabled = true) {
  return renderHook(({ m, e }) => useHotkeys(m, e), { initialProps: { m: map, e: enabled } });
}

/** A real focusable field in the document, so `event.target` is the element. */
function fieldOf(tag: "input" | "textarea" | "select"): HTMLElement {
  const element = document.createElement(tag);
  document.body.append(element);
  return element;
}

/**
 * jsdom parses `contenteditable` but never computes `isContentEditable`, which
 * is the property the guard reads — so it is stubbed rather than set.
 */
function editableDiv(): HTMLElement {
  const element = document.createElement("div");
  Object.defineProperty(element, "isContentEditable", { value: true });
  document.body.append(element);
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("useHotkeys", () => {
  it("runs the handler bound to a bare key", () => {
    const onNew = vi.fn();
    mount({ n: onNew });

    fireEvent.keyDown(document.body, { key: "n" });
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("matches regardless of the shift state the key arrived with", () => {
    const onNew = vi.fn();
    mount({ n: onNew });

    fireEvent.keyDown(document.body, { key: "N", shiftKey: true });
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("ignores an unbound key rather than swallowing it", () => {
    mount({ n: vi.fn() });

    const event = new KeyboardEvent("keydown", { key: "z", bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);

    // Left for the browser: not preventDefault'd, so normal typing still works.
    expect(event.defaultPrevented).toBe(false);
  });

  it("claims a key it does handle, so the browser does not also act on it", () => {
    mount({ "/": vi.fn() });

    const event = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);

    // Firefox's quick-find would otherwise open on "/".
    expect(event.defaultPrevented).toBe(true);
  });

  it.each(["input", "textarea", "select"] as const)(
    "stays out of the way while the user is typing in a %s",
    (tag) => {
      const onNew = vi.fn();
      mount({ n: onNew });

      fireEvent.keyDown(fieldOf(tag), { key: "n" });
      expect(onNew).not.toHaveBeenCalled();
    }
  );

  it("stays out of the way inside a contenteditable region too", () => {
    const onNew = vi.fn();
    mount({ n: onNew });

    fireEvent.keyDown(editableDiv(), { key: "n" });
    expect(onNew).not.toHaveBeenCalled();
  });

  it("still closes a drawer on escape from inside a field", () => {
    const onEscape = vi.fn();
    mount({ escape: onEscape });

    // Escape is the one key that has to work while focus is in the form it closes.
    fireEvent.keyDown(fieldOf("input"), { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("passes a modified shortcut through from a field, where it is unambiguous", () => {
    const onSave = vi.fn();
    mount({ "mod+s": onSave });

    fireEvent.keyDown(fieldOf("input"), { key: "s", metaKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("keeps the modified and bare bindings of one key apart", () => {
    const bare = vi.fn();
    const modified = vi.fn();
    mount({ k: bare, "mod+k": modified });

    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    expect(modified).toHaveBeenCalledTimes(1);
    expect(bare).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: "k" });
    expect(bare).toHaveBeenCalledTimes(1);
    expect(modified).toHaveBeenCalledTimes(1);
  });

  it("stands down entirely while a modal is open", () => {
    const onNew = vi.fn();
    const { rerender } = mount({ n: onNew }, false);

    fireEvent.keyDown(document.body, { key: "n" });
    expect(onNew).not.toHaveBeenCalled();

    rerender({ m: { n: onNew }, e: true });
    fireEvent.keyDown(document.body, { key: "n" });
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  /**
   * The listener is bound once and reads handlers through a ref, so a stale
   * closure here would act on whichever trade was selected several renders ago.
   */
  it("calls the handler from the latest render, not the one it was bound with", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = mount({ e: first });

    rerender({ m: { e: second }, e: true });
    fireEvent.keyDown(document.body, { key: "e" });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("unbinds on unmount", () => {
    const onNew = vi.fn();
    const { unmount } = mount({ n: onNew });

    unmount();
    fireEvent.keyDown(document.body, { key: "n" });
    expect(onNew).not.toHaveBeenCalled();
  });
})
