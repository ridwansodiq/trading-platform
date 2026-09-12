# AI Usage

AI tools were used to help plan, design, implement, and verify this take-home project.

## Tools Used

- **ChatGPT / Codex:** architecture discussion, implementation planning, code generation, testing, documentation, and browser-based UI checks.
- **Claude Design:** creation of the visual design handoff used as the frontend reference.
- **Claude Code:** review of the built application against the plan and the designs, the backend restructure, refactoring, the demo simulation, a pass that removed structure which had stopped paying for itself, and the final work on containerisation, stream resumption and frontend test coverage. Used across a series of sessions, working against the running app and driven largely by screenshots and code review rather than fresh specification.

## How AI Helped

AI supported the project by:

- Turning the assessment brief into an implementation plan.
- Exploring architecture and technology choices.
- Scaffolding the React, Fastify, Prisma, and PostgreSQL application.
- Implementing authentication, trade workflows, audit history, optimistic concurrency, REST endpoints, and SSE notifications.
- Producing the Tailwind UI from the supplied design handoff.
- Generating tests, OpenAPI clients, documentation, and CI configuration.
- Running type checks, linting, boundary assertions, tests, builds, and responsive browser checks.
- Reviewing the built result against the plan and the design handoff, then applying the gaps found.
- Restructuring the backend from a Hexagonal/Clean layout into the layered modular monolith, and encoding the resulting boundaries as ESLint rules with probes that assert the rules actually reject violations.
- Adding the demo simulation behind the **Simulate** menu item, first as a server-side module and later, once the server loop was dropped, as a standalone browser-side component.
- Auditing the accumulated structure for complexity that no longer earned its place, and removing it: the `dtos/` layer, the contract drift guard, and the process documents that were working material rather than deliverables.
- Extending frontend test coverage to the stateful parts that had none — dialogs, URL query state and shared hooks — which took the frontend suite from 118 tests to 222.
- Containerising the application so `docker compose up --build` builds both workspaces, migrates, seeds and serves the API and SPA from one origin.
- Adding `Last-Event-ID` replay to the SSE stream, backed by a database-assigned sequence over the audit log, with integration tests covering ordering, replay and cursor rejection.

## Human Direction And Review

The main product and architecture decisions were explicitly directed and reviewed by the developer, including:

- Trade status is limited to `NEW`, `EXECUTED`, and `CANCELLED`.
- Amendment is a versioned audit event, not a business state.
- Audit history is mandatory and records the authenticated actor.
- PostgreSQL is used from the beginning.
- Optimistic concurrency prevents stale updates.
- REST handles commands and queries; SSE handles update notifications.
- Notional is calculated in the UI and is not persisted.
- Frontend contracts are generated from the backend OpenAPI schema, and the generated output is committed so the application runs from a clone without a code-generation step.
- Tests focus primarily on domain correctness.
- The frontend uses Tailwind and the supplied design handoff.
- The backend uses a conventional layered structure rather than Hexagonal/Clean, with no ports/adapters, generic repositories, CQRS, or event sourcing.
- High-cardinality filters (trader, book, counterparty) are searched server-side so they scale past the current page.
- Offline and reconnecting states must surface within seconds.
- The demo simulation lives entirely in the browser and issues ordinary REST commands, so a simulated action is indistinguishable from a real one in the audit log and on the stream, and the server carries no demo code.
- Scaffolding is cut before functionality: where the structure had grown past what the brief needs, the layers and guards were removed rather than the features, which are largely the brief's own bonus items.
- A layer earns its place by doing work. The `dtos/` directory was merged into `schemas/` because most of it restated the schema beside it, while the genuine domain vocabulary was kept as a `types.ts` per module.
- Process documents — the implementation plan and the agent working notes — are working material and are deliberately excluded from the submission.
- A reviewer should need Docker and nothing else: one command builds, migrates, seeds and serves, with the API serving the built SPA so the whole demo sits on one origin.
- The SSE stream is resumable. A reconnecting client names what it already has via `Last-Event-ID` and is sent what it missed, ordered by a sequence PostgreSQL assigns in the same transaction as the change — in the database rather than the process, so it stays correct across replicas and restarts.
- Replay narrows the window in which the blotter is behind; it does not replace the refetch on connect, and REST stays authoritative.
- Weakened defaults are escape hatches, not settings: `SESSION_COOKIE_SECURE` defaults to on in production and is overridden only in the local compose file, where the demo is served over plain HTTP.

All generated work was inspected and verified locally. AI output was treated as a starting point rather than assumed to be correct, and AI recommendations were rejected where they did not hold up — the same simplification review that proposed the cuts above also advised against collapsing the frontend hook stack, on the grounds that the pure-logic modules beneath it are what the test suite hangs off.

## Verification

The final implementation was checked with:

```bash
docker compose up --build   # the whole application, as a reviewer runs it
npm run verify              # the full local gate
```

This runs type checking, linting, the architecture boundary assertions, domain and integration tests, frontend tests, and production builds. The generated API client is committed rather than regenerated here, so after changing a backend Zod schema, `npm run api:generate` has to be run and its output committed — a deliberate trade-off recorded in ADR 0003. The main workflows were also exercised against PostgreSQL and reviewed in desktop and mobile browser layouts, and the container image was run end to end rather than only built.

Behaviour that a unit test cannot settle was measured against the running application rather than asserted. The login rate limit was confirmed by hammering it until it returned 429s rather than assuming the plugin was wired up, and stream resumption is covered by integration tests that drop a connection and reconnect with a cursor rather than by inspecting the code path.

