# ADR 0001: Modular Monolith

## Status

Accepted.

## Decision

Use one Fastify deployable split into vertical authentication and trade modules. Keep trade decisions in a pure domain module and place Prisma and HTTP at outer boundaries.

## Rationale

The assessment needs strong domain behavior and clear ownership without distributed-system overhead. The pure decision function gives lifecycle rules a compact, fast test surface while one process keeps transactions and local development simple.

