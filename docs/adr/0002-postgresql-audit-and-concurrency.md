# ADR 0002: PostgreSQL Audit And Concurrency

## Status

Accepted.

## Decision

Use PostgreSQL from the outset. Store the current trade and an append-only audit table. Apply non-create commands with a conditional version update and insert the audit event in the same transaction.

## Rationale

Relational constraints and transactions directly support mandatory audit history and optimistic concurrency. An in-memory adapter would weaken the most important behavior being demonstrated.

