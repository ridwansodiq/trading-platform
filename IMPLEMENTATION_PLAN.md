# Trading Platform Implementation Plan

## Goal

Build a small equity trade blotter that demonstrates full-stack TypeScript, real-time UI updates, transactional persistence, a conventional and explainable architecture, tests, and clear communication.

Core quality matters more than feature count. Every decision below is chosen to be easy to justify in a review conversation.

## Deliverables

- `AGENTS.md` — repository operating guide for coding agents
- `ARCHITECTURE.md` — modules, layers, dependency direction, request lifecycle
- `frontend/` — React + TypeScript trade blotter UI
- `backend/` — modular monolith with Service and Repository layers inside each module
- `openapi/openapi.json` — generated, language-neutral REST contract
- `frontend/src/api/generated/` — generated REST types and TanStack Query client
- `database/` — schema, migrations, and seed documentation
- `docs/domain-rules.md`, `docs/testing.md`, `docs/adr/`
- `.github/workflows/ci.yml` — repeatable verification gate
- `docker-compose.yml` — local OS-agnostic startup
- `README.md` — architecture, setup, tests, assumptions, trade-offs
- `AI_USAGE.md` and `PROMPT_LOG.md` — AI usage report and curated prompt log

## Scope

### Must have

- View trades in a sortable, filterable table
- Display derived trade metrics without persisting them
- Authenticate users before exposing trade data or real-time notifications
- Create trades with validation
- Amend `NEW` trades with versioned updates
- Execute a trade via a status transition
- Cancel a trade via a status transition
- Record every mutation in a mandatory, append-only audit trail
- Reject stale mutations with optimistic concurrency control
- Persist trades in PostgreSQL
- Push create/amend/execute/cancel notifications to all connected clients
- Seed realistic trades when the database is empty
- Unit and integration tests for backend behaviour
- One root verification command covering types, lint, and tests
- Generate the frontend REST client from the backend-owned OpenAPI contract, and detect stale generated files in CI
- Keep ownership rules and architectural decisions easy to discover
- Clear README and AI usage documentation

### Nice to have

- Net position summary by symbol
- Virtualized table
- Additional UI polish beyond the design handoff baseline

### Deliberately out of scope

- Microservices, event sourcing, full CQRS infrastructure
- Role-based access control and book-level permissions
- Complex regulatory workflows and advanced P&L modelling
- External identity providers (Auth0, Clerk, OAuth, SSO), MFA, password reset
- Cloud deployment
- AI features inside the trading product

## Stack

### Frontend

- React + TypeScript, built with Vite
- Tailwind CSS v4 as the sole styling framework, with semantic design tokens
- ShadCN/Radix primitives, vendored via the shadcn CLI into `components/ui/`
- TanStack Query for API state and cache invalidation
- Orval-generated REST functions, DTOs, and TanStack Query hooks
- `decimal.js` for derived monetary calculations
- Native `EventSource` client for Server-Sent Events
- Vitest + React Testing Library

### Backend

- Node.js + TypeScript
- Fastify with a Zod type provider for typed route schemas and runtime validation
- `@fastify/swagger` to generate OpenAPI from registered route schemas
- Prisma for migrations and typed database access
- Argon2id password hashing, opaque server-side sessions, secure HTTP-only cookies
- Login rate limiting and generic authentication errors
- Server-Sent Events for one-way notifications
- Vitest for unit and integration tests

### Database

- PostgreSQL from the first migration through integration tests
- Docker Compose provides a reproducible local instance
- Prisma manages schema, migrations, transactions, constraints, and seed data

## Architecture

**Modular monolith using Service and Repository layers** — or, more briefly, a *modular layered architecture*.

Code is organised primarily by **feature module** (`trades`, `auth`), and each module uses a simple layered structure internally. Cross-cutting concerns live outside the modules.

This is deliberately not Hexagonal, not Clean Architecture, not ports and adapters, not DDD, and not CQRS. Those names are avoided because those patterns are not being implemented.

```text
                        Fastify
                           │
                  ┌────────┴────────┐
                  │                 │
             Auth Module      Trades Module
                  │                 │
               Service           Service
                  │                 │
             Repository        Repository
                  │                 │
                  └────────┬────────┘
                           │
                      PostgreSQL
```

Inside a module, the flow is linear and easy to follow:

```text
routes/         thin HTTP layer, auth middleware, schema validation
    ↓
schemas/        Zod request/response shapes, and the OpenAPI contract
    ↓
dtos/           service inputs, including server-derived actor identity
    ↓
services/       business rules and orchestration
    ↓
repositories/   Prisma access and transactions
    ↓
PostgreSQL
                `-> real-time publication, only after a successful commit
