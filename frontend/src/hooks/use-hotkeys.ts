import { useEffect, useRef } from "react";

export type HotkeyMap = Record<string, (event: KeyboardEvent) => void>;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Blotter shortcuts. Suspended whenever a dialog or drawer is open or focus is
 * in a field, so typing a symbol never triggers an action.
 *
 * Keys are matched lowercase; prefix with "mod+" for ⌘/Ctrl.
 */
export function useHotkeys(map: HotkeyMap, enabled: boolean): void {
  const mapRef = useRef(map);

  /*
   * The listener is bound once and reads the latest handlers through this ref.
   * Updating it in an effect rather than during render keeps the write out of
   * the render phase, where React may discard or replay work.
   */
  useEffect(() => {
    mapRef.current = map;
  });

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const modified = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const lookup = modified ? `mod+${key}` : key;

      // Escape must work from inside a field, so it bypasses the typing guard.
      if (lookup !== "escape" && !modified && isTypingTarget(event.target)) return;

      const handler = mapRef.current[lookup];
      if (!handler) return;
      event.preventDefault();
      handler(event);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
