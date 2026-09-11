# ADR 0006: Server-Side Derived Columns And Aggregates

## Status

Accepted.

## Decision

Sort and aggregate derived trade metrics in PostgreSQL. The list query is a
single statement that orders by a whitelisted expression — `quantity * price`
for notional, a signed `CASE` for the signed columns — and reports its own total
through `COUNT(*) OVER()`. Exposure and status counts come from
`GET /api/trades/exposure`, which takes the same filter parameters as the list.

Notional is still never stored. An expression index on `(quantity * price)`
backs the ordering.

## Rationale

Notional, signed quantity and signed notional are derived, so they used to be
sorted in the browser. That only ever reordered the loaded page: asking for "the
largest notional" returned the largest notional *on page one of a
timestamp-ordered list*, with nothing in the UI saying so. The same applied to
the exposure strip, which summed the visible rows and therefore changed its
"net exposure" as the user paged.

Ordering by an expression needs the sort key to reach SQL as an identifier,
which no parameter placeholder can carry, so the list query is raw SQL with a
whitelist rather than a query-builder call. Running it as one statement also
fixes a smaller problem: the page and its count were two statements, and under
READ COMMITTED each got its own snapshot, so the footer could contradict the
rows above it.

Monetary aggregates are returned as decimal strings. A sum of `quantity * price`
across a book can exceed the range a JSON number represents exactly, and an
exposure figure that is approximately right is worse than useless.

That last point also settles how the strip stays current: it refetches on the
same signal as the table rather than being incremented client-side. An
incremented figure would have to reproduce the SQL exactly — including that the
notional sums carry no status predicate, so an execution shifts a bucket and
leaves exposure unchanged — and any drift between the two would show up as a
number that is approximately right, which for exposure is worse than useless.
Refetching costs a request and cannot drift. See the trade-off recorded in
ADR 0003 for what that costs at scale.

## Consequences

The repository holds hand-written SQL, so its column list and the Prisma model
have to be kept in step — `TRADE_COLUMNS` exists to make that one edit. Keeping
the aggregate on the server means there is no second implementation of these
sums to hold in step with it, at the cost of a request whenever the figures may
have moved. In exchange, every column the table offers to sort by actually
sorts the whole result set, and every figure in the exposure strip describes the
same set of trades as the rows beneath it.
