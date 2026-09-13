# ADR 0001: Modular Monolith

## Status

Accepted.

## Decision

Use one Fastify deployable organised first by business module — `trades` and
`auth` — and only then by technical responsibility inside each:
`routes/ -> schemas/ -> services/ -> repositories/`. Business rules live in
`services/`, Prisma and transactions in `repositories/`, HTTP in `routes/`. Each
module's shared vocabulary — its enums and internal trade representation — sits in
a single `types.ts` at the module root; request/response shapes and the command
types derived from them live together in `schemas/`. Supporting directories sit
beside the four layers where a module needs them: `errors/` for the failures a
module raises, `trades/mappers/` for the row-to-domain translation its raw SQL
needs, and `auth/middleware/` for the `requireAuth` guard.

Every module exposes an `index.ts`, and cross-module imports resolve through that
barrel rather than into another module's internals. Cross-cutting `realtime/` and
`infrastructure/` sit outside the modules. The rules are enforced by ESLint
`no-restricted-imports`, and `npm run lint:boundaries` asserts the rules actually
reject violations rather than trusting that they are configured correctly.

This is deliberately *not* Hexagonal, Clean Architecture, ports and adapters, DDD
aggregates, or CQRS. There is one implementation behind each would-be seam, so the
indirection would cost more than it returns.

## Rationale

The assessment needs strong domain behavior and clear ownership without
distributed-system overhead. One process keeps transactions and local development
simple — the trade mutation and its mandatory audit event share a PostgreSQL
transaction precisely because nothing is distributed.

Vertical modules put everything about a capability in one place, so a reviewer can
follow it end to end in minutes. The cost is that business rules live in services
rather than a framework-free domain module; `services/trade-lifecycle.ts` keeps the
pure lifecycle decisions isolated and cheaply testable anyway, and the lint-enforced
dependency rules keep the layering honest.

The `auth` boundary shows the shape paying off: the trades module never imports it.
The composition root hands trade routes the `requireAuth` guard and the service an
authenticated actor as a plain value, so trades depends on a signature rather than
on identity — one module borrows another through its public surface, never past it.

## Consequences

Adding a capability means adding a module and its barrel, not threading a new
concern through shared layers. A module that needs another module's behavior takes
its service as a constructor argument from the composition root, which is what keeps
the dependency direction visible in one file instead of implied across many.
