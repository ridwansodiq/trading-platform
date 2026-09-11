# ADR 0003: REST, SSE, And OpenAPI

## Status

Accepted.

## Decision

Use REST for commands and queries and SSE for authenticated trade-update notifications. Define HTTP payloads with backend Zod schemas, publish OpenAPI, and generate frontend types, clients, hooks, and validators with Orval.

## Rationale

Trade updates are server-to-client notifications, so SSE is sufficient and operationally smaller than WebSockets. REST remains authoritative. If bidirectional streaming becomes necessary, the notification transport can later be replaced without changing command semantics. Generated contracts prevent frontend/backend DTO drift.

## Consequences

**How a client applies an event.** An event invalidates the trades cache and the
blotter refetches from REST. The event payload is read only for what a refetch
cannot answer — when the last update landed, and the version the server last
reported per trade, so a form open over a trade that has moved underneath it can
say so. Nothing is written into the cache from the stream, which is what keeps
REST unambiguously authoritative: the screen can only show state the server has
confirmed.

The cost is one round trip per event, per connected client, and every client
receives every event — so on a busy desk one trader's burst is a burst of
requests from every browser. Three changes would address it, and none needs a
different transport: debounce the refetch into a trailing window; apply the
canonical trade the event already carries straight to the cached page, guarded
on `version` so duplicate and out-of-order frames stay harmless, and refetch
only for what a single page cannot settle (membership, ordering, and an
amendment's missing prior values); and watchdog the 5s heartbeat, since
`EventSource` can leave a silently dead socket reporting "live" for minutes.

This is a deliberate scope cut for an exercise, recorded here because it is the
first thing to revisit if the blotter ever faces real volume. The simple version
is correct at any scale — it is only wasteful.

The generated client, validators and `openapi/openapi.json` are committed, so a
clone builds and runs without a code-generation step. The cost is that
regeneration is manual: after changing a backend Zod schema, run
`npm run api:generate` and commit the result. An earlier `api:check` step
regenerated inside `npm run verify` and failed on any difference, which caught
staleness automatically but put a generator on the critical path of every setup
and CI run. For an exercise of this size, a reviewer reaching a running
application in one command was judged worth more than an automated guarantee
that the committed contract is current.
