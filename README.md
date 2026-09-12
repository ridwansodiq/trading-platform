# Fusion Trade Blotter

A full-stack trade blotter built, the application uses a React frontend on ShadCN/Radix + Tailwind v4 with a headless TanStack Table blotter, a Fastify modular monolith, and PostgreSQL through Prisma.

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
npm run verify              # types, lint, boundaries, tests, builds
npm run lint:boundaries     # proves the architecture rules actually reject violations
npm run test:domain         # fast lifecycle rule tests
npm run test:integration    # PostgreSQL-backed API workflow tests
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

The UI is built on ShadCN/Radix with Tailwind v4. `frontend/src/styles.css` defines two token layers: the blotter
tokens taken from that handoff (`--surface`, `--ink-*`, `--violet`, `--green`, …) and the
ShadCN semantic contract (`--primary`, `--background`, …) *derived from* them, so the
primitives and the feature code cannot drift apart. Dark mode flips one root attribute.

Add primitives with `npx shadcn@latest add <name>` — `components.json` is configured for
this workspace.

See [docs/adr/](./docs/adr/) and [docs/domain/trade-lifecycle.md](./docs/domain/trade-lifecycle.md) for the reasoning behind the implementation.
