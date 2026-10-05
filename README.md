# Brick Chamber ERP

Brick Chamber ERP is a fresh implementation of the approved Master PRD. The PRD is preserved in [`docs/MASTER_PRD.md`](docs/MASTER_PRD.md); product rules that vary by business are intended to be configured rather than embedded in code.

## Project foundation

- `backend/` — TypeScript REST API, PostgreSQL connection, health checks, session authentication, and action-level authorization.
- `backend/migrations/` — versioned PostgreSQL schema for company setup, identity, permissions, sessions, and audit history.
- `frontend/` — Next.js TypeScript web client foundation.
- `docs/` — product source of truth and architecture notes.

This is the first project increment (foundation and access control). Business modules in the PRD are not represented as complete until their transactional workflows, accounting/stock effects, approvals, audit events, and UI are implemented.

## Requirements

- Node.js 20 or newer
- PostgreSQL 15 or newer

See [backend/README.md](backend/README.md) for setup. Never expose PostgreSQL directly to the public internet; clients must use the authenticated API.
