# Verification plan

This plan defines evidence for the workflows in [`MASTER_PRD.md`](MASTER_PRD.md). A passing synthetic integration run proves application behavior for its seeded scenario; it does not prove the business's populated records, tax treatment, production deployment, or professional sign-off. Current evidence and open UAT decisions are tracked in [`UAT.md`](UAT.md) and [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md).

## Before every change

- Read the affected PRD module and business-rule notes.
- Keep secrets and real company data out of tests and logs.
- For transaction integration, use a fresh disposable PostgreSQL database and an API configured only for that database. Never point a verifier at `backend/.env` or a live company database.
- Apply all migrations in order and confirm the database schema version before testing.
- Confirm the test company, API, database, object-store mock and temporary files are removed after the run; never delete a directory until its path and owning processes are verified.

## Test layers

| Layer | Evidence | Required checks |
| --- | --- | --- |
| Static | API TypeScript build; frontend TypeScript check; `git diff --check` | Strict type errors, broken formatting/whitespace |
| Pure/deterministic | `backend/scripts/verify-http-errors.ts`; `backend/scripts/verify-backup-manifest.ts`; `backend/scripts/verify-backup-tool-discovery.ts`; `backend/scripts/verify-openapi-contract.ts`; `frontend/scripts/verify-offline-outbox.mjs`; `frontend/scripts/verify-service-worker-shell.mjs`; `frontend/scripts/verify-audit-workbook.ts`; `frontend/scripts/verify-dashboard-cache.mjs` | Error mapping and credential redaction; full/legacy backup manifest validation, identifier quoting and PostgreSQL client-tool discovery; scoped OpenAPI paths and operations checked against source route registrations; encrypted local queue/retry/session isolation; offline shell caching and API/write cache bypass; formula-safe Unicode workbook structure; dashboard summary branch/date/session cache isolation |
| API + PostgreSQL | `backend/scripts/verify-*.ts` against a fresh disposable database | Authentication/roles; permissions/branch scope; constraints and validation; transaction atomicity; idempotency; audit events; ledger, FIFO and journal results. `verify-loading-verifier-role.ts` checks independent loading verification, denial of loading completion, and Manager compatibility. `verify-operational-role-migration.ts` checks existing-company seeding and rerun safety for Sales, Production, Loading and Store Staff presets. `verify-stock-adjustment-approval.ts` covers migration 107 adjustment requests and migration 108 stocktake value caps, bilingual queue details and submitter self-review prevention. |
| Legacy FIFO backfill | `backend/scripts/verify-purchase-fifo-backfill.ts` against a fresh database migrated through 100 and a local API | Backfill one traceable receipt, leave a receipt with a later outbound issue unvalued, preserve the original journal, and prove rerun does not duplicate layers |
| Cross-module integration | `backend/scripts/verify-sales-loading-delivery.ts` against a fresh migrated database and its test API | Setup → roles → production → stock/FIFO → purchase/payroll/expense → sales/invoice → loading/delivery → receipts/commission → financial reports and backup evidence |
| Web UAT | Local app at desktop and phone viewport, English and Tamil | Navigation, role-specific controls, input validation, visible errors, touch targets, no unintended horizontal overflow, profile/logo, print preview |
| Operational rehearsal | Isolated encrypted backup/restore and deployment configuration review | Checksum/decryption, schema/count comparison, access isolation, retention, restore ownership and RPO/RTO |

## Core database assertions

- Posting and its required journal, stock movement, FIFO layer, idempotency record and audit event commit together or roll back together.
- Duplicate requests with the same key and body replay the original result; changed-body reuse is rejected without a second posting.
- First-owner setup, staff creation/password reset and branch creation retries must replay the original result; branch creation must leave exactly one branch, stock yard and audit event.
- First-owner setup retries replay the original success after a lost response; the same key with changed setup details is rejected, with one company and one owner only. Idempotency fingerprints must not expose a fast digest of password fields.
- Owner/Manager/Cashier/Auditor authorization is checked at each API action, and branch users cannot access another branch's records.
- Posted account balances derive from journal lines; stock and valuation derive from stock movements/cost layers; customer, supplier, employee and broker balances derive from their ledger transactions.
- Debits equal credits for every journal and for trial-balance totals. Inventory, WIP, FIFO consumption/returns and cash/bank books reconcile to their control journals in scenarios where the source data is fully valued.
- Reversals, returns, approvals, session resets and company-profile changes retain reason/actor/time in the audit history.
- Invalid input, missing migration, unavailable database, lost offline encryption key, storage quota, and authorization failure are visible without leaking credentials or leaving partial records.

## Browser checks

- Inspect sign-in/setup and authenticated Owner, Manager and Cashier screens at a desktop viewport and at 390×844.
- Switch English ↔ Tamil and verify the rendered labels and document language update; restore the user's prior preference after testing.
- Check the Owner's user-access screen, branch assignment, company profile, logo preview, responsive navigation, dashboard, approvals and reports.
- Inspect print-to-PDF output in the browser print dialog for a representative invoice, audit package and finance report.
- For offline scenarios, verify a previously visited dashboard/expense shell, encrypted queued draft, reload recovery, reconnect retry and no duplicate write. The deterministic service-worker adapter is not a substitute for real device/network-disconnect UAT.

## Commands

Run from the repository root on Windows. Use `npm.cmd` to avoid PowerShell's `npm.ps1` execution-policy error.

```powershell
npm.cmd run build --workspace @brick-erp/api
npx.cmd tsc --noEmit -p frontend/tsconfig.json
node --import tsx backend/scripts/verify-http-errors.ts
node --import tsx backend/scripts/verify-backup-manifest.ts
node --import tsx backend/scripts/verify-backup-tool-discovery.ts
node --import tsx backend/scripts/verify-openapi-contract.ts
npm.cmd run verify:loading-role --workspace @brick-erp/api
node --import tsx backend/scripts/verify-purchase-fifo-backfill.ts
node --import tsx frontend/scripts/verify-audit-workbook.ts
node frontend/scripts/verify-dashboard-cache.mjs
node frontend/scripts/verify-offline-outbox.mjs
node frontend/scripts/verify-service-worker-shell.mjs
git diff --check
```

Mutating API/database verifiers need `DATABASE_URL` and `ERP_VERIFY_API_URL` pointed to the disposable test environment. They fail closed unless `ERP_VERIFY_EXPECTED_DATABASE` exactly matches the database name in the URL, both database and API hosts are loopback, and `ERP_VERIFY_ALLOW_MUTATION=1` is set. Set the mutation opt-in only in a shell dedicated to a fresh disposable database, and run the API with the same database URL. Read-only schema/report checks do not need the mutation opt-in. Never point a verifier at `backend/.env` or a live company database. See [`backend/README.md`](../backend/README.md) for local API and database setup.

The authentication attempt limit stays at 10 per 15 minutes by default. It is raised to 100 only when the API runs with `NODE_ENV=test`, mutation opt-in enabled, and a loopback PostgreSQL URL whose database exactly matches `ERP_VERIFY_EXPECTED_DATABASE`; this lets the full role integration sign in each synthetic account without loosening normal development/production limits.

- Control-account reconciliation: compare all four balances with independent SQL for company and two branch scopes; approve an intentionally untagged branch journal and confirm the report shows its variance only in that branch and company scope; verify unauthenticated, forbidden-role and invalid-date responses.
