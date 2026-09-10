import { describe, expect, it } from "vitest";
import { EMPTY_EXPOSURE, toExposureDisplay } from "./exposure";
import type { TradeExposure } from "@/types/trade";

function exposure(overrides: Partial<TradeExposure> = {}): TradeExposure {
  return { ...EMPTY_EXPOSURE, ...overrides };
}

describe("exposure display", () => {
  it("formats the server's notionals for the strip", () => {
    const display = toExposureDisplay(
      exposure({ buyNotional: "1250000", sellNotional: "250000", netNotional: "1000000" })
    );

    expect(display.buyNotional).toBe("$1.25M");
    expect(display.sellNotional).toBe("$250.00K");
    expect(display.netNotional).toBe("$1.00M");
    expect(display.netIsNegative).toBe(false);
  });

  it("marks a net short position as negative", () => {
    const display = toExposureDisplay(exposure({ netNotional: "-1000" }));
    expect(display.netNotional).toBe("−$1.00K");
    expect(display.netIsNegative).toBe(true);
  });

  it("reports working as the NEW count and scope as the total", () => {
    const display = toExposureDisplay(
      exposure({
        tradesInScope: 412,
        statusCounts: { NEW: 37, EXECUTED: 300, CANCELLED: 75 }
      })
    );

    expect(display.working).toBe("37");
    expect(display.tradesInScope).toBe("412");
  });

  /**
   * Notionals cross the wire as decimal strings precisely so a book-sized total
   * is not rounded to whatever a double can hold.
   */
  it("keeps a notional beyond double precision exact", () => {
    const display = toExposureDisplay(exposure({ netNotional: "9007199254740993.25" }));
    expect(display.netNotional).toBe("$9007199.25B");
  });

  it("renders zeroes before the first aggregate arrives", () => {
    const display = toExposureDisplay(EMPTY_EXPOSURE);
    expect(display).toMatchObject({
      tradesInScope: "0",
      working: "0",
      buyNotional: "$0.00",
      netIsNegative: false
    });
  });
});
