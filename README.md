# Fusion Trade Blotter

A full-stack trade blotter built for the TP ICAP Fusion take-home assessment. The application uses a React frontend on ShadCN/Radix + Tailwind v4, a Fastify modular monolith, and PostgreSQL through Prisma.

The backend is a **modular monolith using Service and Repository layers**: organised first by business module (`trades`, `auth`), with `routes -> schemas/dtos -> services -> repositories` inside each. Not hexagonal, no aggregates, no CQRS — see [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for why.

## Quick Start

Requirements: Node.js 22+, npm, and Docker.

```bash
npm install
docker compose up -d postgres
npm run db:migrate -w backend
npm run db:seed -w backend
npm run api:generate
npm run dev
```

Open `http://localhost:5173` and sign in with:

```text
alice.morgan@fusion.local
Fusion123!
```

The backend runs on `http://localhost:3001`. PostgreSQL is exposed on host port `5435` to avoid common local conflicts.

## Useful Commands

```bash
npm run dev                 # backend and frontend with hot reload
npm run verify              # contract, types, lint, boundaries, tests, builds
npm run lint:boundaries     # proves the architecture rules actually reject violations
npm run test:domain         # fast lifecycle rule tests
npm run test:integration    # PostgreSQL-backed API workflow tests
npm run api:generate        # OpenAPI plus generated TS client and validators
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

## Running The Built Image

```bash
docker compose --profile app up --build
```

Builds `backend/Dockerfile`, applies migrations, and serves the API on `:3001` against the
same PostgreSQL container. Plain `docker compose up -d postgres` still starts only the
database for the usual `npm run dev` workflow.

Configuration is validated at startup; see [.env.example](./.env.example) for every variable.
Swagger UI at `/api/docs` is served outside production and must be opted into with
`ENABLE_API_DOCS=true` in it.

## Domain Model

Trade business states are `NEW`, `EXECUTED`, and `CANCELLED`. Amendment is a versioned event, not a status. Every accepted command increments the trade version and appends one mandatory audit event in the same database transaction:

```text
v1 CREATED -> v2 AMENDED -> v3 AMENDED -> v4 EXECUTED
```

Amend, execute, and cancel commands include `expectedVersion`. The database update is conditional on that version; stale commands receive `409 VERSION_CONFLICT` and the latest server trade. An amendment applies **only the fields it sends**, so two traders editing different fields of the same trade do not overwrite each other.

Every failure — a validation error, a stale version, a terminal trade, an unknown route — returns the same `{ code, message, details? }` envelope from one error handler, and every status code is in the OpenAPI document.

REST handles commands and queries. Authenticated SSE at `/api/events` announces asynchronous changes and prompts clients to refetch authoritative state; its payload is validated against the generated `TradeEvent` schema before use. The stream is a notification channel only — commands stay available when it drops, and the toolbar says the table may be behind.

Derived fields — notional, signed quantity and signed notional — are calculated for display with `decimal.js` in `features/trades/lib/trade-view.ts` and are never persisted. *Sorting* by them happens in PostgreSQL over the same expressions, so a derived sort covers every matching trade rather than the loaded page. Exposure and status counts come from `GET /api/trades/exposure`, scoped by the same filters as the table.

## Repository Map

```text
backend/src/modules/trades/             routes, schemas, dtos, services, repositories
backend/src/modules/auth/               identity, sessions, requireAuth middleware
backend/src/realtime/sse/               SSE broker, stream route, trade publisher
backend/src/infrastructure/             prisma, config, logging, error base
backend/prisma/                         schema, migrations, and seed
backend/Dockerfile                      production image for the API

frontend/src/styles.css                 design tokens (both layers) and theme
frontend/src/components/ui/             vendored ShadCN primitives
frontend/src/components/layout/         app chrome
frontend/src/features/auth/             sign-in and session
frontend/src/features/trades/           blotter, drawers, dialogs
frontend/src/features/*/hooks/          state spanning components (query, cursor, workflow, stream)
frontend/src/features/*/lib/            pure tested logic (derived values, diffs, form rules)
frontend/src/api/generated/             OpenAPI-generated client/types/validators
frontend/src/api/realtime/              handwritten SSE adapter
frontend/src/{hooks,lib,types}/          cross-feature helpers

docs/adr/                               consequential architecture decisions
design_handoff_fusion_trade_blotter/    supplied design source and spec
```

## Design System

The UI is built on ShadCN/Radix with Tailwind v4, following the Built AI "Violet" theme
from the design handoff. `frontend/src/styles.css` defines two token layers: the blotter
tokens taken from the handoff (`--surface`, `--ink-*`, `--violet`, `--green`, …) and the
ShadCN semantic contract (`--primary`, `--background`, …) *derived from* them, so the
primitives and the feature code cannot drift apart. Dark mode flips one root attribute.

Add primitives with `npx shadcn@latest add <name>` — `components.json` is configured for
this workspace.

See [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md), [AGENTS.md](./AGENTS.md), and [docs/domain/trade-lifecycle.md](./docs/domain/trade-lifecycle.md) for the reasoning behind the implementation.

