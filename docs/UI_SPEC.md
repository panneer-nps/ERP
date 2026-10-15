# Desktop UI specification

The web app is the primary desktop client. It uses Next.js/React with shared English/Tamil locale state, icon components and responsive navigation. Product behavior is described in [`MASTER_PRD.md`](MASTER_PRD.md); current implementation evidence is in [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md).

## Interaction principles

- Use clear page titles, short task descriptions, visible field labels and inline validation/errors. Display localized success/error feedback after API actions.
- Use consistent icon names from `frontend/app/visuals.tsx` and meaningful text labels; icons do not replace accessible names.
- Use tables for dense registers with readable empty/loading/error states; preserve identifiers and totals and provide exports/print where implemented.
- Separate draft, pending approval, posted, rejected and reversed states. Display audit actor/time/reason for sensitive or posted changes.
- The authenticated company name/logo appear in navigation. Company profile edits are owner-controlled and audited.
- English and Tamil are explicit user-selectable locales; the selection persists in the browser. Form labels, navigation, key help/errors and operational workflows should use the selected locale.

## Desktop shell

- Persistent sidebar groups navigation, administration and account settings according to permissions.
- Page content uses a readable max-width, cards for summaries/forms and horizontally scrollable data tables where a dense register needs more width.
- Forms group fields by business task and keep destructive/reversal actions distinct with reason prompts and confirmation text appropriate to the action.
- Financial reports and audit packages retain a print-friendly layout; browser print output still requires broad visual UAT.

## Quality checks

Test keyboard/accessibility labels, visible focus, role-specific navigation, empty/error/loading states, browser zoom, long Tamil labels and long identifiers. Check that unauthorized actions remain denied by the API even if a control is reached directly. Desktop print/PDF, keyboard-only accessibility and comprehensive page-by-page visual review remain open UAT items.

## Subledger reconciliation

- The read-only Control account check is available from Financial reports and follows the selected branch plus shared entries.
- Show control-account total, partner-tagged ledger total and their difference for customer receivables, supplier payables, broker payables and employee advances.
- Expand a control to inspect balances by partner; unmatched control postings are shown as an unallocated difference with guidance to review source journals.
- Use the selected English or Tamil locale, a date filter, clear loading/error states, and a responsive one-column phone layout.
