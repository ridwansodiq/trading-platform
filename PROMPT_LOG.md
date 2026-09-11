# Prompt Log

A representative sample of the prompts that materially shaped this project, not a complete
transcript. Prompts are condensed and paraphrased from the original sessions; the **Result**
column describes what was actually built and kept, including the things that were later
removed again.

Four tools were involved: ChatGPT/Codex for planning and the first implementation, Claude
Design for the visual handoff, and Claude Code across four review-and-refinement sessions
working against the running application.

## 1. Planning And Initial Implementation (ChatGPT / Codex)

| Focus | Prompt summary | Result |
| --- | --- | --- |
| Initial planning | Turn the assessment brief into a delivery plan: scope the domain, pick the stack, and sequence the work so a reviewer can run it in one command. | Created the implementation plan and architecture outline the rest of the work was measured against. |
| Trade lifecycle | Model trade status as `NEW`, `EXECUTED`, `CANCELLED` only. An amendment changes a trade's contents, not its lifecycle position, so it must not appear in the status enum. | Removed amendment from the business-state model; transitions and amendments became separate operations. |
| Versioning and audit | Treat every amendment as a versioned event and make audit history mandatory rather than optional — a trade's current row should never be the only record of what happened to it. | Added monotonic trade versions and `CREATED`, `AMENDED`, `EXECUTED`, `CANCELLED` audit events, written in the same transaction as the change they describe. |
| Real-time transport | Keep REST authoritative for commands and queries, and use SSE purely for update notifications. The stream must not become a second write path. | An authenticated SSE endpoint that only notifies; every mutation still goes through REST and remains the single source of truth. |
| Concurrency | Two traders editing the same trade must not silently overwrite each other. Add optimistic concurrency with an explicit version token on every mutating command. | Added `expectedVersion`, made the database update conditional on it, and returned `409 VERSION_CONFLICT` with the current server trade so the client can reconcile rather than guess. |
| Derived fields | Values derivable from stored columns — notional, signed quantity — should be computed, never persisted, so they cannot drift from their inputs. | Derived values calculated for display with decimal arithmetic; nothing derived is stored. |
| Technology choices | Commit to PostgreSQL from the start rather than migrating off SQLite later, share the request/response contract across the stack, and weight the test suite toward domain correctness. | Prisma and PostgreSQL from the first migration, OpenAPI-generated clients and validators, and lifecycle tests as the fastest feedback loop. |
| Architecture | Review the proposed structure critically: is Hexagonal/Clean justified here, or is it indirection with a single implementation behind every seam? | Kept pure lifecycle rules isolated inside the trades module with HTTP and Prisma at the edges — revisited later (see §2). |
| Repository legibility | Add the structure and documentation that make this codebase navigable by both a reviewer and an AI tool: domain rules, decision records, enforced module boundaries. | Added agent-facing working notes, `docs/domain/trade-lifecycle.md`, ADRs, generated-contract rules, and clear module boundaries. The working notes are kept out of the submission as working material rather than a deliverable. |
| Visual design | Write a Claude Design prompt for a dense, professional trading interface — information-first, not marketing-styled. | Produced the design handoff used as the frontend reference. |
| Authentication | Add a small session-based authentication layer, enough to attribute every trade action to a real actor in the audit log. | Login, logout, current-user resolution, protected routes, and actor attribution flowing into every audit event. |
| Frontend styling | Build the UI with Tailwind rather than hand-rolled CSS. | Application UI built with Tailwind and Lucide icons. |
| Implementation | Implement the agreed plan against the design handoff. | Delivered the working full-stack application. |

## 2. Review And Restructure (Claude Code)

Three sessions of review against the running application, driven largely by screenshots of
the UI and by reading the code as built rather than by fresh specification.

