import { randomUUID } from "node:crypto";
import { hash } from "@node-rs/argon2";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { prisma } from "../../infrastructure/database/prisma";

/**
 * The suite provisions its own user and tags every trade it books with a
 * run-scoped book name.
 *
 * That does two things: it runs against a migrated but unseeded database, and
 * it isolates every filtered assertion from whatever else the database holds,
 * so exposure and sort expectations cannot be broken by a neighbouring test or
 * by demo data.
 */
const RUN = randomUUID().slice(0, 8);
const BOOK = `TEST-${RUN}`;
const PASSWORD = "Fusion123!";
const EMAIL = `integration-${RUN}@fusion.local`;

const newTradePayload = () => ({
  symbol: "VOD",
  side: "BUY" as const,
  quantity: 100,
  price: 72.25,
  book: BOOK,
  counterparty: "Test Counterparty",
  tradeTimestamp: new Date().toISOString()
});

/** How long a stream read waits before giving up and asserting on what arrived. */
const STREAM_READ_TIMEOUT_MS = 5_000;

type SseFrame = { id?: string; event?: string; data?: string };

/** Splits the raw stream into frames, which are blank-line separated. */
function parseSseFrames(buffer: string): SseFrame[] {
  return buffer
    .split("\n\n")
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const frame: SseFrame = {};
      for (const line of block.split("\n")) {
        const separator = line.indexOf(":");
        const field = line.slice(0, separator);
        const value = line.slice(separator + 1).trimStart();
        if (field === "id") frame.id = value;
        if (field === "event") frame.event = value;
        if (field === "data") frame.data = value;
      }
      return frame;
    });
}

type StreamedTradeEvent = {
  eventType: string;
  streamSequence: string;
  trade: { id: string; version: number };
};

/** The trade updates among a stream's frames, paired with their SSE id. */
function tradeUpdates(frames: SseFrame[]): { id: string; event: StreamedTradeEvent }[] {
  return frames
    .filter((frame) => frame.event === "trade-update")
    .map((frame) => ({
      id: frame.id!,
      event: JSON.parse(frame.data!) as StreamedTradeEvent
    }));
}

