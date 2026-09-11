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

describe("trade workflow", () => {
  let app: FastifyInstance;
  let cookie: string;
  let userId: string;
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

  it("lets exactly one of two concurrent commands against the same version win", async () => {
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

  it("writes no audit event when a command is rejected", async () => {
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

  it("404s for an unknown trade rather than returning empty history", async () => {
    const unknown = "00000000-0000-4000-8000-000000000000";
    for (const url of [`/api/trades/${unknown}`, `/api/trades/${unknown}/audit`]) {
      const response = await get(url);
      expect(response.statusCode, url).toBe(404);
      expect(response.json().code).toBe("TRADE_NOT_FOUND");
    }
  });
});