| Focus | Prompt summary | Result |
| --- | --- | --- |
| Implementation review | Review what was actually built against the implementation plan and the design handoff, and report where they diverge. | Identified the gaps between plan, design and delivered code; these drove the rest of the session. |
| Design fidelity | The UI does not match the designs. Go through it again in detail, screen by screen. | Reworked the blotter against the handoff, reviewed screenshot by screenshot. |
| Frontend conventions | Move the UI onto ShadCN primitives and fix the folder structure — features should be vertical slices, not a flat pile of components. | Vendored ShadCN primitives and adopted the `features/<name>/{components,hooks,lib}` slice layout, with pure logic in `lib/` where it is cheapest to test. |
| Table interaction | Collapse the per-row actions into a single dropdown pinned to a right-hand column, so adding a lifecycle action later does not widen the grid. | A per-row action menu fixed in a right-hand column. |
| Filter scalability | The trader, book and counterparty filters are hardcoded lists. They have to scale to thousands of distinct values, so the options cannot live in the client. | Replaced the static selects with server-side searched comboboxes behind `GET /api/trades/filter-options`. |
| Connection feedback | Going offline takes far too long to surface. A trader must know within seconds that the blotter may be stale, and `EventSource.onerror` alone is not a sufficient signal. | Derived connection state from `navigator.onLine`, socket closure and heartbeat silence together, with the toolbar stating explicitly when the table may be behind. |
| Backend architecture | Replace the Hexagonal/Clean layout with a conventional layered modular monolith — `routes -> schemas -> services -> repositories`, organised by business module first. No ports/adapters, no generic repositories, no CQRS, no event sourcing: there is one implementation behind each seam. | Restructured the backend into the layered modular monolith, then encoded the layer rules as ESLint `no-restricted-imports` and added probes asserting the rules genuinely reject violations rather than merely being configured. |
| Generated contracts | Stop hand-maintaining parallel TypeScript types on both sides of the API. Generate the frontend contract from the backend schemas so the two cannot disagree. | Moved to OpenAPI generation with Orval, plus a drift check that regenerated and failed on any difference — the check was later removed, see §3. |
| Architecture review | Review the whole codebase and architecture for issues and worthwhile refactors, then apply them. | Applied the resulting refactors across both workspaces. |
| Demo data | The seed should produce 5,000 trades spread realistically across lifecycles, and reproduce exactly so a bug found against seeded data can be reproduced. | Rewrote the seed with batched inserts, a deterministic PRNG and mixed lifecycles. |
| Pagination | Allow jumping to the first and last page. | First/last controls in the blotter footer. |
| Table library | Move the blotter onto TanStack Table, keeping the server authoritative for ordering. | Headless TanStack Table v9, column definitions split into `blotter-columns.tsx`, sorting registered as the only feature and kept manual so the server's ordering stands, with sort state still owned by the URL. |
| Trade simulator | Add a Simulate control backed by its own endpoint that moves trades through the lifecycle until stopped, so live updates can be demonstrated without opening a second browser. | A server-side loop driving `TradeService`, so each simulated action was version-checked, audited and streamed exactly like a real one. |
| Simulator scope | It should act only on trades that are still live, and attribute its actions to the session that started it. | The loop picked a random non-terminal trade and attributed each action to the starting session's actor. |
| Module separation | Give the simulator its own module and route, and exempt it from the rate limit — a stop switch that can be throttled is not a stop switch. | Extracted `modules/simulator` behind `GET/POST /api/simulation`, both routes opted out of the global rate limit. |
| Simulation pace | Fix the cadence: one action per second, a new trade every third. | Replaced the random booking share with a fixed cadence, pinned by unit tests and measured against the running server. |
| Simulator removal | Remove the simulator module and its dependencies entirely. Keep the button, but drive it from the browser with ordinary REST calls inside the rate limit — demo tooling should not ship inside the server. | Deleted `modules/simulator`, its routes, schemas and tests, and the `GET/POST /api/simulation` contract. **Simulate** became a standalone browser-side component issuing ordinary REST calls. |
| Simulation loop | It should run until stopped, at two actions per second. | A module-scope loop the menu item subscribes to via `useSyncExternalStore`, timed from the start of each action so the round trip comes out of the wait and the rate holds. |
| Documentation | `AI_USAGE.md` and `PROMPT_LOG.md` do not yet cover the Claude Code work. Bring them up to date. | This log and the usage report. |

## 3. Simplification Pass (Claude Code)

A later session asking whether the accumulated structure was still paying for itself, and
removing the parts that were not.

| Focus | Prompt summary | Result |
| --- | --- | --- |
| Complexity review | This codebase may now be too complicated for what the brief actually asks. Audit it and tell me what to cut, ranked by reviewer confusion removed against risk taken. | Measured the repo at ~11.3k hand-written lines across 226 tracked files. Concluded the *features* were mostly on the brief's bonus list and earning their marks, and that the weight sat in machinery and process prose instead — so the advice was to cut scaffolding, not functionality. Explicitly advised **against** collapsing the frontend hook stack, since the pure-logic modules underneath it are what the tests hang off. |
| Working notes | The agent notes and the implementation plan are working material, not deliverables. Take them out of the submission. | `AGENTS.md` and `IMPLEMENTATION_PLAN.md` untracked and gitignored, removing ~69KB of process prose. The README linked to both, so those links were repointed at `docs/adr/` rather than left dead in a fresh clone. |
| Generated contracts, revisited | Keep the generation, but take it off the critical path: commit the output so a clone runs without a codegen step. | Deleted the `api:check` drift guard and removed it from `verify` and the setup instructions; `api:generate` remains available as a manual command. Running it once to confirm the committed output was current showed it was not — the spec still carried `Simulation*` schemas for endpoints deleted a session earlier — 181 lines of OpenAPI describing an API that no longer existed, and 187 across the generated artifacts as a whole. The trade-off is now recorded in ADR 0003. |
| Layer collapse | The `dtos/` layer is mostly `z.infer` aliases of the schema sitting next to it. Merge it into `schemas/`, keeping the genuine domain vocabulary as its own module-level file. | The trades module went from 21 files across 7 directories to 17 across 6. Each schema now sits with the command type derived from it, and the shared enums and internal trade representation moved to a single `types.ts` per module. All 19 boundary assertions still pass: `dtos/` and `schemas/` had identical import rules, so nothing was weakened by the merge. |
| Documentation sweep | Update the docs everywhere to match the new structure. | Corrected the layer chain in the README and ADR 0001, added a Consequences section to ADR 0003 recording the committed-output trade-off, fixed a CI comment still claiming `verify` checked contract drift, and removed pointers to a `design_handoff_fusion_trade_blotter/` directory no longer present in the repository. |
