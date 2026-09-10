# ADR 0004: Session Authentication

## Status

Accepted.

## Decision

Use Argon2id password hashes and random opaque session tokens. Persist only SHA-256 token hashes and deliver the raw token in an HTTP-only, same-site cookie. Resolve the command actor on the backend.

## Rationale

This keeps authentication narrow while making audit attribution trustworthy. It avoids browser token storage and prevents clients from impersonating another audit actor.

