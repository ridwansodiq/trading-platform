import { describe, expect, it } from "vitest";
import {
  formatExposure,
  formatNotional,
  formatPrice,
  formatQuantity,
  formatSigned,
  formatTradeTimestamp,
  fromDateTimeLocalValue,
  initials,
  toDateTimeLocalValue
} from "./format";

describe("numeric formatting", () => {
  it("renders notional at full precision rather than abbreviating it", () => {
    expect(formatNotional(2_679_000)).toBe("2,679,000.00");
    expect(formatNotional(18_750)).toBe("18,750.00");
  });

  it("pads prices to two decimals so the column aligns", () => {
    expect(formatPrice(187.4)).toBe("187.40");
    expect(formatPrice(214.32)).toBe("214.32");
  });

  it("separates thousands in quantities", () => {
    expect(formatQuantity(6750)).toBe("6,750");
  });

  it("prefixes signed values with an explicit sign", () => {
    expect(formatSigned(6750, 0)).toBe("+6,750");
    expect(formatSigned(-6750, 0)).toBe("−6,750");
    expect(formatSigned(-1_265_722.5, 2)).toBe("−1,265,722.50");
  });

  it("abbreviates only in the exposure strip", () => {
    expect(formatExposure(1_234_567)).toBe("$1.23M");
    expect(formatExposure(-2_500)).toBe("−$2.50K");
    expect(formatExposure(940)).toBe("$940.00");
  });
});

describe("timestamp formatting", () => {
  it("renders trade time as YYYY-MM-DD HH:MM:SS in UTC", () => {
    expect(formatTradeTimestamp("2026-09-10T14:07:52.000Z")).toBe("2026-09-10 14:07:52");
  });

  it("round-trips through a datetime-local input without shifting the instant", () => {
    const stored = "2026-09-10T14:07:00.000Z";
    const shown = toDateTimeLocalValue(stored);
    expect(shown).toBe("2026-09-10T14:07:00");
    // Re-submitting an untouched field must not move the timestamp.
    expect(fromDateTimeLocalValue(shown)).toBe(stored);
  });

  /**
   * The input is rendered with `step="1"`. Truncating to minutes here rewrote
   * the execution time of any trade whose amend form was merely opened.
   */
  it("preserves seconds rather than truncating them to the minute", () => {
    const stored = "2026-09-10T14:07:52.000Z";
    expect(toDateTimeLocalValue(stored)).toBe("2026-09-10T14:07:52");
    expect(fromDateTimeLocalValue(toDateTimeLocalValue(stored))).toBe(stored);
  });

  it("still accepts a minute-precision value from the browser", () => {
    expect(fromDateTimeLocalValue("2026-09-10T14:07")).toBe("2026-09-10T14:07:00.000Z");
  });

  it("returns a placeholder for an unparseable value", () => {
    expect(formatTradeTimestamp("not-a-date")).toBe("—");
  });
});

describe("initials", () => {
  it("takes at most two letters", () => {
    expect(initials("Marcus Ellery")).toBe("ME");
    expect(initials("alice")).toBe("A");
  });
});
