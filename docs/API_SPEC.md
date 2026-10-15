# API specification overview

The API is an Express/TypeScript JSON service. PostgreSQL is accessed by the server only. [`openapi.yaml`](openapi.yaml) provides a machine-readable OpenAPI 3.1 contract for setup/authentication, company profile, user access, roles and branches. Operational route families are summarized below; their request/response schemas and transaction behavior live beside each route under `backend/src/`.

## Protocol conventions

- Browser clients use same-origin `/api` paths. The Next.js server forwards them to the private API origin configured by `ERP_API_INTERNAL_URL` (development default `http://127.0.0.1:4000`). `NEXT_PUBLIC_API_URL` remains a server-side fallback for existing deployments; it is not embedded in browser requests.
- JSON request bodies are validated on the server. Financial totals, role permission checks, company scope and branch scope are server-authoritative.
- Protected requests use `Authorization: Bearer <session-token>`. The opaque token is returned by login; only its hash is stored.
- Mutating endpoints that support retries require an `Idempotency-Key`; identical replay returns the original result and changed-body reuse is rejected.
- Customer and supplier opening-balance posts (`POST /api/masters/:kind/:id/opening-balance`) require an `Idempotency-Key`; retrying the committed request returns its original 201 response without creating another journal or audit event.
- API responses use HTTP status codes and JSON error envelopes `{ error: { code, message, requestId? } }`. Unexpected errors are logged with request ID, method and path; passwords and database credentials are not returned. `X-Request-ID` is set for correlation.
- CORS allowlist comes from backend `WEB_ORIGIN` for any direct API clients. The normal web/mobile client path is same-origin through the Next.js proxy. JSON request body limit is 2 MB. API hardening headers and authentication rate limits are enabled.

## Route families

| Area | Prefix / representative paths | Access |
| --- | --- | --- |
| Service | `GET /api/health` | Public liveness/database check |
| Setup and auth | `/api/auth/setup-status`, `/api/auth/setup`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/password/change`, `/api/auth/me`, `/api/auth/branches`, `/api/auth/branch` | Setup/login are public until initialized; remaining routes require a session |
| Company and numbering | `/api/company/profile`, `/api/company/profile/logo`, `/api/company/document-sequences` | Owner for writes; company-scoped authenticated reads |
| Users, roles, branches | `/api/admin/users`, `/api/admin/auditors`, `/api/admin/users/:id/active`, `/api/admin/access/roles`, `/api/admin/access/users`, `/api/admin/access/branches` | Action permissions; Owner-only safeguards apply to protected operations |
| Operations | `/api/masters`, `/api/production`, `/api/stock`, `/api/sales`, `/api/loading`, `/api/purchases`, `/api/employees`, `/api/payroll`, `/api/expenses` | Authentication plus module/action permissions and branch scope |
| Finance and reports | `GET /api/accounting/subledger-reconciliation`, `/api/accounting`, `/api/accounting/cash-opening-balance`, `/api/accounting/bank-opening-balance`, `GET /api/reports/customer-aging`, `/api/reports`, `/api/audit/logs`, `/api/inventory/valuation/history` | View/configure/post/approve permissions per action; customer aging requires `sales.view` and respects company/branch scope; cash/bank opening posts are one-time and audited |
| Owner services | `/api/notifications`, `/api/ai` | Session and specific Owner/role permission checks |

## Source of truth

The complete route inventory is defined by `backend/src/server.ts` and the mounted routers. The OpenAPI document is intentionally scoped and does not yet describe the operational, finance, reporting, notification or AI route families. Request validation schemas, permission codes, error codes and idempotency requirements should be updated with each API change. When adding routes to the contract, keep it aligned with the source and validate the YAML before release.

### Control-account reconciliation

- `GET /api/accounting/subledger-reconciliation?asOf=YYYY-MM-DD` requires `accounting.view`.
- Returns the company/active-branch scoped balances for accounts 1100, 2100, 2150 and 1400, each compared with partner-tagged customer, supplier, broker or employee journal lines through the as-of date. Branch views include shared journal lines; `difference` is the control balance less the tagged subledger total. Unallocated lines (up to 500 latest per control) include journal number, date, descriptions and signed amount for review.

### Payment methods

- `GET /api/payment-modes` requires an authenticated session and returns company-scoped supported methods, enabled status, settlement account code and whether that account is currently available.
- `PUT /api/payment-modes/:code` is Owner-only. Accepts `{ "active": boolean, "accountCode": string }`; the account must be active and have asset type, and the code is constrained to the settlement account used by the existing cash/bank books. Each update is transactional and audited.
- Supported method codes are `cash`, `upi`, `bank_transfer`, `cheque`, `card` and `other`. New transactions must use an enabled method. Cash posts to account 1110; non-cash methods post to account 1120.
