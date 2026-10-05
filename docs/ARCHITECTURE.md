# Architecture

## Baseline

The web ERP uses Next.js and TypeScript. The API is a separately deployable Node.js/TypeScript service. PostgreSQL is the system of record. Clients communicate only with the API; database credentials belong only to the server environment. A private object store, asynchronous queue, managed secrets, monitoring, and encrypted backups are production integration points.

## Boundaries

- Presentation: web ERP now; owner mobile and staff apps can be added as API clients.
- API: authentication, request validation, authorization, stable errors, and rate limits.
- Domain: business rules and posting workflows; financial and stock effects must commit atomically.
- Data: PostgreSQL migrations are version controlled. Transaction rows carry company and branch context where applicable.
- Evidence: loading photos and documents use private object storage; the database retains immutable metadata and links.
- AI/integrations: controlled application tools and read models only. No unrestricted SQL or direct journal writes.

## Security invariants

- Every protected route checks authentication and the required action permission.
- Sessions are opaque bearer tokens; only token hashes are stored in PostgreSQL.
- Financial and stock records are corrected through auditable reversals or adjustments, never silent deletion.
- Tenant/branch context is resolved on the server and must not be trusted from client totals or identifiers alone.
- Secrets are supplied through the deployment environment and are never committed.

## Delivery sequence

Follow the roadmap in `MASTER_PRD.md`: foundation and access control; masters; production/stock; sales/accounting; loading/delivery; labour; purchases/expenses; owner approvals; audit center; then integrations and AI. Confirm unresolved business rules with the owner/accountant before enabling the affected workflow.
