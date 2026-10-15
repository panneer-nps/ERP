# Business rules

This document records current application behavior, not approval of the company's values. The Owner and accountant must set and approve the business-specific configuration before operational use. `MASTER_PRD.md` remains the requirement source; [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) records implementation evidence and gaps.

## Identity and access

- First-time setup creates one company and its initial Owner. Public signup closes once a company exists.
- The Owner creates Manager, Cashier, Auditor or custom staff accounts, assigns allowed branches, and shares each initial password securely.
- The Owner role is protected. Auditor is read-only. Manager/Cashier actions are limited by action permissions and branch scope; UI visibility is not a substitute for API authorization.
- Deactivating a staff account revokes its active sessions. Role/branch changes are audited and may revoke sessions to apply the new access scope.

## Configurable operating rules

Keep these in company/branch/product/partner configuration rather than hard-coding them: units and conversion factors; product/customer rates; tax/HSN profiles; customer credit limits; broker commission method, rate and accrual event; loading mismatch tolerance; approval thresholds; payment methods; salary and overtime rules; document numbering; branch/chamber assignment; notification preferences; and financial years.

The server converts entered units to base units, calculates invoice totals, enforces credit/approval limits transactionally, and snapshots rates, units and other terms needed to preserve posted history. Editing a master later must not silently rewrite posted documents.

## Operational invariants

- Stock changes require a posted transaction, approved stocktake variance, opening balance or reasoned adjustment; a reduction cannot exceed available stock at its location.
- Production output is bounded by loaded quantity; completed saleable output is posted to stock with its configured cost.
- A sales invoice is posted once, with server-calculated totals, stock/FIFO effects and journals. Loading/delivery must not post a duplicate stock-out.
- Returns, reversals and corrections use controlled, audited workflows; posted transactions are not silently deleted.
- Attendance, advances, payroll, broker commission, cash/bank and partner balances are transaction-derived, not editable balance fields.
- Financial and stock mutations are atomic with their audit event and use idempotency keys on supported write APIs.

## Decisions requiring the business Owner/accountant

- Actual products, quality grades, unit conversions, chamber capacities, labour practices, production overhead method and rates.
- Tax/GST applicability, invoice wording, statutory payroll and legal retention requirements (CA/tax review required).
- Approval limits, customer credit terms, payment modes, commission rates/events, notification rules and numbering prefixes.
- Sale stock and COGS are recognized at invoice posting, as confirmed by the business Owner on 2026-10-14. Loading, dispatch and delivery do not post stock relief again.
- Historical inventory costing, opening balances, unvalued/negative stock correction and treatment of legacy transactions.

Do not enable or populate a business-specific value by inference from synthetic tests.

## Loading role separation

Loading completion (loading.edit) records the operator's loaded quantity. Independent verification uses loading.verify; the built-in Loading Verifier can view loading records and verify a quantity, but cannot complete loading, approve a mismatch, or dispatch. Existing roles that already had loading.edit retain verification access through migration 102. Approval and dispatch remain separately permissioned.
