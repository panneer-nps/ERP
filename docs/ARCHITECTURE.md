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

## Implemented product areas

The active implementation includes first-company/Owner setup; Manager, Cashier, Auditor and custom permission roles; company/branch scoping; masters and configurable product units; production and WIP costing; stock movements, FIFO, transfers, stocktakes and valuation reports; sales, invoices, receipts, returns and broker commission; loading, evidence, dispatch and delivery; purchases, supplier bills/returns/payments; attendance, advances and payroll; expenses and approvals; double-entry accounting, cash/bank reconciliation and financial reports; audit exports; bilingual Owner workflows; and encrypted local offline expense/photo recovery. The route and behavior evidence is maintained in `IMPLEMENTATION_STATUS.md`, with acceptance scenarios in `TEST_PLAN.md` and `UAT.md`.

## Remaining rollout work

Core workflows and database integration checks do not replace company rollout approval. The current open gates include populated-company historical valuation/accounting reconciliation, owner/accountant approval of unresolved posting cutoffs and configuration, CA/tax review, real-device offline and weak-network UAT, browser print/PDF review, production object-storage/security/monitoring configuration, scheduled encrypted backups and managed PostgreSQL PITR, and business-approved RPO/RTO and support/rollback procedures. Track each item in `UAT.md`; do not infer business rules from synthetic tests or enable statutory behavior before professional review.
