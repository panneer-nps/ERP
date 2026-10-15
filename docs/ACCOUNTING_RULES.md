# Accounting rules

These are the accounting effects implemented in the ERP, not a substitute for the company's chart-of-accounts approval or CA/tax advice. See [`DATABASE.md`](DATABASE.md) for the ledger schema and [`UAT.md`](UAT.md) for reconciliation gates.

## Posting controls

- Financial postings are double-entry journal entries. API workflows calculate amounts server-side and commit the source transaction, journal lines, stock/FIFO effects where applicable, idempotency result and audit event atomically.
- Posted entries are not silently edited or deleted. Corrections use authorized, reasoned reversals, returns or adjustments with audit history.
- Account codes and tax profiles are company-configurable. The system seeds operational accounts but production tax/accounting treatment must be reviewed and approved by the Owner's accountant/CA.
- Reports use transaction effective dates and selected financial periods; branch/shared-record scope is enforced by the API.

## Current source-to-ledger behavior

- Sales invoice posting records customer receivable, sales revenue and applicable output tax, relieves stock once, consumes FIFO cost and records COGS. Linked loading/dispatch/delivery does not deduct the same stock again.
- An invoice-linked return issues a sales credit, reverses applicable output tax/receivable, restores returned stock/cost and reverses the related inventory/COGS amount. A non-invoice stock return restores inventory against COGS and does not issue customer credit.
- Supplier receipts/bills/payments/returns and expense workflows update the related stock, payable, cash/bank and expense/input-tax journals according to the posted document and approval state.
- Production costs accumulate in work in process; completion capitalizes approved direct cost and snapshotted overhead into saleable stock. FIFO issues later transfer that recorded cost to COGS.
- Employee advances remain an asset until repayment or approved payroll recovery. Broker commission accrues separately from sales revenue and is settled with a capped payment journal.
- Customer, supplier and other partner opening balances are recorded once with an effective date/reason and an offset to opening balance equity.
- Cash/bank reconciliations compare posted ledger balances with closing/statement evidence; financial-period and year-end closes require their configured reconciliation checks and are audited.

## Historical data and cutoff limits

Current FIFO history is based on recorded stock movements and cost layers. The historical valuation/COGS reports disclose unmatched, unvalued or inconsistent source records; they do not invent historical costs. Populated-company legacy cost-layer reconstruction, opening-balance reconciliation and CA review remain open. The business Owner confirmed the stock/COGS cutoff at invoice posting on 2026-10-14; this decision does not replace reconciliation of the populated company's opening and historical balances.

Migration 100 conservatively backfills only legacy purchase receipts when every receipt line maps one-to-one to a good-quality inbound movement, the saved receipt subtotals exactly match one balanced purchase-receipt journal's inventory debit, the recorded four-decimal unit cost preserves each line subtotal, and there is no outbound movement for that product/location/quality at or after the receipt time. It adds the FIFO layer and updates the existing movement valuation metadata; it does not post or restate a journal. Receipts with ambiguous matches, missing journal evidence, rounding differences, or any later issue remain unvalued. This limited backfill does not establish that all historical inventory or COGS is complete; reconcile the resulting quantities and inventory-control balance with the Owner's accountant/CA.

Migration 111 repairs posted legacy expenses that have no expense journal. It debits the expense category's configured account and credits cash on hand for cash expenses or bank/UPI for other payment methods. The migration proceeds only when the expense date is covered by exactly one open financial year, its accounts are active, and no accounting-period close, approved cash close, or reconciled bank period would be rewritten. Ambiguous or closed-period records stop the migration for Owner/accountant review. Pending, rejected, and already journaled expenses are left unchanged; each recovered journal is recorded in the audit history.
