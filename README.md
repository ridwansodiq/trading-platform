# Fusion Trade Blotter

A full-stack trade blotter app, the application uses a React frontend on ShadCN/Radix + Tailwind v4 with a headless TanStack Table blotter, a Fastify modular monolith, and PostgreSQL through Prisma.

The backend is a **modular monolith using Service and Repository layers**: organised first by business module (`trades`, `auth`), with `routes -> schemas -> services -> repositories` inside each.

## Quick Start

Requires Docker, and nothing else.

```bash
docker compose up --build
```

Open `http://localhost:3001` and sign in with either demo account:

```text
alice.morgan@fusion.local / Fusion123!
bob.chen@fusion.local     / Fusion123!
```

Signing in as both in two browsers shows the live updates crossing between them.

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
PostgreSQL is exposed on host port `5435` to avoid common local conflicts, and `npm install`
generates the Prisma client, so a fresh clone typechecks and runs the unit tests before any
database exists.

## Useful Commands

```bash
docker compose up --build   # the whole application: database, API, SPA
npm run dev                 # backend and frontend with hot reload
npm run verify              # types, lint, boundaries, tests, builds — see Testing below
npm run api:generate        # refresh OpenAPI spec + generated client (output is committed)
npm run db:seed -w backend  # idempotent demo data seed (5,000 trades)
```

### Demo data

The seed writes 5,000 trades and their full audit history in a couple of seconds, using a
fixed PRNG seed so the same book comes back every time. Lifecycles are mixed — roughly a
third of trades have been amended at least once, and about a third reach a terminal state —
so version numbers, the audit timeline's field-level diffs and the status filters all have
something real to show, at a size where server-side sorting, paging and aggregation earn
their keep.

```bash
SEED_TRADE_COUNT=25000 SEED_RESET=true npm run db:seed -w backend
```

### Live demo simulation

**Simulate** in the user menu gives the seeded book a pulse: two actions a second until it is
stopped, every third one booking a fresh trade and the rest nudging the price or quantity of a
live trade from the first page. 

## Testing

```bash
npm run verify              # the whole gate: types, lint, boundaries, tests, builds
npm test                    # backend and frontend unit tests
npm run test:domain         # trade lifecycle rules, no database needed
npm run test:integration    # API workflows against PostgreSQL — needs `docker compose up -d postgres`
npm run test:frontend       # hooks, components, and the pure logic behind them
```

Three layers, each testing what only it can: the lifecycle rules as pure functions, the API
end to end against a real database (concurrency conflicts, audit writes, status transitions),
and the frontend over a fake `EventSource` and a mocked client. `npm run lint:boundaries`
is part of the gate too — it proves the module rules reject violations rather than trusting
that nobody wrote one.

## Assumptions

- **One desk, one tenant.** No firm or book-level permissions: any signed-in user can act on
  any trade, and the audit trail records who did.
- **Trades are notional.** Booking, amending and cancelling are the whole lifecycle — no
  settlement, clearing, or downstream confirmation.
- **`NEW → EXECUTED | CANCELLED`** is the status model, extending the brief's
  `ACTIVE | CANCELLED` so an amendment has something to be blocked by. See
  [docs/domain/trade-lifecycle.md](./docs/domain/trade-lifecycle.md).
- **Symbols, books and counterparties are free text**, validated for shape but not against a
  reference data service.
- **The two demo accounts are fixtures.** There is no registration, password reset or
  user administration.

## Trade-offs

- **A modular monolith, not services.** Module boundaries are enforced in lint, so the seams
  are real and a split stays available — without paying for it now. [ADR 0001](./docs/adr/0001-modular-monolith.md)
- **SSE notifies; REST stays authoritative.** An event tells the client a trade moved and the
  client refetches. That costs a round trip per event per client, and is always correct.
  [ADR 0003](./docs/adr/0003-rest-sse-and-openapi.md)
- **The broker is in-process**, capped at `SSE_MAX_CLIENTS` (500), and replay reads the audit
  table rather than a buffer — so reconnects survive a restart, but a second instance would
  need a shared bus.
- **Aggregates and derived columns are computed in SQL**, not in the browser: correct over the
  whole book rather than the page in view, at the cost of a query per screen.
  [ADR 0006](./docs/adr/0006-server-side-derived-columns-and-aggregates.md)
- **Optimistic concurrency over locking.** A stale amend is rejected with a version conflict
  the UI can explain, rather than held behind a lock.
  [ADR 0002](./docs/adr/0002-postgresql-audit-and-concurrency.md)
- **Sessions are database-backed cookies**, not JWTs — revocable mid-stream, which is what
  lets a live SSE connection be closed the moment its session dies.
  [ADR 0004](./docs/adr/0004-session-authentication.md)

## AI Usage

This project was built with AI assistance. [AI_USAGE.md](./AI_USAGE.md) covers the tools, how
they were used, and which suggestions were taken or rejected; [PROMPT_LOG.md](./PROMPT_LOG.md)
is a representative sample of the prompts behind the significant decisions.

## Repository Map

```text
backend/src/modules/trades/             routes, schemas, services, repositories, types
backend/src/modules/auth/               identity, sessions, requireAuth middleware
backend/src/realtime/sse/               SSE broker, stream route, trade publisher
backend/src/infrastructure/             prisma, config, logging, error base
backend/prisma/                         the database: schema, migrations, and seed
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

The UI is built on ShadCN/Radix with Tailwind v4. `frontend/src/styles.css` defines two token layers: the blotter
tokens taken from that handoff (`--surface`, `--ink-*`, `--violet`, `--green`, …) and the
ShadCN semantic contract (`--primary`, `--background`, …) *derived from* them, so the
primitives and the feature code cannot drift apart. Dark mode flips one root attribute.

Add primitives with `npx shadcn@latest add <name>` — `components.json` is configured for
this workspace.

See [docs/adr/](./docs/adr/) and [docs/domain/trade-lifecycle.md](./docs/domain/trade-lifecycle.md) for the reasoning behind the implementation.
