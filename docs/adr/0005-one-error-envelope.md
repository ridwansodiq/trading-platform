# ADR 0005: One Error Envelope

## Status

Accepted.

## Decision

Map every failure to an HTTP response in a single Fastify error handler. Routes
throw and never catch. An error supplies its own extra context by overriding
`ApplicationError.body()`. Every route documents `400`, `401` and `500`
alongside its success shape, and the same `{ code, message, details? }` envelope
covers validation failures, business rejections, unknown routes and unexpected
faults.

## Rationale

The mapping previously existed in three places — the trade routes, the auth
routes and the auth guard — and none of them covered request validation. Zod
rejections therefore returned Fastify's own envelope with an `FST_ERR_VALIDATION`
code, under a status code no route declared, so the generated client had no
branch for the single most common client error.

One handler also removes the reason routes had to reach for data: a version
conflict now carries the current trade because the error does, rather than
because the route performs a second lookup while building the response.

Unexpected errors are logged and replaced with a fixed sentence. Their messages
can contain connection strings, SQL, or internal paths.

## Consequences

Adding a status code to a route means adding it to the schema — the contract and
the behaviour cannot drift apart, because the handler has nowhere else to put a
response. Errors that need context must express it as data (`body()`) rather
than as special-casing at the edge.
