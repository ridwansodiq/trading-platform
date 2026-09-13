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
requests from every browser. Two changes would address it, and neither needs a
different transport: debounce the refetch into a trailing window; and apply the
canonical trade the event already carries straight to the cached page, guarded
on `version` so duplicate and out-of-order frames stay harmless, and refetch
only for what a single page cannot settle (membership, ordering, and an
amendment's missing prior values).

**What the client can say about the connection.** A third gap has since been
closed. `EventSource` reports a socket it knows to be broken, but a connection
that dies without a FIN can sit open indefinitely raising nothing, so silence
past two 5s heartbeats is now treated as a dead stream. The transport's own
answer is layered under two others: a drop the browser is still retrying reads
as reconnecting rather than as a dead desk, and a machine with no network is
named as offline, because the remedy there is the user's rather than the
server's.

This is a deliberate scope cut for an exercise, recorded here because it is the
first thing to revisit if the blotter ever faces real volume. The simple version
is correct at any scale — it is only wasteful.

**How a client resumes after a drop.** Every event frame is identified by the
audit event's `streamSequence`, assigned by a PostgreSQL sequence inside the
same transaction as the trade change it records. That gives the log a total
order, which `tradeVersion` cannot: a version ranks one trade's own history and
says nothing about two trades against each other. A browser already echoes the
last id it saw in `Last-Event-ID`, so a reconnect is answered by replaying
everything after that cursor, oldest first, and no client-side bookkeeping is
needed to take part.

Keeping the cursor in the database rather than in the process is what makes this
correct beyond one instance: several replicas draw from the same sequence, a
restart loses nothing, and no application code has to ask what the last number
was. Gaps are accepted — a rolled-back transaction keeps the value it drew — and
cost nothing, because the cursor is only ever compared, never counted.

Two consequences are deliberate. The replay runs *after* the connection joins
the broadcast, so the overlap between the two is duplicate frames rather than a
gap, and a duplicate is already harmless. And it is bounded: past that bound a
returning client is short of events the stream will not send, which is precisely
what the refetch it performs on every connect is for. REST stays authoritative
either way; replay narrows the window in which the table is behind, it does not
replace the refetch.

The generated client, validators and `openapi/openapi.json` are committed, so a
clone builds and runs without a code-generation step. The cost is that
regeneration is manual: after changing a backend Zod schema, run
`npm run api:generate` and commit the result. An earlier `api:check` step
regenerated inside `npm run verify` and failed on any difference, which caught
staleness automatically but put a generator on the critical path of every setup
and CI run. For an exercise of this size, a reviewer reaching a running
application in one command was judged worth more than an automated guarantee
that the committed contract is current.
