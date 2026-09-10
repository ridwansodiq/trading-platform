import { describe, expect, it } from "vitest";
import { isStreamStale, resolveConnection, STREAM_SILENCE_TIMEOUT_MS } from "./connection";

const NOW = 1_800_000_000_000;

function signals(overrides: Partial<Parameters<typeof resolveConnection>[0]> = {}) {
  return {
    browserOnline: true,
    streamClosed: false,
    lastMessageAt: NOW,
    now: NOW,
    ...overrides
  };
}

describe("resolveConnection", () => {
  it("reports live while heartbeats keep arriving", () => {
    expect(resolveConnection(signals({ lastMessageAt: NOW - 4_000 }))).toBe("live");
  });

  it("reports offline the moment the browser loses the network", () => {
    // Takes precedence even over a stream that still looks healthy.
    expect(resolveConnection(signals({ browserOnline: false }))).toBe("offline");
  });

  it("prefers offline over a closed stream, because it is the more specific cause", () => {
    expect(resolveConnection(signals({ browserOnline: false, streamClosed: true }))).toBe("offline");
  });

  it("reports disconnected once EventSource gives up retrying", () => {
    expect(resolveConnection(signals({ streamClosed: true }))).toBe("disconnected");
  });

  it("reports reconnecting before the first frame arrives", () => {
    expect(resolveConnection(signals({ lastMessageAt: null }))).toBe("reconnecting");
  });

  it("reports disconnected after two missed heartbeats, with no error raised", () => {
    // The socket can stay open while delivering nothing; silence is the signal.
    expect(
      resolveConnection(signals({ lastMessageAt: NOW - (STREAM_SILENCE_TIMEOUT_MS + 1) }))
    ).toBe("disconnected");
  });

  it("tolerates one missed heartbeat without alarming the user", () => {
    expect(resolveConnection(signals({ lastMessageAt: NOW - 6_000 }))).toBe("live");
  });

  it("honours an explicit timeout", () => {
    expect(
      resolveConnection(signals({ lastMessageAt: NOW - 3_000, timeoutMs: 2_000 }))
    ).toBe("disconnected");
  });
});

describe("isStreamStale", () => {
  it("is false before anything has arrived", () => {
    expect(isStreamStale(null, NOW)).toBe(false);
  });

  it("is false inside the window and true past it", () => {
    expect(isStreamStale(NOW - 5_000, NOW)).toBe(false);
    expect(isStreamStale(NOW - 20_000, NOW)).toBe(true);
  });
});