describe("trade workflow", () => {
  let app: FastifyInstance;
  let cookie: string;
  let userId: string;
  /** Set once the suite needs a listening socket; see `streamOrigin`. */
  let origin: string | undefined;
  const created: string[] = [];

  async function login(): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: EMAIL, password: PASSWORD }
    });
    expect(response.statusCode).toBe(200);
    const setCookie = response.headers["set-cookie"];
    return (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(";")[0]!;
  }

  async function createTrade(overrides: Record<string, unknown> = {}) {
    const response = await app.inject({
      method: "POST",
      url: "/api/trades",
      headers: { cookie },
      payload: { ...newTradePayload(), ...overrides }
    });
    if (response.statusCode === 201) created.push(response.json().id);
    return response;
  }

  const get = (url: string) => app.inject({ method: "GET", url, headers: { cookie } });

  const amend = (tradeId: string, expectedVersion: number, changes: Record<string, unknown>) =>
    app.inject({
      method: "PATCH",
      url: `/api/trades/${tradeId}`,
      headers: { cookie },
      payload: { expectedVersion, ...changes }
    });

  /**
   * The stream is read over a real socket rather than through `app.inject`: the
   * response is hijacked and never ends, so an injected request would never
   * resolve. It has to be *this* app, because an event only reaches the broker
   * of the instance that handled the operation that produced it.
   */
  const streamOrigin = async () => (origin ??= await app.listen({ port: 0, host: "127.0.0.1" }));

  /**
   * Opens the stream, optionally books trades once it is established, and reads
   * frames until `isEnough` is satisfied or the read times out. The socket is
   * closed either way; a timeout returns what did arrive, so a failure reads as
   * a missing frame rather than as a hung test.
   */
  async function readStream(
    headers: Record<string, string>,
    isEnough: (frames: SseFrame[]) => boolean,
    act?: () => Promise<void>
  ): Promise<SseFrame[]> {
    const controller = new AbortController();
    const response = await fetch(`${await streamOrigin()}/api/events`, {
      headers: { cookie, ...headers },
      signal: controller.signal
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const expiry = setTimeout(() => controller.abort(), STREAM_READ_TIMEOUT_MS);
    let buffer = "";
    let frames: SseFrame[] = [];

    try {
      // Only now that the stream is live, so nothing it publishes is missed.
      if (act) await act();

      while (!isEnough(frames)) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        frames = parseSseFrames(buffer);
      }
    } catch {
      // An aborted read is how the timeout arrives; assert on what we have.
    } finally {
      clearTimeout(expiry);
      controller.abort();
    }

    return frames;
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const user = await prisma.user.create({
      data: {
        email: EMAIL,
        displayName: `Integration Runner ${RUN}`,
        desk: "Testing",
        passwordHash: await hash(PASSWORD, {
          memoryCost: 19_456,
          timeCost: 2,
          outputLen: 32,
          parallelism: 1
        })
      }
    });
    userId = user.id;
    cookie = await login();
  });

  afterEach(async () => {
    // Each test cleans up after itself so ordering never matters.
    while (created.length > 0) {
      const id = created.pop()!;
      await prisma.tradeAuditEvent.deleteMany({ where: { tradeId: id } });
      await prisma.trade.deleteMany({ where: { id } });
    }
  });

  afterAll(async () => {
    await prisma.tradeAuditEvent.deleteMany({ where: { actorUserId: userId } });
    await prisma.trade.deleteMany({ where: { traderUserId: userId } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    // `close()` waits on open connections and a hijacked SSE response never
    // ends on its own, so draining first is what keeps teardown instant.
    app.drainRealtime();
    await app.close();
    await prisma.$disconnect();
  });

  it("records every version in the audit trail and rejects a stale amendment", async () => {
    const trade = await createTrade();
    expect(trade.statusCode).toBe(201);
    const tradeId = trade.json().id;

    const amended = await app.inject({
      method: "PATCH",
      url: `/api/trades/${tradeId}`,
      headers: { cookie },
      payload: { expectedVersion: 1, quantity: 150 }
    });
    expect(amended.statusCode).toBe(200);
    expect(amended.json()).toMatchObject({ quantity: 150, status: "NEW", version: 2 });

    const stale = await app.inject({
      method: "PATCH",
      url: `/api/trades/${tradeId}`,
      headers: { cookie },
      payload: { expectedVersion: 1, price: 74.5 }
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      code: "VERSION_CONFLICT",
      expectedVersion: 1,
      currentVersion: 2,
      currentTrade: { quantity: 150, version: 2 }
    });

    const audit = await get(`/api/trades/${tradeId}/audit`);
    expect(audit.statusCode).toBe(200);
    // Audit history reads oldest-first so a lifecycle can be followed downwards.
    expect(
      audit
        .json()
        .data.map((event: { eventType: string; tradeVersion: number }) => [
          event.eventType,
          event.tradeVersion
        ])
    ).toEqual([
      ["CREATED", 1],
      ["AMENDED", 2]
    ]);
  });

  it("lets exactly one of two concurrent operations against the same version win", async () => {
    const trade = await createTrade();
    const tradeId = trade.json().id;

    const attempts = await Promise.all(
      [200, 300, 400, 500].map((quantity) =>
        app.inject({
          method: "PATCH",
          url: `/api/trades/${tradeId}`,
          headers: { cookie },
          payload: { expectedVersion: 1, quantity }
        })
      )
    );

    const codes = attempts.map((response) => response.statusCode).sort();
    expect(codes).toEqual([200, 409, 409, 409]);

    // The winner advanced the trade by exactly one version.
    expect((await get(`/api/trades/${tradeId}`)).json().version).toBe(2);

    // And the losers left no trace in the audit trail.
    expect((await get(`/api/trades/${tradeId}/audit`)).json().data).toHaveLength(2);
  });

  it("writes no audit event when an operation is rejected", async () => {
    const trade = await createTrade();
    const tradeId = trade.json().id;
    const auditCount = () => prisma.tradeAuditEvent.count({ where: { tradeId } });
    const before = await auditCount();

    // Rejected by the route schema, before the service is reached.
    const invalid = await app.inject({
      method: "PATCH",
      url: `/api/trades/${tradeId}`,
      headers: { cookie },
      payload: { expectedVersion: 1, quantity: -5 }
    });
    expect(invalid.statusCode).toBe(400);
    expect(await auditCount()).toBe(before);

    // Rejected by a business rule inside the service.
    const conflict = await app.inject({
      method: "PATCH",
      url: `/api/trades/${tradeId}`,
      headers: { cookie },
      payload: { expectedVersion: 99, quantity: 150 }
    });
    expect(conflict.statusCode).toBe(409);
    expect(await auditCount()).toBe(before);

    expect((await get(`/api/trades/${tradeId}`)).json()).toMatchObject({
      quantity: 100,
      version: 1
    });
  });

  it("protects terminal trades from any further mutation", async () => {
    const trade = await createTrade();
    const tradeId = trade.json().id;

    const executed = await app.inject({
      method: "POST",
      url: `/api/trades/${tradeId}/execute`,
      headers: { cookie },
      payload: { expectedVersion: 1 }
    });
    expect(executed.statusCode).toBe(200);
    expect(executed.json()).toMatchObject({ status: "EXECUTED", version: 2 });

    for (const [method, url] of [
      ["PATCH", `/api/trades/${tradeId}`],
      ["POST", `/api/trades/${tradeId}/execute`],
      ["POST", `/api/trades/${tradeId}/cancel`]
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: { cookie },
        payload: { expectedVersion: 2 }
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe("INVALID_TRADE_TRANSITION");
    }
  });

  /**
   * A terminal trade and a stale version are different problems with different
   * remedies, and the compare-and-swap matches no row in either case. Reporting
   * the count alone would make the answer depend on timing.
   */
  it("reports a terminal trade as 422 even when the version is also stale", async () => {
    const trade = await createTrade();
    const tradeId = trade.json().id;

    await app.inject({
      method: "POST",
      url: `/api/trades/${tradeId}/cancel`,
      headers: { cookie },
      payload: { expectedVersion: 1 }
    });

    const stale = await app.inject({
      method: "PATCH",
      url: `/api/trades/${tradeId}`,
      headers: { cookie },
      payload: { expectedVersion: 1, quantity: 999 }
    });
    expect(stale.statusCode).toBe(422);
    expect(stale.json().code).toBe("INVALID_TRADE_TRANSITION");
  });

  it("attributes the audit actor to the authenticated session, not the payload", async () => {
    const created = await createTrade({
      // Both should be ignored entirely.
      trader: "Impersonated Trader",
      traderUserId: "00000000-0000-4000-8000-000000000000"
    });
    expect(created.statusCode).toBe(201);
    const trade = created.json();

    const user = (await get("/api/auth/me")).json().user;

    expect(trade.trader).toBe(user.displayName);
    expect(trade.traderUserId).toBe(user.id);

    const audit = await get(`/api/trades/${trade.id}/audit`);
    expect(audit.json().data[0]).toMatchObject({
      actorUserId: user.id,
      actorDisplayName: user.displayName
    });
  });

  /**
   * The response, the audit snapshot and the stored row have to be the same
   * trade. They were not while the API echoed the state it *asked* the database
   * to store: `numeric(18,4)` silently rounded a longer price.
   */
  describe("what is returned is what was stored", () => {
    it("rejects a price the price column cannot hold exactly", async () => {
      const response = await createTrade({ price: 72.256789 });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("VALIDATION_FAILED");
      expect(response.json().details).toEqual([
        { path: "price", message: expect.stringContaining("decimal places") }
      ]);
    });

    it("returns the persisted row, matching a later read and the audit snapshot", async () => {
      const created = await createTrade({ price: 72.2568 });
      expect(created.statusCode).toBe(201);
      const body = created.json();

      const reread = (await get(`/api/trades/${body.id}`)).json();
      expect(reread).toEqual(body);

      const audit = (await get(`/api/trades/${body.id}/audit`)).json();
      expect(audit.data[0].after).toEqual(body);
    });

    it("stamps timestamps from the database rather than the request", async () => {
      const created = (await createTrade()).json();
      const amended = await app.inject({
        method: "PATCH",
        url: `/api/trades/${created.id}`,
        headers: { cookie },
        payload: { expectedVersion: 1, quantity: 250 }
      });

      // The amendment moved `updatedAt` on but left `createdAt` where it was.
      expect(amended.json().createdAt).toBe(created.createdAt);
      expect(Date.parse(amended.json().updatedAt)).toBeGreaterThanOrEqual(
        Date.parse(created.updatedAt)
      );
    });
  });

  /**
   * The whole point of `PATCH`: two traders editing different fields of one
   * trade must not overwrite each other.
   */
  it("applies only the fields an amendment sends", async () => {
    const created = (await createTrade({ counterparty: "Original CP", symbol: "BP" })).json();

    const amended = await app.inject({
      method: "PATCH",
      url: `/api/trades/${created.id}`,
      headers: { cookie },
      payload: { expectedVersion: 1, quantity: 777 }
    });

    expect(amended.json()).toMatchObject({
      quantity: 777,
      counterparty: "Original CP",
      symbol: "BP",
      price: created.price,
      book: created.book
    });
  });

  describe("querying", () => {
    /** Notional is derived, so this ordering can only come from the database. */
    it("sorts by a derived column across the whole result set", async () => {
      await createTrade({ quantity: 100, price: 10 }); // notional 1,000
      await createTrade({ quantity: 100, price: 30 }); // notional 3,000
      await createTrade({ quantity: 100, price: 20 }); // notional 2,000

      const ascending = await get(
        `/api/trades?book=${BOOK}&sortBy=notional&sortDirection=asc&pageSize=200`
      );
      expect(
        ascending.json().data.map((trade: { quantity: number; price: number }) =>
          trade.quantity * trade.price
        )
      ).toEqual([1000, 2000, 3000]);

      // Paging must follow the same ordering, not fall back to a default.
      const firstPage = await get(
        `/api/trades?book=${BOOK}&sortBy=notional&sortDirection=desc&pageSize=1&page=1`
      );
      expect(firstPage.json().data[0].price).toBe(30);
      expect(firstPage.json().total).toBe(3);
    });

    it("aggregates exposure over every match, not just the page", async () => {
      await createTrade({ side: "BUY", quantity: 100, price: 10 }); // +1,000
      await createTrade({ side: "BUY", quantity: 100, price: 20 }); // +2,000
      await createTrade({ side: "SELL", quantity: 100, price: 5 }); //  -500

      const paged = await get(`/api/trades?book=${BOOK}&pageSize=1`);
      expect(paged.json().data).toHaveLength(1);

      const exposure = await get(`/api/trades/exposure?book=${BOOK}`);
      expect(exposure.statusCode).toBe(200);
      expect(exposure.json()).toMatchObject({
        tradesInScope: 3,
        statusCounts: { NEW: 3, EXECUTED: 0, CANCELLED: 0 }
      });
      expect(Number(exposure.json().buyNotional)).toBe(3000);
      expect(Number(exposure.json().sellNotional)).toBe(500);
      expect(Number(exposure.json().netNotional)).toBe(2500);
    });

    it("reports a total consistent with the rows it returned", async () => {
      await createTrade();
      await createTrade();

      const page = await get(`/api/trades?book=${BOOK}&pageSize=200`);
      expect(page.json().total).toBe(page.json().data.length);
    });

    it("treats a LIKE wildcard in the search box as a literal character", async () => {
      await createTrade({ counterparty: "100% Capital" });
      await createTrade({ counterparty: "Ordinary Capital" });

      const literal = await get(`/api/trades?book=${BOOK}&search=100%25%20Cap`);
      expect(literal.json().total).toBe(1);

      /*
       * Searching `%` must find only the counterparty that literally contains
       * one. Passed through unescaped it is a wildcard, and both rows match.
       */
      const percent = await get(`/api/trades?book=${BOOK}&search=%25`);
      expect(percent.json().total).toBe(1);
      expect(percent.json().data[0].counterparty).toBe("100% Capital");

      // `_` is the single-character wildcard, and matches nothing here.
      const underscore = await get(`/api/trades?book=${BOOK}&search=_`);
      expect(underscore.json().total).toBe(0);
    });

    it("offers distinct filter values from the database", async () => {
      await createTrade({ counterparty: `Alpha ${RUN}` });
      await createTrade({ counterparty: `Beta ${RUN}` });

      const options = await get(`/api/trades/filter-options?field=counterparty&search=${RUN}`);
      expect(options.statusCode).toBe(200);
      expect(options.json().values).toEqual([`Alpha ${RUN}`, `Beta ${RUN}`]);
      expect(options.json().hasMore).toBe(false);
    });
  });

  describe("errors share one envelope", () => {
    it("reports every invalid field at once", async () => {
      const response = await createTrade({ quantity: -1, symbol: "", price: 0 });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("VALIDATION_FAILED");
      expect(
        response.json().details.map((detail: { path: string }) => detail.path).sort()
      ).toEqual(["price", "quantity", "symbol"]);
    });

    it("answers an unknown route in the same shape as any other failure", async () => {
      const response = await get("/api/does-not-exist");
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: "ROUTE_NOT_FOUND" });
      expect(typeof response.json().message).toBe("string");
    });
  });

  it("rejects unauthenticated access to trades and the event stream", async () => {
    for (const url of [
      "/api/trades",
      "/api/trades/exposure",
      "/api/trades/filter-options?field=trader",
      "/api/events"
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(401);
      expect(response.json().code).toBe("UNAUTHENTICATED");
    }

    const create = await app.inject({ method: "POST", url: "/api/trades", payload: newTradePayload() });
    expect(create.statusCode).toBe(401);
  });

  it("makes a session unusable after logout", async () => {
    const throwaway = await login();

    expect(
      (await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: throwaway } })).statusCode
    ).toBe(200);

    await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: throwaway } });

    // Revocation is server-side, so the cookie alone is worthless afterwards.
    expect(
      (await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: throwaway } })).statusCode
    ).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: "/api/trades", headers: { cookie: throwaway } })).statusCode
    ).toBe(401);
  });

  it("returns a generic error for a bad password and never reveals the account", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: EMAIL, password: "wrong-password" }
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: "INVALID_CREDENTIALS",
      message: "Email or password is incorrect."
    });
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("answers an unknown account exactly as it answers a wrong password", async () => {
    const unknown = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: `nobody-${RUN}@fusion.local`, password: PASSWORD }
    });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json()).toEqual({
      code: "INVALID_CREDENTIALS",
      message: "Email or password is incorrect."
    });
  });

  it("never exposes password hashes or session tokens", async () => {
    const me = await get("/api/auth/me");
    const body = JSON.stringify(me.json());
    expect(body).not.toMatch(/passwordHash|argon2|tokenHash/i);
    expect(Object.keys(me.json().user).sort()).toEqual(["desk", "displayName", "email", "id"]);
  });

  describe("the event stream's global sequence", () => {
    /**
     * Where the stream has got to overall, as a client's cursor would be. On a
     * migrated but unseeded database the table is empty whenever the previous
     * test's cleanup has just run, and `0` is below every value BIGSERIAL
     * hands out, so it is the right floor for "nothing issued yet".
     */
    const latestStreamSequence = async () =>
      (
        (await prisma.tradeAuditEvent.aggregate({ _max: { streamSequence: true } }))._max
          .streamSequence ?? 0n
      ).toString();

    it("orders audit events across trades, not only within one", async () => {
      const first = (await createTrade()).json().id;
      const second = (await createTrade()).json().id;
      expect((await amend(first, 1, { quantity: 150 })).statusCode).toBe(200);

      const events = await prisma.tradeAuditEvent.findMany({
        where: { tradeId: { in: [first, second] } },
        orderBy: { streamSequence: "asc" },
        select: { tradeId: true, tradeVersion: true, streamSequence: true }
      });

      /*
       * The point of the column: `tradeVersion` says first-v1 and second-v1 are
       * both "1" and cannot rank them, while the stream sequence puts all three
       * events in the order they were committed, across trades.
       */
      expect(events.map((event) => [event.tradeId, event.tradeVersion])).toEqual([
        [first, 1],
        [second, 1],
        [first, 2]
      ]);

      const sequences = events.map((event) => event.streamSequence);
      expect(sequences[0]! < sequences[1]!).toBe(true);
      expect(sequences[1]! < sequences[2]!).toBe(true);
      // Assigned by the database, so it is a bigint all the way out of Prisma.
      expect(typeof sequences[0]).toBe("bigint");
    });

    it("identifies each frame with the stream sequence its payload carries", async () => {
      let tradeId = "";

      const frames = await readStream({}, (read) => tradeUpdates(read).length >= 2, async () => {
        tradeId = (await createTrade()).json().id;
        expect((await amend(tradeId, 1, { quantity: 150 })).statusCode).toBe(200);
      });

      const updates = tradeUpdates(frames);
      expect(updates).toHaveLength(2);

      // The id on the wire is what the payload says, because that is the value
      // a browser hands back in `Last-Event-ID`.
      for (const { id, event } of updates) {
        expect(id).toBe(event.streamSequence);
        expect(event.trade.id).toBe(tradeId);
      }

      expect(updates.map(({ event }) => event.eventType)).toEqual(["CREATED", "AMENDED"]);
      expect(BigInt(updates[0]!.id) < BigInt(updates[1]!.id)).toBe(true);

      // And it is the audit row's own sequence, not a number invented to send.
      const stored = await prisma.tradeAuditEvent.findMany({
        where: { tradeId },
        orderBy: { streamSequence: "asc" },
        select: { streamSequence: true }
      });
      expect(stored.map((event) => event.streamSequence.toString())).toEqual(
        updates.map(({ id }) => id)
      );
    });

    it("replays what a reconnecting client missed, and not what it already had", async () => {
      /*
       * Booked with nobody listening, so the events exist only in the audit
       * log. Recovering them is the whole point: an in-memory buffer would not
       * survive a restart, and would not be shared by a second instance.
       */
      const tradeId = (await createTrade()).json().id;
      expect((await amend(tradeId, 1, { quantity: 150 })).statusCode).toBe(200);

      const events = await prisma.tradeAuditEvent.findMany({
        where: { tradeId },
        orderBy: { streamSequence: "asc" },
        select: { streamSequence: true }
      });
      const [createdEvent, amendedEvent] = events.map((event) => event.streamSequence.toString());

      // Reconnecting as a client that saw the booking but dropped before the
      // amendment.
      const frames = await readStream(
        { "last-event-id": createdEvent! },
        (read) => tradeUpdates(read).length >= 1
      );

      const updates = tradeUpdates(frames);
      expect(updates.map(({ id }) => id)).toEqual([amendedEvent]);
      expect(updates[0]!.event.trade.version).toBe(2);
      // Strictly after the cursor: the event it named is one it already has.
      expect(updates.map(({ event }) => event.streamSequence)).not.toContain(createdEvent);
    });

    it("ignores a cursor it did not issue rather than failing the connection", async () => {
      const cursor = await latestStreamSequence();
      let tradeId = "";

      const frames = await readStream(
        { "last-event-id": "not-a-sequence" },
        (read) => tradeUpdates(read).length >= 1,
        async () => {
          tradeId = (await createTrade()).json().id;
        }
      );

      const updates = tradeUpdates(frames);
      // The stream still runs and still delivers live events; it simply
      // replays nothing, which is what a first connection gets anyway.
      expect(updates).toHaveLength(1);
      expect(updates[0]!.event.trade.id).toBe(tradeId);
      expect(BigInt(updates[0]!.id) > BigInt(cursor)).toBe(true);
    });
  });

  it("404s for an unknown trade rather than returning empty history", async () => {
    const unknown = "00000000-0000-4000-8000-000000000000";
    for (const url of [`/api/trades/${unknown}`, `/api/trades/${unknown}/audit`]) {
      const response = await get(url);
      expect(response.statusCode, url).toBe(404);
      expect(response.json().code).toBe("TRADE_NOT_FOUND");
    }
  });
});
