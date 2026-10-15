# ERP documentation index

Start with [`MASTER_PRD.md`](MASTER_PRD.md), the approved product blueprint. Specifications below describe the current implementation or its acceptance gates; they do not grant authority to change business records or approve accounting policy.

## Product and system design

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — service boundaries, controls and rollout gaps.
- [`DATABASE.md`](DATABASE.md) — PostgreSQL schema/migrations.
- [`BUSINESS_RULES.md`](BUSINESS_RULES.md) — implemented controls and decisions that must be configured/approved by the business.
- [`ACCOUNTING_RULES.md`](ACCOUNTING_RULES.md) — implemented source-to-ledger effects and accounting review gates.
- [`API_SPEC.md`](API_SPEC.md) and [`openapi.yaml`](openapi.yaml) — API protocol/route-family overview plus a scoped OpenAPI 3.1 contract for setup, auth, company profile and user access. Operational domain schemas remain in backend code.
- [`UI_SPEC.md`](UI_SPEC.md) and [`MOBILE_SPEC.md`](MOBILE_SPEC.md) — desktop/mobile interaction and responsive requirements.
- [`AI_SPEC.md`](AI_SPEC.md) — Owner-only read-only AI tools and data flow.
- [`SECURITY.md`](SECURITY.md) — application controls and production security checklist.
- [`PROJECT_RULES.md`](PROJECT_RULES.md) — engineering and business-rule constraints.

## Verification and rollout

- [`TEST_PLAN.md`](TEST_PLAN.md) — verification layers, commands, and required invariants.
- [`PRD_TRACEABILITY.md`](PRD_TRACEABILITY.md) — requirement-by-requirement implementation evidence and remaining acceptance gates.
- [`UAT.md`](UAT.md) — passed evidence and open Owner/accountant/device/deployment sign-offs.
- [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) — detailed dated feature and verification log.

## Keep these documents aligned

For each feature change, update the affected specification, tests and implementation status in the same work increment. Do not turn unresolved business or tax questions into code defaults; record the question in `BUSINESS_RULES.md`/`ACCOUNTING_RULES.md` and `UAT.md` until the authorized reviewer decides.