```

The guiding rule is: **organise first by business module, then by technical responsibility inside that module.**

With globally separated `routes/`, `services/`, and `repositories/` directories, understanding one feature means jumping across five directories. With modules, `modules/trades/` contains nearly everything relevant to trades, and the technical layers live as subfolders within it.

### Module and layer responsibilities

**Routes** — `<module>/routes/`

- Very thin HTTP layer
- Parse params, query, and body
- Apply authentication middleware via `preHandler`
- Validate request and response schemas
- Build the service input, attaching trusted server-derived values
- Call a service method
- Map known application errors to documented HTTP responses
- Must not contain trade business rules
- Must not call Prisma directly

**Schemas** — `<module>/schemas/`

- Zod schemas for external request and response shapes
- Own the OpenAPI contract; registered as reusable components where practical
- Kept separate from services and repositories, so validation concerns do not leak inward
- Split per use case once there is more than a handful — `create-trade.schema.ts`, `amend-trade.schema.ts`, `trade-response.schema.ts` — rather than one growing file

**DTOs** — `<module>/dtos/`

- Represent what a service receives
- May include trusted values that are not part of the HTTP request, notably `actorUserId` and `actorDisplayName`
- Expressed as TypeScript types inferred or composed from schemas. Do not create DTO classes or mapper ceremony
- Split per use case alongside the schemas: `create-trade.dto.ts`, `amend-trade.dto.ts`, `execute-trade.dto.ts`

**Services** — `<module>/services/`

- The primary home for business rules and orchestration
- `TradeService`: lifecycle validation, amendment/execution/cancellation rules, optimistic concurrency handling, repository coordination, and publishing real-time notifications **only after** a successful commit
- `AuthService`: credential verification, session creation, current-user resolution, session revocation
- Services must not import Fastify or touch `request`/`reply`

```ts
class TradeService {
  async execute(input: ExecuteTradeDto) {
    const trade = await this.trades.findById(input.tradeId);
    if (!trade) throw new TradeNotFoundError();
    if (trade.status !== "NEW") throw new InvalidTradeStateError(trade.status);

    const result = await this.trades.executeWithAudit(input);
    this.events.publish({ eventType: "EXECUTED", trade: result });
    return result;
  }
}
```

**Repositories** — `<module>/repositories/`

- Encapsulate all Prisma and PostgreSQL access
- Concrete, named persistence operations — not generic `IRepository<T>` abstractions
- Use-case-specific methods are acceptable and often necessary to preserve transactional and concurrency correctness. `executeWithAudit(input)` is a better method than a set of primitives a caller could combine incorrectly
- The trade update and its audit insert happen in one transaction
- No HTTP concerns

```ts
class TradeRepository {
  async executeWithAudit(input: ExecuteTradeDto) {
    return prisma.$transaction(async (tx) => {
      // conditional versioned update, audit insert, return canonical trade
    });
  }
}
```

**Mappers** — `<module>/mappers/`

- Translate Prisma rows into the module's API shape (for example `Decimal` to `number`, `Date` to ISO string)
- Keeps persistence types out of route responses without introducing an abstraction layer

**Errors** — `<module>/errors/`

- Module-specific error types with stable codes (`TRADE_NOT_FOUND`, `INVALID_TRADE_TRANSITION`, `VERSION_CONFLICT`, `INVALID_TRADE`)
- Extend a small shared base in `infrastructure/errors/` so routes can map any of them uniformly
- Services throw them; routes translate them into HTTP status codes

### Each module has a public API

Every module exposes an `index.ts` barrel naming exactly what the rest of the app may use — typically its route plugin, and for `auth` the `requireAuth` guard and the `AuthenticatedUser` type.

This makes `index.ts` load-bearing rather than decorative: **cross-module imports go through the barrel only, never into another module's internals.** A module's `services/` and `repositories/` are private to it.

### Cross-cutting infrastructure (outside the modules)

- `realtime/sse/` — generic SSE connection tracking, fan-out, the authenticated stream endpoint, and the typed trade-event publisher the trade service calls
- `infrastructure/database/` — the Prisma client
- `infrastructure/config/` — validated environment configuration
- `infrastructure/logging/` — logger setup
- `infrastructure/errors/` — the shared application error base
- `app.ts` / `server.ts` — plugin registration, Swagger setup, and the listener

Authentication middleware lives **inside** the auth module at `modules/auth/middleware/`, because it is auth behaviour rather than generic infrastructure. Other modules reach it through the auth module's `index.ts`.

Generic SSE connection handling stays out of the trade module because it is transport infrastructure, not trade behaviour. The trade service publishes trade-specific events through a small typed publisher — no event bus.

### Audit belongs to the trades module

The audit trail exists because of trade mutations, so it is **not** an independent module. It lives inside the trades module as `repositories/trade-audit.repository.ts`, and the audit history route stays `GET /api/trades/:id/audit` because it is fundamentally part of the trade feature.

The trade repository coordinates both tables inside one transaction:

```text
TradeRepository
     ├── trades table
     └── trade_audit_events table
```

Making audit a separate module would add a boundary that buys nothing and would make it harder to keep the two writes atomic.

### Authentication is an independent module

Auth owns a genuinely separate concern — users, sessions, password verification, login, logout, and session resolution — so it gets its own module.

### Deliberately not built

- Domain aggregates or entity classes
- Ports and adapters / hexagonal indirection
- Generic repository interfaces or a unit-of-work abstraction
- A command bus, CQRS read models, or event sourcing
- An event bus beyond the small typed trade publisher
- Independently deployable services

Where only one implementation will ever exist, the interface is omitted. `trades` remains current state; `trade_audit_events` remains immutable history.

### Dependency rules (enforced, not just documented)

Within a module, dependencies point one way:

```text
routes/       -> schemas/, dtos/, services/, errors/
services/     -> dtos/, repositories/, mappers/, errors/, realtime publisher
repositories/ -> prisma, dtos/, mappers/, errors/
```

Across boundaries:

- Cross-module imports resolve through the other module's `index.ts` only. Reaching into `modules/auth/services/...` from the trades module is forbidden
- `trades/routes/` may import `requireAuth` and `AuthenticatedUser` from `modules/auth`
- `trades/services/` must not import the auth module at all. It receives an already-authenticated actor as a plain value, so business rules stay independent of how sessions work
- Any module may import `infrastructure/`
- Nothing inward of `routes/` may import Fastify or route modules
- `routes/` must not import Prisma
- `realtime/` must not import module services (the dependency runs service → publisher, never back)

Enforce with ESLint `no-restricted-imports` scoped per directory and per file pattern, and verify the rules actually fire by asserting that a forbidden import fails lint.

### Naming convention and nesting limit

Filenames stay dot-separated and role-suffixed inside their layer folder: `routes/trade.routes.ts`, `services/trade.service.ts`, `repositories/trade-audit.repository.ts`, `schemas/create-trade.schema.ts`. The role is legible from the filename in editor tabs and search results, even though the folder already implies it.

Stop at two levels inside a module — `modules/<module>/<layer>/<file>`. Deeper nesting such as `modules/trades/services/commands/handlers/` is not warranted here and is explicitly out of bounds.

## Domain Rules

The canonical statement lives in `docs/domain-rules.md`; this section is the summary.

### Trade model

The response schema below is backend-owned and feeds OpenAPI generation.

```ts
const TradeSideSchema = z.enum(["BUY", "SELL"]);
const TradeStatusSchema = z.enum(["NEW", "EXECUTED", "CANCELLED"]);

