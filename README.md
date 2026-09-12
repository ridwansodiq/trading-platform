# Fusion Trade Blotter

A full-stack trade blotter built for the TP ICAP Fusion take-home assessment. The application uses a React frontend on ShadCN/Radix + Tailwind v4 with a headless TanStack Table blotter, a Fastify modular monolith, and PostgreSQL through Prisma.

The backend is a **modular monolith using Service and Repository layers**: organised first by business module (`trades`, `auth`), with `routes -> schemas -> services -> repositories` inside each. Not hexagonal, no aggregates, no CQRS — see [docs/adr/](./docs/adr/) for why.

## Quick Start

Requires Docker, and nothing else.

```bash
docker compose up --build
```

Open `http://localhost:3001` and sign in with:

```text
alice.morgan@fusion.local
Fusion123!
```

One command builds both workspaces, starts PostgreSQL, applies migrations, seeds
5,000 demo trades, and serves the API and the built SPA from a single origin. The
first build takes a couple of minutes; after that `docker compose up` is seconds.
Stop with `docker compose down`, or `docker compose down -v` to discard the database.

## Development

Requirements: Node.js 22 (see [.nvmrc](./.nvmrc)), npm, and Docker.

```bash
npm install
cp backend/.env.example backend/.env
docker compose up -d postgres
npm run db:migrate -w backend
npm run db:seed -w backend
npm run dev
```

Open `http://localhost:5173`; Vite proxies `/api` to the backend on `http://localhost:3001`.
PostgreSQL is exposed on host port `5435` to avoid common local conflicts.

`docker compose up -d postgres` starts only the database, so this workflow is
unaffected by the full stack above. `npm install` generates the Prisma client, so
`npm run typecheck` and the unit tests work on a fresh clone before any database
exists.

## Useful Commands

```bash
docker compose up --build   # the whole application: database, API, SPA
npm run dev                 # backend and frontend with hot reload
npm run verify              # types, lint, boundaries, tests, builds
npm run lint:boundaries     # proves the architecture rules actually reject violations
npm run test:domain         # fast lifecycle rule tests
npm run test:integration    # PostgreSQL-backed API workflow tests
npm run api:generate        # refresh OpenAPI spec + generated client (output is committed)
npm run db:seed -w backend  # idempotent demo data seed (5,000 trades)
```

### Demo data

The seed writes 5,000 trades and their full audit history in a couple of seconds, using
batched inserts and a fixed PRNG seed so the same book comes back every time. Lifecycles
are mixed — roughly a third of trades have been amended at least once, and about a third
reach a terminal state — so version numbers, the audit timeline's field-level diffs, and
the status filters all have something real to show. A few hundred rows would fit on one
page and hide exactly the problems server-side sorting, paging and aggregation solve.

```bash
SEED_TRADE_COUNT=25000 SEED_RESET=true npm run db:seed -w backend
```

`SEED_RESET=true` replaces existing trades and audit history; without it the seed leaves
any existing trades alone and only refreshes the demo users.

The integration tests provision their own user and clean up after themselves, so
`npm run test` works against a migrated but unseeded database and leaves seeded data
untouched. Seeding is for the demo UI.

There is no separate test database: the integration tests read the same `DATABASE_URL`
as development, and isolate themselves by tagging every row they create rather than by
connecting elsewhere. An aborted run therefore leaves `integration-*@fusion.local` users
and `TEST-*` trades behind.

### Live demo simulation

The seed gives the blotter a book; **Simulate** in the user menu gives it a pulse. It
runs two actions a second until it is stopped: every third one books a fresh trade, the
rest nudge the price or quantity of a live trade from the first page. It is a standalone
browser-side component (`frontend/src/components/layout/simulate-menu-item.tsx`) with no
server counterpart, so the loop stops with the tab.

Its actions are ordinary commands over the same REST endpoints a click uses, so each one
is version-checked, audited and pushed back over SSE exactly like a human's, and the
table, exposure strip and audit timeline all move on their own. That is around 125
requests a minute, measured against the running server; nothing throttles it, since login
is the only rate-limited route. A moved trade is dropped and the loop carries on, but five
consecutive failures — an expired session, say — stop it rather than letting it retry
twice a second forever.

## The Container Image

`docker compose up` runs two services: PostgreSQL, and one image built from
[backend/Dockerfile](./backend/Dockerfile) that carries the compiled API, the compiled
seed and the built SPA. Its entrypoint applies migrations, seeds if asked, then `exec`s
the server — `exec` so SIGTERM reaches Fastify and it can drain its SSE streams rather
than being killed when the stop grace period runs out.

The API serves the SPA itself when `SPA_DIR` is set, which is what collapses the demo
onto one origin: no CORS preflight, no cross-site cookie, and no reverse proxy in front
of an SSE stream waiting to buffer it. Development leaves `SPA_DIR` unset, so the backend
stays a pure API and Vite serves the app.

Two settings exist only because the demo is reached over plain HTTP on localhost:
`SESSION_COOKIE_SECURE=false`, since some browsers drop a `Secure` cookie there and login
would fail silently; and `FRONTEND_ORIGIN=http://localhost:3001`, which CORS never
actually consults while everything is same-origin. Anything terminating TLS should leave
both alone.

Configuration is validated at startup; see [backend/.env.example](./backend/.env.example)
for every variable. Swagger UI at `/api/docs` is served outside production and must be
opted into with `ENABLE_API_DOCS=true` in it.

## Domain Model

Trade business states are `NEW`, `EXECUTED`, and `CANCELLED`. Amendment is a versioned event, not a status. Every accepted command increments the trade version and appends one mandatory audit event in the same database transaction:

