# Trade Lifecycle

## State And Version

A trade starts at version 1 in `NEW`. Amendment changes mutable economic or booking fields while keeping the trade in `NEW`. Execute and cancel move it into terminal states.

An amendment applies **only the fields it sends**. An omitted field keeps its current value, so two traders amending different fields of the same trade do not overwrite one another.

| Command | Required current state | Resulting state | Audit event |
| --- | --- | --- | --- |
| Create | none | NEW | CREATED |
| Amend | NEW | NEW | AMENDED |
| Execute | NEW | EXECUTED | EXECUTED |
| Cancel | NEW | CANCELLED | CANCELLED |

Every successful command creates the next monotonically increasing version. Terminal trades cannot be amended, executed again, cancelled, or undone.

## Optimistic Concurrency

Clients send the version they read as `expectedVersion`. The application first evaluates the command against that snapshot, then PostgreSQL conditionally updates the row using the ID, expected version, and `NEW` status.

If no row matches, the count alone cannot say why, so the transaction reads the row back and reports the real reason: `TRADE_NOT_FOUND`, `INVALID_TRADE_TRANSITION` for a terminal trade, or `VERSION_CONFLICT`. A terminal trade is reported as such even when the version is also stale — it cannot be amended at *any* version, so inviting a retry would be misleading. The in-memory guard checks the same conditions in the same order, so a command rejected before the write and one that loses a race give the same answer.

A `VERSION_CONFLICT` carries the current trade, so the UI can show the diff without a second request.

## Audit

Audit is mandatory and append-only. Each event records event type, resulting version, actor identity, timestamp, and complete before/after snapshots. The trade mutation and audit insert share one PostgreSQL transaction, so neither can commit alone.

The `after` snapshot is taken from the row the database stored, not from the state the command asked it to store, so the log cannot record a value that was never persisted. Its `createdAt` is the database default: an append-only log is only trustworthy if its clock is the one thing a caller cannot influence.

