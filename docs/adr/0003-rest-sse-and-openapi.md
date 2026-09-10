# ADR 0003: REST, SSE, And OpenAPI

## Status

Accepted.

## Decision

Use REST for commands and queries and SSE for authenticated trade-update notifications. Define HTTP payloads with backend Zod schemas, publish OpenAPI, and generate frontend types, clients, hooks, and validators with Orval.

## Rationale

Trade updates are server-to-client notifications, so SSE is sufficient and operationally smaller than WebSockets. REST remains authoritative. If bidirectional streaming becomes necessary, the notification transport can later be replaced without changing command semantics. Generated contracts prevent frontend/backend DTO drift.