```text
v1 CREATED -> v2 AMENDED -> v3 AMENDED -> v4 EXECUTED
```

Amend, execute, and cancel commands include `expectedVersion`. The database update is conditional on that version; stale commands receive `409 VERSION_CONFLICT` and the latest server trade. An amendment applies **only the fields it sends**, so two traders editing different fields of the same trade do not overwrite each other.

Every failure — a validation error, a stale version, a terminal trade, an unknown route — returns the same `{ code, message, details? }` envelope from one error handler, and every status code is in the OpenAPI document.

REST handles commands and queries. Authenticated SSE at `/api/events` carries asynchronous changes as the **canonical trade**, validated against the generated `TradeEvent` schema before use. The stream is a notification channel, not the source of truth: an event invalidates the TanStack Query cache and the blotter refetches from REST, so the screen can only ever show state the server has confirmed. The full state is also refetched on connect and on every reconnect, so a notification missed while disconnected cannot leave the blotter stale.

Each audit event also carries a `streamSequence`: a PostgreSQL `BIGSERIAL` assigned as the row is inserted, inside the same transaction as the trade change. `tradeVersion` orders one trade's own history and cannot say whether one trade's amendment came before or after another's booking; `streamSequence` orders the whole log, so it is what the stream uses as its cursor. It is the SSE frame's `id`, which means a browser reconnecting sends it back in `Last-Event-ID` on its own, and the server replays `WHERE "streamSequence" > $1 ORDER BY "streamSequence" ASC` — exactly the events committed while that client was away. Because the number comes from the database rather than from a process, several application instances share one ordering, and a restart loses nothing. Gaps are expected and harmless: a rolled-back transaction keeps the value it drew. It crosses the wire as a decimal string — a `BIGINT` past 2^53 is not exact in a JSON number, and a cursor that rounds resumes from the wrong event.

The exposure aggregates are refetched alongside the table on the same signal. They are summed in SQL across every trade matching the current filter, never over the loaded page, so the strip always describes the same set of trades as the rows beneath it. They cross the wire as decimal strings and are formatted with `decimal.js`, never floats — a sum of `quantity * price` across a book can exceed the range a JSON number represents exactly.

Commands stay available when the stream drops, and the toolbar says the table may be behind — a dead notification channel must not disable the desk, because REST is unaffected by it.

**Known trade-off — refetch per event.** The client refetches rather than applying the trade the event already carries, which is the simplest thing that is always correct but costs one round trip per event, per connected client. At take-home scale that is a non-issue. On a real desk it is not: every client receives every event, so a burst of activity becomes a burst of requests from every browser on the floor. The three things that would need to change, in order of value:

1. **Debounce the refetch** into a trailing window, so a burst costs one request per client rather than N.
2. **Patch the cache from the event payload** — it carries the canonical trade, so a row already on screen could update with no request at all, applied only when its `version` is newer than the cached one so duplicate and out-of-order frames stay harmless. Only *membership* and *ordering* — which trades a page holds and where they sort — genuinely need the server, along with an amendment, whose prior values the event does not carry.
3. **Watchdog the heartbeat.** Connection state currently trusts `EventSource`, which can leave a silently dead socket reporting "live" for minutes; the server already sends a heartbeat every 5s, so treating silence past two of them as dead is the fix.

This was a deliberate scope cut, not an oversight. `useTradeStream` is ~120 lines with it and roughly four times that without.

Derived fields — notional, signed quantity and signed notional — are calculated for display with `decimal.js` in `features/trades/lib/trade-view.ts` and are never persisted. *Sorting* by them happens in PostgreSQL over the same expressions, so a derived sort covers every matching trade rather than the loaded page. Exposure and status counts come from `GET /api/trades/exposure`, scoped by the same filters as the table.

## Repository Map

```text
backend/src/modules/trades/             routes, schemas, services, repositories, types
backend/src/modules/auth/               identity, sessions, requireAuth middleware
backend/src/realtime/sse/               SSE broker, stream route, trade publisher
backend/src/infrastructure/             prisma, config, logging, error base
backend/prisma/                         schema, migrations, and seed
backend/Dockerfile                      production image: API, seed, and built SPA
backend/docker-entrypoint.sh            migrate, seed, then exec the server

frontend/src/styles.css                 design tokens (both layers) and theme
frontend/src/components/ui/             ShadCN primitives, and the combobox built on them
frontend/src/components/layout/         app chrome
frontend/src/features/auth/             sign-in and session
frontend/src/features/trades/           blotter, drawers, dialogs, column defs
frontend/src/features/*/hooks/          state spanning components (query, cursor, form, dialogs, stream)
frontend/src/features/*/lib/            pure tested logic (derived values, diffs, form rules)
frontend/src/api/generated/             OpenAPI-generated client/types/validators
frontend/src/api/realtime/              handwritten SSE adapter
frontend/src/{hooks,lib,types}/          cross-feature helpers

docs/adr/                               consequential architecture decisions
docs/domain/                            trade lifecycle rules
```

## Design System

The UI is built on ShadCN/Radix with Tailwind v4, following the Built AI "Violet" theme
from the supplied design handoff. `frontend/src/styles.css` defines two token layers: the
blotter tokens taken from that handoff (`--surface`, `--ink-*`, `--violet`, `--green`, …) and the
ShadCN semantic contract (`--primary`, `--background`, …) *derived from* them, so the
primitives and the feature code cannot drift apart. Dark mode flips one root attribute.

Add primitives with `npx shadcn@latest add <name>` — `components.json` is configured for
this workspace.

See [docs/adr/](./docs/adr/) and [docs/domain/trade-lifecycle.md](./docs/domain/trade-lifecycle.md) for the reasoning behind the implementation.