const TradeSchema = z.object({
  id: z.string().uuid(),
  tradeId: z.string(),
  symbol: z.string(),
  side: TradeSideSchema,
  quantity: z.number().int().positive(),
  price: z.number().positive(),
  traderUserId: z.string().uuid(),
  trader: z.string(),
  book: z.string(),
  counterparty: z.string(),
  tradeTimestamp: z.string().datetime(),
  status: TradeStatusSchema,
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
```

### Lifecycle

| Command | Required state | Resulting state | Audit event |
| --- | --- | --- | --- |
| Create | none | `NEW` | `CREATED` |
| Amend | `NEW` | `NEW` | `AMENDED` |
| Execute | `NEW` | `EXECUTED` | `EXECUTED` |
| Cancel | `NEW` | `CANCELLED` | `CANCELLED` |

- Trade statuses are exactly `NEW | EXECUTED | CANCELLED`
- `AMENDED` is an **audit event type, never a trade status**
- Amendments keep the trade in `NEW`
- Every successful mutation increments `version` by exactly one
- `EXECUTED` and `CANCELLED` are terminal and cannot be amended or transitioned again
- Every successful create/amend/execute/cancel produces exactly one append-only audit event
- The trade mutation and the audit insert commit atomically
- Rejected commands produce no trade change, no audit event, and no SSE notification

A typical history is `CREATED v1`, `AMENDED v2`, `AMENDED v3`, `EXECUTED v4`.

### Validation

- `symbol` required, normalised to uppercase
- `side` must be `BUY` or `SELL`
- `quantity` must be a positive integer
- `price` must be positive
- `book` and `counterparty` required
- `tradeTimestamp` must be a valid ISO timestamp
- `trader` is required but assigned from the authenticated session, never accepted from the payload
- `trader` cannot be amended in this scope

### Audit model

```ts
const TradeAuditEventSchema = z.object({
  id: z.string().uuid(),
  tradeId: z.string().uuid(),
  tradeVersion: z.number().int().positive(),
  eventType: z.enum(["CREATED", "AMENDED", "EXECUTED", "CANCELLED"]),
  actorUserId: z.string().uuid(),
  actorDisplayName: z.string(),
  before: TradeSchema.nullable(),
  after: TradeSchema,
  createdAt: z.string().datetime()
});
```

The audit log is append-only. Each event stores the acting user's identity snapshot plus complete before/after trade snapshots for the version it produced. `before` and `after` are typed as `Trade` in the contract — not `unknown` — so the frontend can render a field-level diff rather than a JSON blob.

Audit history is returned oldest-first.

### Derived values

```ts
interface TradeView extends Trade {
  notional: string;
  signedQuantity: string;
  signedNotional: string;
}
```

- `notional = quantity * price`
- `signedQuantity = side === "BUY" ? +quantity : -quantity`
- `signedNotional = side === "BUY" ? +notional : -notional`

These are **frontend-only handwritten types**, computed in one pure, tested mapper. They are never persisted, never part of a command payload, never in an audit snapshot, and never in the OpenAPI contract. Monetary values use `decimal.js` and render at fixed precision — never abbreviated inside the table.

## Optimistic Concurrency Control

Every amend, execute, and cancel command must carry the version the user read as `expectedVersion`.

The service evaluates the command against the trade it read, then the repository performs an atomic compare-and-swap update matching both `id` and `version`, inserting the audit event in the same transaction. An application-level load-and-check alone is insufficient because another command could commit between the check and the write.

1. User A and User B both open trade version `3`
2. User A changes quantity with `expectedVersion: 3`; the update succeeds, producing version `4` and an `AMENDED` audit event
3. User B submits a price change with `expectedVersion: 3`; the conditional update matches no row
4. The API returns `409` with the current version and trade snapshot. No trade update, audit event, or notification is produced for User B
5. User B reviews version `4` and deliberately reapplies against it

```json
{
  "code": "VERSION_CONFLICT",
  "message": "Trade has changed since it was opened.",
  "expectedVersion": 3,
  "currentVersion": 4,
  "currentTrade": {}
}
```

Add a unique database constraint on `(tradeId, tradeVersion)` for audit events. This complements the conditional update and prevents two audit records claiming the same resulting version.

## Authentication And Identity

Authentication is in scope, and its business justification is **trustworthy audit attribution** — knowing which real user performed each trade command — not merely adding a login screen.

### Persistence

- `users`: `id`, unique normalised `email`, `displayName`, `desk`, `passwordHash`, timestamps
- `sessions`: `tokenHash`, `userId`, `expiresAt`, `createdAt`
- Store only an Argon2id password hash and a SHA-256 hash of the opaque session token. Never store plaintext passwords or raw session tokens
- Seed at least two demo users so concurrent User A / User B behaviour can be demonstrated

### Session behaviour

- Login creates a cryptographically random opaque token and sets it in a cookie
- Cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, with an explicit expiry, and `Secure` outside local HTTP development
- No token in browser `localStorage`
- Logout deletes the server session and clears the cookie, making the session immediately unusable
- Expired or unknown sessions return `401 UNAUTHENTICATED`
- Credentialed CORS is restricted to the configured frontend origin
- Login is rate-limited and returns the same generic error for unknown users and wrong passwords

### Explicitly not used

JWT access/refresh infrastructure, browser-stored tokens, Auth0, Clerk, external identity providers, OAuth, MFA, and password reset / email verification.

### Identity rules

- `POST /api/trades` derives `trader` from the authenticated user's display name; the client cannot spoof it
- Every audit event records `actorUserId` and an `actorDisplayName` snapshot from the session
- Actor identity always comes from `request.user.id`, never from a request payload field
- REST trade routes, audit queries, and the SSE stream all require a valid session

## Authorization

Deliberately flat for this submission.

- Every authenticated user has the same trade permissions
- Authentication answers "who are you?"; authorization answers "may you perform this command?"
- The current authorization policy is simply: an authenticated user may issue the supported trade commands
- Any authenticated user may amend, execute, or cancel a `NEW` trade; the audit trail records who did it

**No roles.** No `TRADER`/`OPERATIONS`/`ADMIN`, no RBAC, no book-level permissions.

The modular design leaves an obvious seam for this later: command-level authorization would be a check at the top of each `TradeService` method, taking the actor and the trade, without changing routes or repositories. Document the seam; do not build it now.

## API Design

REST handles all commands and queries. SSE is a separate one-way notification channel that announces committed changes; it does not accept commands or replace REST responses.

### Endpoints

```text
POST /api/auth/login              verify credentials, create session, set cookie
POST /api/auth/logout             revoke session and clear cookie
GET  /api/auth/me                 authenticated user's safe profile

GET  /api/trades                  list with filters, sorting, pagination
GET  /api/trades/:id              retrieve one trade
GET  /api/trades/:id/audit        ordered audit history
GET  /api/trades/filter-options   distinct values for a filterable column
POST /api/trades                  create
PATCH /api/trades/:id             amend using expectedVersion
POST /api/trades/:id/execute      execute using expectedVersion
POST /api/trades/:id/cancel       cancel using expectedVersion

GET  /api/events                  authenticated SSE notification stream
GET  /api/positions               optional net position summary
GET  /api/health                  health check
```

`PATCH` is used for amendment rather than `PUT` because the amend payload is a partial set of changed fields plus `expectedVersion`, not a full replacement.

`/api/health` and `/api/auth/login` are public. Everything else requires a valid session. Authentication failures use the documented `401 UNAUTHENTICATED` response; login throttling uses `429 TOO_MANY_REQUESTS`.

### Query parameters for `GET /api/trades`

`status`, `side`, `symbol`, `trader`, `book`, `search`, `sortBy`, `sortDirection`, `page`, `pageSize`

Filtering, sorting, and pagination happen server-side so the blotter stays correct at realistic volumes.

### Filter options

`GET /api/trades/filter-options?field=trader|book|counterparty&search=&limit=`

High-cardinality filter values cannot be derived from the loaded page — a page of rows surfaces only a handful of the traders or counterparties on the book — and cannot all be shipped to the client once there are thousands. This endpoint runs a `GROUP BY` with server-side matching, returns a capped list, and reports whether more values exist. `field` must be a closed enum, because the value selects a column to group by.

### Real-time channel

`GET /api/events` — authenticated SSE stream, using the same session cookie as REST.

```ts
type TradeEvent = {
  id: string;
  eventType: "CREATED" | "AMENDED" | "EXECUTED" | "CANCELLED";
  trade: Trade;
  occurredAt: string;
};
```

**Server rule.** Every successful create/amend/execute/cancel writes the trade and its audit event in one transaction, then publishes the canonical trade after commit. A trade update must never commit without its audit record, and no notification is published for a rejected or rolled-back command.

**Client rule.** The REST response confirms the initiating command; SSE updates other sessions and reconciles the initiating one. Apply an incoming event only when its trade version is newer than the cached version, so duplicate or out-of-order notifications are harmless. An event must never silently overwrite an open edit form — mark the form stale instead.

**Reliability rule.** SSE is best-effort; REST remains authoritative. A process failure between commit and publication can lose a notification, so clients refetch trades whenever the stream connects or reconnects. If guaranteed delivery ever becomes a requirement, add a transactional outbox and a replayable cursor — not now.

**Liveness rule.** The stream emits a **named** `heartbeat` event on a short interval and a `retry` hint on open. The heartbeat must not be an SSE comment: `EventSource` never surfaces comment frames to JavaScript, so a comment keeps proxies awake while leaving the client unable to distinguish a live stream from a dead socket. The client derives connection state from three signals — `navigator.onLine`, a permanently closed `EventSource`, and elapsed heartbeat silence — because `onerror` alone can stay quiet for minutes on a broken socket. A dropped connection must surface to the user within seconds, and must disable trade actions while it is down. A network failure must not be reported as a session expiry; confirm expiry with a request before saying so.

## OpenAPI And Generated Frontend Client

The API boundary is explicit and generated. There is **no shared TypeScript contracts package** between frontend and backend.

```text
modules/trades/schemas/
modules/auth/schemas/
        │
        ▼
   Fastify routes
        │
        ▼
 openapi/openapi.json
        │
        ▼
      Orval
        │
        ▼
frontend/src/api/generated/   (DTOs, fetch functions, TanStack Query hooks, Zod validators)
```

The module layout does not affect this pipeline: each module owns its schemas, and Fastify assembles them into one document.

### Contract rules

- Every route declares params, query, body, success response, and expected error responses
- Assign stable `operationId` and tags so generated function names stay predictable
- Register shared schemas as reusable OpenAPI components (`Trade`, `TradePage`, `TradeAuditEvent`, `TradeEvent`, `ApiError`) so the document `$ref`s one definition instead of inlining a copy per operation and status
- Document the session cookie as an OpenAPI cookie security scheme and mark protected operations
- Publish `TradeEvent` as a component referenced by the SSE endpoint, so Orval generates its type and Zod validator even though connection handling is handwritten
- Generate the document from the registered Fastify app without starting a listener
- Keep `openapi/openapi.json` deterministic so review diffs and CI drift checks stay meaningful
- Do not force Prisma models, service inputs, DTOs, or repository types into the contract
- Frontend-only models (`TradeView`, derived display values) stay handwritten frontend types

### Orval rules

- Generate a fetch-based TanStack Query client into `frontend/src/api/generated/`, tag-split
- One handwritten fetch mutator sets `credentials: "include"` and normalises errors
- Commit generated output, mark it generated, exclude it from manual lint churn, and never hand-edit it
- Generated REST code is disposable and always reproducible from the spec

### Scripts

```text
npm run typecheck
npm run lint
npm run api:spec        # deterministically write openapi/openapi.json
npm run api:generate    # refresh the spec and the Orval client
npm run api:check       # regenerate, then FAIL if tracked generated paths changed
npm run test:domain
npm run test:integration
npm run test:frontend
npm run verify          # canonical acceptance command; includes api:check
```

`api:check` must genuinely fail on drift, not merely regenerate and typecheck. Compare content hashes of `openapi/openapi.json` and `frontend/src/api/generated/` before and after regeneration so it behaves identically in CI, in a fresh clone, and outside a git work tree. CI runs the same `npm run verify` used locally.

## Frontend Architecture

Feature-sliced, mirroring the backend's module-first organisation.

```text
frontend/src/
  api/
    generated/        Orval output — never hand-edited
    realtime/         handwritten EventSource adapter
    fetch-client.ts   the single fetch mutator
    unwrap.ts         narrows generated success/error response unions
  components/
    ui/               vendored ShadCN primitives (shadcn CLI)
    layout/           app chrome
  features/
    auth/{components,hooks}/
    trades/{components,hooks,lib}/
  hooks/              cross-feature hooks (theme, hotkeys, debounce)
  lib/                cn(), formatting
  types/              app-level types, incl. handwritten TradeView
```

- A feature may import from `components/`, `hooks/`, `lib/`, `types/`, and `api/` — never from another feature's internals
- `features/*/lib/` holds pure, tested logic: the derived-value mapper, exposure aggregates, the audit diff, connection-state resolution. Calculations live there, not in components
- Styling uses Tailwind v4 with two token layers in one file: the blotter tokens from the design handoff, and the ShadCN semantic contract **derived from them** so the two cannot drift. No hardcoded hex values in components. Dark mode is one root attribute

### UX requirements

**Authentication flow.** Bootstrap with `GET /api/auth/me` before requesting trades or opening SSE. Show a compact login screen when no session exists. Disable repeat submission while pending and show a generic invalid-credentials message. Display the authenticated user with a logout action. Treat `trader` on create as read-only, populated from the session. Return to login when a protected request returns `401`. Close the stream on logout; refetch REST state before reopening it.

**Blotter.** Dense table as the first screen. Toolbar with search, status and side filters, searchable trader and book pickers, refresh, and create. Sortable columns including the derived ones. Columns for notional, signed quantity, signed notional, and version. Row actions for amend, execute, cancel, and audit history — unavailable actions visibly disabled with the reason given. Clear loading, empty, error, and disconnected states.

**Create / amend.** Validated form with inline messages. Save disabled while submitting. The form retains the version it opened with and never silently replaces user input. A newer version arriving over SSE marks the form stale and prompts review. A `409` shows the server's values against the user's and requires an explicit reapply or discard — never an automatic merge. Execute and cancel require confirmation, because both are terminal.

**Real-time.** Create, amend, execute, and cancel from another client update the table without a manual refresh. Incoming events append to an open audit view. A connection indicator distinguishes live, reconnecting, disconnected, and offline.

## Project Structure

```text
.
├── AGENTS.md
├── ARCHITECTURE.md
├── README.md
├── AI_USAGE.md
├── PROMPT_LOG.md
├── IMPLEMENTATION_PLAN.md
├── .env.example
├── docker-compose.yml
├── orval.config.ts
├── package.json
├── openapi/
│   └── openapi.json
├── scripts/
│   └── check-generated.mjs
├── docs/
│   ├── domain-rules.md
│   ├── testing.md
│   └── adr/
│       ├── 001-use-postgresql.md
│       ├── 002-use-rest-and-sse.md
│       ├── 003-model-amendment-as-an-audit-event.md
│       ├── 004-use-optimistic-concurrency.md
│       ├── 005-use-modular-service-repository-architecture.md
│       ├── 006-reject-event-sourcing.md
│       ├── 007-use-openapi-and-orval-instead-of-shared-types.md
│       ├── 008-use-opaque-server-side-sessions.md
│       └── 009-omit-rbac.md
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.ts
│   ├── scripts/
│   │   └── generate-openapi.ts
│   └── src/
│       ├── modules/
│       │   ├── trades/
│       │   │   ├── routes/
│       │   │   │   └── trade.routes.ts
│       │   │   ├── schemas/
│       │   │   │   ├── create-trade.schema.ts
│       │   │   │   ├── amend-trade.schema.ts
│       │   │   │   ├── transition-trade.schema.ts
│       │   │   │   ├── list-trades.schema.ts
│       │   │   │   └── trade-response.schema.ts
│       │   │   ├── dtos/
│       │   │   │   ├── create-trade.dto.ts
│       │   │   │   ├── amend-trade.dto.ts
│       │   │   │   └── transition-trade.dto.ts
│       │   │   ├── services/
│       │   │   │   └── trade.service.ts
│       │   │   ├── repositories/
│       │   │   │   ├── trade.repository.ts
│       │   │   │   └── trade-audit.repository.ts
│       │   │   ├── mappers/
│       │   │   │   └── trade.mapper.ts
│       │   │   ├── errors/
│       │   │   │   └── trade.errors.ts
│       │   │   └── index.ts
│       │   └── auth/
│       │       ├── routes/
│       │       │   └── auth.routes.ts
│       │       ├── schemas/
│       │       │   ├── login.schema.ts
│       │       │   └── user-response.schema.ts
│       │       ├── dtos/
│       │       │   └── login.dto.ts
│       │       ├── services/
│       │       │   └── auth.service.ts
│       │       ├── repositories/
│       │       │   ├── user.repository.ts
│       │       │   └── session.repository.ts
│       │       ├── middleware/
│       │       │   └── require-auth.ts
│       │       ├── errors/
│       │       │   └── auth.errors.ts
│       │       └── index.ts
│       ├── realtime/
│       │   └── sse/
│       │       ├── sse-broker.ts
│       │       ├── sse.routes.ts
│       │       └── trade-events.ts
│       ├── infrastructure/
│       │   ├── database/
│       │   │   └── prisma.ts
│       │   ├── config/
│       │   │   └── env.ts
│       │   ├── logging/
│       │   │   └── logger.ts
│       │   └── errors/
│       │       └── application-error.ts
│       ├── app.ts
│       └── server.ts
├── frontend/
│   └── src/                     (see Frontend Architecture)
└── database/
    └── README.md
```

## Implementation Sequence

Domain correctness comes before login polish. Authentication is required in the finished solution, but it must not displace the trade system.

### Phase 1 — Workspace, tooling, PostgreSQL

- Workspace packages for frontend and backend
- Fastify with the Zod type provider, `@fastify/swagger`, and Orval configured
- Deterministic OpenAPI and client generation scripts
- TypeScript, lint, formatting, and test configuration
- Tailwind v4 with design tokens; shadcn CLI configured
- Root scripts including `npm run verify`
- ESLint module- and layer-boundary rules, including the barrel-only cross-module rule
- Docker Compose with PostgreSQL and a health check
- `AGENTS.md`, `ARCHITECTURE.md`, initial README, `docs/`, and the ADR set
- Initialise `AI_USAGE.md` and `PROMPT_LOG.md`
- CI running the same commands as local development

**Exit:** install succeeds; both dev servers start; the spec and client reproduce from scripts; PostgreSQL starts and migrations apply cleanly; a forbidden cross-layer or cross-module import fails lint; health endpoint responds.

### Phase 2 — Trades module: schemas, service, repository, persistence

- Prisma schema and migration for trades
- `schemas/`, `dtos/`, `mappers/`, and `errors/` for the trades module, split per use case
- `TradeRepository` with concrete persistence operations
- `TradeService` owning lifecycle rules for create, amend, execute, and cancel
- Seed script for randomised trades

**Exit:** trades can be created, listed, amended, executed, and cancelled through the service; lifecycle transitions enforce `NEW -> EXECUTED` or `NEW -> CANCELLED`; amendments retain `NEW`; validation rejects bad quantity, price, side, and missing fields; seed data appears when the database is empty.

### Phase 3 — Audit trail and optimistic concurrency

- Audit table, migration, and the unique `(tradeId, tradeVersion)` constraint
- `repositories/trade-audit.repository.ts`, with the trade repository coordinating both tables in one transaction
- Use-case methods such as `amendWithAudit` / `executeWithAudit` performing the conditional update and audit insert together
- `VERSION_CONFLICT` handling in the service, surfaced with the current trade

**Exit:** every mutation increments the version exactly once and appends exactly one matching audit event atomically; stale versions are rejected without changing the trade or audit history; two concurrent writes against the same version cannot both succeed.

### Phase 4 — REST and OpenAPI contract

- Thin routes for list, get, create, amend, execute, cancel, audit, and filter options
- Complete request/success/error schemas and stable operation IDs for every route
- Structured error responses mapped from module errors
- Generate and commit the OpenAPI document and Orval client
- `api:check` drift detection wired into `verify` and CI

**Exit:** OpenAPI documents every supported success and error response; shared components are referenced rather than inlined; generated frontend code is reproducible and `npm run api:check` fails on stale output.

### Phase 5 — Auth module and sessions

- `users` and `sessions` in the Prisma schema; seed configurable demo users with Argon2id hashes
- `AuthService`, `UserRepository`, `SessionRepository`
- Login, current-user, logout, session expiry, cookie handling, login rate limiting
- `modules/auth/middleware/require-auth.ts`, exported through the auth module's `index.ts` and used by trade routes
- Supply the authenticated actor to trade commands and audit records

**Exit:** valid credentials establish a server-side session; invalid, expired, and logged-out sessions receive `401`; passwords and raw session tokens are never stored or returned; unauthenticated users cannot read or mutate trades; trade creation derives `trader` from the session and audit entries identify the acting user.

### Phase 6 — SSE notifications

- `realtime/sse/` connection tracking and authenticated endpoint, with a named heartbeat and retry hint
- `realtime/sse/trade-events.ts` publisher called by `TradeService` after commit
- Version-based idempotent reconciliation, and REST refetch on connect and reconnect

**Exit:** two sessions see create/amend/execute/cancel without a manual refresh; unauthenticated or expired sessions cannot open the stream; disconnected clients do not break notifications; a reconnected client converges on current REST state; a dropped connection surfaces within seconds.

### Phase 7 — Frontend blotter and Orval integration

- Session bootstrap, login, header identity, expiry handling, logout
- ShadCN-based UI primitives and the token system
- All REST access through generated Orval functions and hooks
- Handwritten `EventSource` adapter using the generated `TradeEvent` validator
- Table with sorting, filtering, and searchable pickers
- Tested trade-to-view mapper for derived fields
- Create/amend form, execute and cancel confirmations, audit history panel, conflict resolution
- Loading, empty, error, and disconnected states

**Exit:** unauthenticated users see login rather than trade data; every required workflow completes from the UI; derived values recalculate after create, amend, and remote updates; the table stays usable at 1,000 trades; live updates are visible across two sessions.

### Phase 8 — Testing and hardening

- Service-level lifecycle tests as the primary correctness surface
- PostgreSQL integration tests for transactions, constraints, audit atomicity, and concurrent conflicts
- Authentication integration tests for sessions, protected resources, expiry, logout, and actor attribution
- Route-schema and OpenAPI generation tests, plus generated-client drift checks
- Focused frontend tests for calculations and recovery flows
- Accessibility, responsive layout, and keyboard focus checks
- A documented manual demo checklist

**Exit:** the documented test command passes; lifecycle, terminal-state, version, concurrency, audit, and auth invariants are covered; tests run against PostgreSQL rather than a behaviourally different substitute.

### Phase 9 — Documentation and submission polish

- Complete README, `ARCHITECTURE.md`, and canonical docs
- Complete the AI usage report with accepted, modified, and rejected suggestions plus verification evidence
- Curate the prompt log
- Check `AGENTS.md` links and commands against the final structure
- Update ADRs if decisions changed during implementation
- Confirm a fresh local setup works from the documented instructions
- Record known limitations honestly

**Exit:** a reviewer can run the project from the README alone; optional features are labelled optional.

## Testing Strategy

Backend correctness is the highest priority. Test observable behaviour, not internal call sequences. Do not mock what the correctness depends on — PostgreSQL transaction and constraint behaviour is part of what is being verified.

### Priority 1 — Trade lifecycle and invariants (service level)

- Table-driven create, amend, execute, and cancel tests
- Validation of quantity, price, side, required fields, and command versions
- Terminal-state protection: `EXECUTED` and `CANCELLED` cannot mutate
- Version tests proving each successful mutation increments exactly once
- Audit tests proving each mutation produces exactly one correctly versioned event and snapshot
- Rejected-command tests proving no state change and **no audit event**
- Rejected-command tests proving **no SSE notification**

### Priority 2 — PostgreSQL, concurrency, and authentication integration

- Migrations applied against an isolated test database or schema
- Two concurrent writes against the same version: exactly one succeeds, the other gets `409`
- Atomicity: trade and audit writes commit or roll back together
- Constraints: unique trade identifiers and unique `(tradeId, tradeVersion)`
- SSE emitted only after a successful commit
- Unauthenticated REST returns `401`; unauthenticated SSE is rejected; a valid session is allowed
- Expired, revoked, and logged-out sessions are unusable
- Passwords are hashed, raw session tokens are not persisted, safe user responses exclude sensitive fields
- Login success, generic login failure, rate limiting, and secure cookie configuration
- Audit actor always matches the authenticated user
- A client cannot spoof actor identity by sending `actorUserId` or `trader`
- Module errors map to stable status codes and documented error schemas

### Priority 3 — Contract and UI behaviour

- Route-schema tests for commands, responses, errors, and the SSE payload
- OpenAPI checks for stable operation IDs, cookie security, required paths, and documented errors
- Regeneration check proving the generated client stays in sync with the backend contract
- Compile-time check that the generated client integrates without handwritten REST DTOs
- Runtime validation of malformed SSE payloads using the generated schema
- Lint checks enforcing the documented module and layer boundaries
- Frontend: derived-value formulas, sign and precision, connection-state resolution, audit diffing, form validation, stale-form warning, and `409` recovery

### Manual demo checklist

Start from a clean database. Log in as each demo user and confirm invalid credentials reveal nothing. Confirm seed trades appear. Open two windows. Create, amend, execute, and cancel in one and watch the other update. Confirm derived values recalculate. Confirm each amendment increments the version while status stays `NEW`. Open the same version in two windows and confirm the second amendment receives `409` without overwriting the first. Inspect audit history and confirm the ordered event/version sequence and the acting user. Disconnect the network and confirm the UI reports it within seconds. Log out and confirm REST data and notifications are no longer accessible. Run the test command.

## Key Trade-Offs To Explain

- **Modular monolith with Service and Repository layers, organised by feature.** Grouping by module keeps everything about trades in one directory, so a reviewer reads one folder instead of jumping across five global layer directories. Grouping globally by technical layer scales worse as features grow. The cost is that "where does this file go?" needs a convention; the naming scheme and dependency rules supply it.
- **Modules over hexagonal.** A small, well-understood shape a reviewer can follow end to end in minutes. Ports, adapters, and aggregates would add indirection with only one implementation behind each seam. The cost is that business rules live in services rather than a framework-free domain module; the dependency rules and lint enforcement keep that honest.
- **Use-case-specific repository methods over generic repositories.** `executeWithAudit(input)` keeps the compare-and-swap and the audit insert inseparable. A generic `IRepository<T>` would let a caller combine primitives in a way that breaks atomicity.
- **Audit inside the trades module, not its own module.** The audit trail exists only because of trade mutations and must be written in the same transaction. A separate module would add a boundary across a transaction, which is exactly the wrong place for one.
- **Generic SSE infrastructure outside the modules.** Connection tracking is transport, not trade behaviour, so it stays in `realtime/`. The trade service publishes through a small typed publisher rather than an event bus.
- **PostgreSQL from the outset.** Migrations, transaction semantics, constraints, and concurrency tests stay aligned with the submitted runtime. Docker is the documented prerequisite.
- **Opaque PostgreSQL-backed sessions over JWTs.** Easy to revoke, keeps credentials out of frontend storage, and fits a same-origin monolith. The extra lookup is acceptable at this scale.
- **Authentication without authorization tiers.** Authentication is justified by audit attribution. Roles would expand scope without demonstrating anything the audit trail does not already show.
- **OpenAPI + Orval over a shared TypeScript contracts package.** A generated, language-neutral network seam is a stronger boundary than a shared import, and it keeps backend service/repository types and frontend view models private. The cost is a build step, so generated output is committed and CI verifies reproducibility.
- **SSE over WebSockets.** Trade updates are one-way server-to-client notifications, so SSE is sufficient and operationally smaller. WebSockets were considered and rejected; if bidirectional streaming is ever needed, the transport can be replaced while keeping the REST interface, module services, versioned event contract, and persistence rules.
- **Best-effort notifications with REST reconciliation.** A transactional outbox would guarantee delivery; refetch-on-reconnect achieves correctness for this scope at a fraction of the complexity.
- **Event sourcing rejected.** An append-only audit table with before/after snapshots gives the reviewable history the assessment asks for. Event sourcing would invert the persistence model, add projection and replay machinery, and complicate the concurrency story without improving any required behaviour.
- **Derived metrics stay UI-only.** Avoids duplicated state and stale persisted calculations. If server-side sorting on a derived value is ever needed, compute the equivalent expression in the query projection without storing it.
- **Full before/after audit snapshots.** Intentionally simple and reviewable; a larger system might store structured field-level changes.

## Suggested Timeline (8–15 hours)

- 1–1.5h — workspace, OpenAPI/Orval pipeline, PostgreSQL, agent guidance, CI skeleton
- 3.5–4.5h — trades module: schemas, service, repository, audit trail, optimistic concurrency, seed data
- 1–1.5h — REST routes and OpenAPI contract
- 1–1.5h — auth module and sessions
- 1h — SSE notifications
- 3–3.5h — login/session UX, blotter, forms, filters, audit view, live updates
- 2–3h — service tests, PostgreSQL integration tests, focused UI tests
- 1–1.5h — documentation, AI usage report, final polish

## Final Deliverable Checklist

- Required folders exist: `frontend/`, `backend/`, `database/`
- Backend is a modular monolith organised by feature, with `routes/ -> schemas/ + dtos/ -> services/ -> repositories/` subfolders inside each module
- Cross-cutting `realtime/` and `infrastructure/` sit outside the modules; auth middleware lives inside the auth module
- Every module exposes an `index.ts`, and cross-module imports go through it rather than into another module's internals
- Module nesting stops at `modules/<module>/<layer>/<file>`
- Routes are thin, contain no business rules, and never touch Prisma
- Services own lifecycle rules; repositories own persistence
- Audit lives in the trades module and is written in the same transaction as the trade
- The trades module's services do not import the auth module; they receive an authenticated actor as a value
- No domain aggregates, ports/adapters, generic repositories, CQRS infrastructure, or event sourcing
- Backend route schemas generate a deterministic OpenAPI document and typed frontend client
- No shared frontend/backend TypeScript contracts package
- Frontend contains no handwritten REST DTOs or endpoint wrappers; `npm run api:check` passes and fails on drift
- SSE uses a small handwritten adapter with a generated payload type and runtime validator
- Trade statuses are `NEW | EXECUTED | CANCELLED`; `AMENDED` is only an audit event type
- Trades expose a monotonically increasing version and reject stale updates
- Optimistic concurrency is enforced by a conditional PostgreSQL write, not only an in-memory check
- Every trade mutation creates an atomic, append-only audit event
- Rejected commands create neither audit records nor notifications
- Trade creators and audit actors come from the authenticated session
- Users authenticate through revocable server-side sessions stored in PostgreSQL
- No roles, RBAC, JWTs, browser-stored tokens, or external identity providers
- Trade REST endpoints and the SSE stream reject unauthenticated access
- Passwords, raw session tokens, and secrets are never exposed or committed
- Empty database seeds realistic data
- UI supports login, logout, view, create, amend, execute, cancel, and audit inspection
- UI displays derived notional and signed values without persisting them
- Sorting and filtering work, including on derived columns
- Live updates work across two clients, and a dropped connection surfaces within seconds
- `npm run verify` passes locally and in CI from a clean checkout
- README, `ARCHITECTURE.md`, `AGENTS.md`, domain rules, testing strategy, and ADRs are consistent with the implementation
- AI usage report and prompt log are included

## Implementation Status

The backend has been restructured to match this plan. The layout, boundaries, and endpoints above describe the repository as it stands.

What the restructure delivered:

- `modules/{trades,auth}/` reorganised into `routes/ + schemas/ + dtos/ + services/ + repositories/` (plus `mappers/`, `errors/`, and for auth `middleware/`), each with an `index.ts` barrel
- `trade-store.ts` split into `TradeService` (rules, orchestration, post-commit publication), `TradeRepository` (Prisma, transactions, compare-and-swap), `TradeAuditRepository` (append-only writes taking the caller's transaction client), and `trade.mapper.ts`
- `auth-service.ts` split into `AuthService`, `UserRepository`, `SessionRepository`, and `middleware/require-auth.ts`
- Lifecycle rules moved to `services/trade-lifecycle.ts` as pure functions — a private helper of the service layer, and the primary test surface
- SSE moved out of the trades module to `realtime/sse/` (broker, stream route, trade publisher), and the endpoint renamed to `GET /api/events`
- `infrastructure/` gained validated `config/env.ts`, a shared `errors/` base plus the `ApiError` envelope, and `logging/`
- Errors became typed classes carrying their own HTTP status, so routes map them uniformly instead of switching on codes
- ESLint rewritten from domain-purity rules to 13 module and layer boundaries, with `npm run lint:boundaries` asserting each one actually rejects a violation

Remaining gaps against this plan, all additive:

- `ARCHITECTURE.md`, `AI_USAGE.md`, `PROMPT_LOG.md`, `database/README.md`, `docs/domain-rules.md`, `docs/testing.md`. `docs/domain/trade-lifecycle.md` should move to `docs/domain-rules.md`
- Four ADRs exist; nine are listed here, so five need writing and the existing ones renumbering
- `GET /api/positions` (optional), table virtualization (optional), React Testing Library component tests, and `docker-compose.yml` services for the backend and frontend
