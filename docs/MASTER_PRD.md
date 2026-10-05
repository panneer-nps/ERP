<!-- PDF page 1 -->
BRICK CHAMBER ERP
Master Product Requirements
Document (PRD)
Billing • Accounting • Production • Stock • Labour • Broker • Loading • Delivery •
Owner Mobile • Audit • AI
Version: 1.0
Status: Master Development Blueprint
Purpose: Single source of truth for product design, database architecture, API
implementation, UAT, security and AI-assisted development.
Prepared as a reusable core platform. Business-specific rates, tax treatment, approval limits,
units and workflows must remain configurable.
Brick Chamber ERP — Master PRD v1.0 Page 1

<!-- PDF page 2 -->
1. Document Control
Item Specification
Product Brick Chamber ERP
Document Master Product Requirements Document
Version 1.0
Primary users Owner, Manager, Accountant, Sales, Production, Loading, Verifier, Driver,
Auditor
Primary platforms Web ERP + Owner Mobile App; Staff/Driver/Customer apps later
Core database PostgreSQL
Backend Node.js + TypeScript
Frontend Next.js + TypeScript
Recommended Managed PostgreSQL service; AWS RDS is the reference option
production DB hosting
File storage Private object storage such as Amazon S3
Architecture principle API-first, role-based, auditable, configurable, multi-branch ready
Important implementation note: tax rates, GST applicability, e-invoicing/e-way-bill applicability
and statutory payroll rules must be configurable and verified with the business's CA/tax
professional at deployment. This PRD defines software behavior, not legal/tax advice.
2. Executive Summary
The system is a complete operational and accounting platform for a brick manufacturing/chamber business.
It connects production batches and chamber activity to stock, customer orders, broker commission, billing,
loading, loading verification, delivery, collections, labour attendance, salary, employee advances,
expenses, cash/bank, ledgers and financial reports.
The owner receives a dedicated remote mobile experience for live business visibility, approvals, alerts,
loading evidence and management reports. An Auditor role provides read-only access to financial records,
operational evidence and immutable-style audit history.
The architecture must support future branches, chambers, mobile staff, customer/driver portals, WhatsApp,
GPS, advanced payroll, maintenance, bank reconciliation and AI without redesigning the core transaction
model.
Core principle: operational actions create controlled stock and accounting effects. Financial records are
corrected through reversal/adjustment workflows rather than silent deletion.
3. Goals and Non-Goals
3.1 Goals
● Replace manual billing/accounting registers with a controlled digital workflow.
● Track chamber-wise and batch-wise production and cost.
● Track saleable, second-quality, broken, rejected and damaged bricks.
● Control sales, credit, collections, broker commissions, loading and delivery.
● Record loading start/end time and loading photographs with server-side timestamps.
Brick Chamber ERP — Master PRD v1.0 Page 2

<!-- PDF page 3 -->
● Require loading verification and support quantity mismatch escalation.
● Maintain labour attendance, salary, salary advances and employee ledgers.
● Maintain customer, supplier, broker and employee balances.
● Provide double-entry accounting foundations and financial reports.
● Give the owner secure remote visibility and approval capability.
● Provide audit-ready transaction history and evidence.
● Keep future integrations and AI isolated from the accounting core.
3.2 Non-Goals for V1
● Full payroll statutory compliance unless explicitly configured and approved.
● Live vehicle GPS tracking.
● Customer and driver portals.
● Automated WhatsApp AI ordering.
● Predictive AI forecasting.
● Complex multi-country or multi-currency accounting.
● IoT chamber sensors.
4. Product Architecture
Owner Mobile App
|
Staff/Verifier Mobile (future)
|
Web ERP
|
HTTPS / API
|
Node.js + TypeScript Services
|
PostgreSQL <----> Redis / Queue
|
Private Object Storage (photos/PDFs)
|
Backups / Monitoring / Audit
The production database must not be directly exposed to the public internet. All clients use authenticated
APIs. Business logic, permissions, validation and accounting rules live in the backend/domain layer.
4.1 Architectural layers
Layer Responsibility
Presentation Web ERP, owner mobile, future staff/customer/driver apps
API Authentication, authorization, validation, request handling
Domain services Sales, production, stock, accounting, payroll/labour, loading, delivery
Data PostgreSQL transactional database
Files Private object storage for photos, invoices and documents
Async Redis/queue for notifications, reports, integrations and background jobs
Security RBAC, audit, secrets, encryption, device/session controls
Brick Chamber ERP — Master PRD v1.0 Page 3

<!-- PDF page 4 -->
Layer Responsibility
Observability Application logs, metrics, alerts, database monitoring
AI layer Controlled tools/read models over approved ERP data; no unrestricted DB access
5. Complete Module Map
1 Administration: company, branches, financial years, users, roles, permissions, settings, number
sequences.
2 Masters: customers, suppliers, brokers, employees/labour, vehicles, drivers, products, units, HSN/tax
configuration, expense categories, chambers.
3 Production: chambers, batches, loading/unloading, firing/cooling milestones, production quantities,
quality classification, production costs.
4 Inventory: opening stock, production inward, sales outward, returns, damage, adjustments, stock ledger
and locations.
5 Sales: customer orders, rates, discounts, broker assignment, credit controls, invoices, payments and
returns.
6 Loading & dispatch: loading request, loading session, timer, photos, quantity, verifier, mismatch
handling, dispatch approval and delivery.
7 Broker: broker master, commission rules, commission accrual, payable and payment.
8 Labour: employee master, attendance, overtime, salary, advances, deductions, employee ledger.
9 Purchase: purchase orders, material receipt, purchase invoice, supplier payable and payment.
10Expenses: operational expenses with optional branch/chamber/batch/vehicle/employee linkage.
11Accounting: chart of accounts, journals, ledgers, cash, bank, receivables, payables, trial balance, P&L;
and balance sheet.
12Reports: operational, financial, audit, stock, production, loading and management reports.
13Owner mobile: dashboard, approvals, notifications, loading evidence, outstanding, reports and AI
assistant.
14Audit center: read-only auditor role, audit trail, changes, cancellations, approvals and exports.
15Integrations: WhatsApp, PDF, tax/e-invoice/e-way-bill services where applicable, bank reconciliation,
future GPS.
6. Roles and Permission Model
Role Primary access
Owner Full business visibility, approvals, configuration, reports
Manager Operations, approvals within limits, reports
Accountant Billing, payments, expenses, ledgers, accounting and reports
Sales Staff Customers, orders, sales, limited payment visibility
Production Staff Chambers, batches, production entries
Loading Staff Assigned loading jobs, timer, quantity, photos
Loading Verifier Loading verification, quantity confirmation, evidence
Brick Chamber ERP — Master PRD v1.0 Page 4

<!-- PDF page 5 -->
Role Primary access
Driver Assigned deliveries and delivery proof (future app)
Store Staff Stock, inward/outward, adjustments within permission
Auditor Read-only audit and reporting access
System Admin Technical administration; no automatic accounting authority
Permissions must be action-level, not only menu-level: view, create, edit, approve, cancel,
reverse, pay, export, configure. Sensitive actions may require PIN/biometric/2FA confirmation.
7. End-to-End Business Workflows
7.1 Production to stock
Chamber
-> Batch created
-> Chamber loading
-> Firing
-> Cooling
-> Unloading
-> Good / Second / Broken / Rejected classification
-> Production completed
-> Saleable stock posted
-> Batch cost calculated
7.2 Sales to collection
Customer
-> Order
-> Credit validation
-> Broker assignment (optional)
-> Invoice
-> Loading request
-> Loading
-> Photo evidence
-> Verification
-> Dispatch
-> Delivery
-> Receipt
-> Customer ledger
-> Accounting entries
7.3 Purchase to payment
Supplier
-> Purchase order (optional)
-> Material received
-> Purchase invoice
-> Stock/expense posting
-> Supplier payable
-> Payment
-> Supplier ledger
7.4 Labour lifecycle
Employee
-> Attendance
-> Overtime / piece-rate (if configured)
-> Salary calculation
-> Advance deduction
-> Approval
-> Salary payment
-> Employee ledger
Brick Chamber ERP — Master PRD v1.0 Page 5

<!-- PDF page 6 -->
8. Functional Requirements
8.1 Company / Branch / Financial Year
● Company name, legal name, address, state, pincode, contact, GSTIN, PAN, logo and financial-year
settings.
● Multiple branches/locations with separate operational visibility and optional consolidated reporting.
● Configurable invoice, receipt, payment, loading and batch number sequences.
● Financial year support, opening balances and controlled year-end closing.
8.2 Customer
● Name, business name, mobile, WhatsApp, address, GSTIN/PAN, customer type, credit limit, credit days,
payment terms, opening balance and status.
● Customer ledger with invoice allocation, receipts, advances, overdue aging and balance.
● Optional customer-specific rate list.
8.3 Supplier
● Supplier identity, contact, address, GST details, supplied materials, credit terms and opening balance.
● Supplier ledger, bills, payments, advances and outstanding.
8.4 Product
● Product code/name/category, unit, HSN, tax configuration, standard rates, minimum stock and active
status.
● Support NOS, 1,000 NOS, load/trip and custom units through configurable conversion rules.
● Store quantities in a reliable base unit; display conversions without losing base quantity.
8.5 Chamber and Batch
● Chamber capacity, sections, location and status.
● Batch lifecycle: planned, loading, firing, cooling, unloading, completed, cancelled.
● Record loaded, produced, good, second-quality, broken, rejected and loss quantities.
● Calculate yield, breakage and saleable quantity.
8.6 Production Cost
● Material, fuel, labour, electricity, water, loading/unloading, maintenance and other cost lines.
● Support direct batch costs and configurable overhead allocation.
● Calculate cost per saleable brick and batch profitability.
8.7 Stock
● Every stock change must originate from a transaction or controlled adjustment.
● Support location, branch, chamber and batch dimensions.
● Stock ledger must show before quantity, movement, after quantity, reference and user.
● Stock adjustment requires reason and permission.
9. Sales, Broker, Loading and Delivery Requirements
9.1 Broker Commission
Brick Chamber ERP — Master PRD v1.0 Page 6

<!-- PDF page 7 -->
● Broker master with commission type: per brick, per 1,000, per load, percentage or fixed.
● Broker can be linked to customer/order/invoice.
● Commission is accrued based on configured event: invoice, delivery, payment or owner approval.
● Commission payable and broker payment are separately tracked.
● Broker ledger and pending/paid commission reports.
9.2 Loading
● Loading ID linked to order/invoice/customer/vehicle/driver.
● Schedule date/time, start time, end time, loading staff, product, required quantity and actual quantity.
● Server-side timestamps for critical events.
● Automatic loading duration calculation.
● Loading cannot be marked complete without required verification when the policy is enabled.
9.3 Loading Snapshots
● Capture before, during and after-loading photos from the authorized mobile device.
● Photo metadata: loading ID, type, user, server timestamp, storage key and optional GPS/device
metadata.
● Store images in private object storage; database stores metadata.
● Owner can remotely view photos from the loading record.
● Photos are evidence records and should not be silently replaced; new photos create new records.
9.4 Loading Verification
● Verifier confirms loaded and verified quantities.
● System calculates ordered vs loaded vs verified difference.
● Configurable mismatch threshold.
● Mismatch can trigger warning, manager approval or owner approval.
● Verifier cannot modify commercial invoice values unless separately authorized.
9.5 Delivery
● Vehicle, driver, destination, dispatch and delivery timestamps.
● Delivery proof can later include photo, signature or OTP.
● Delivery status: pending, loading, loaded, verified, dispatched, in transit, delivered, cancelled.
10. Labour, Salary and Advance Requirements
● Employee/labour master with department, role, salary type, monthly salary, daily rate or piece-rate
configuration.
● Attendance: present, absent, half-day, overtime hours and remarks.
● Salary calculation supports earnings, overtime, bonus, deductions and advance recovery.
● Advance is a separate employee receivable/advance transaction, not immediately treated as salary
expense.
● Advance approval limits and owner/manager approval workflow.
● Employee ledger shows opening balance, advances, salary deductions, recoveries and remaining
balance.
Brick Chamber ERP — Master PRD v1.0 Page 7

<!-- PDF page 8 -->
● Support part-payment and salary payable.
Example accounting model
Employee Advance DR
Cash/Bank CR
Salary Expense DR
Salary Payable CR
Salary Payable DR
Cash/Bank CR
11. Accounting Architecture
The application should use a double-entry accounting foundation so that operational modules feed reliable
financial statements.
11.1 Core accounting objects
● Chart of accounts
● Account groups
● Journal entries
● Journal entry lines
● Customer receivable accounts
● Supplier payable accounts
● Employee advance/payable accounts
● Broker payable accounts
● Cash accounts
● Bank accounts
● Tax accounts
● Sales and expense accounts
11.2 Transaction rules
Transaction Debit Credit
Sales invoice Customer receivable Sales + applicable tax
Customer receipt Cash/Bank Customer receivable
Purchase/expense Inventory or Expense + applicable input Supplier/Cash/Bank
tax
Supplier payment Supplier payable Cash/Bank
Employee advance Employee advance Cash/Bank
Salary accrual Salary expense Salary payable
Salary payment Salary payable Cash/Bank
Broker commission accrual Commission expense/cost Broker payable
Broker payment Broker payable Cash/Bank
Exact tax account treatment should be finalized during accounting implementation with the
business's CA.
Brick Chamber ERP — Master PRD v1.0 Page 8

<!-- PDF page 9 -->
12. Payments, Cash, Bank and Closing Controls
● Support cash, UPI, bank transfer, cheque, card and configurable payment modes.
● Payments can be allocated to one or multiple invoices or left as on-account/advance.
● Cash book and bank book must derive from posted transactions.
● Daily closing reconciles expected cash with actual cash and records differences.
● Month-end closing locks ordinary edits and requires controlled correction entries.
● Financial-year closing carries forward approved opening balances.
Daily closing example
Opening Cash
+ Cash Receipts
- Cash Payments
= Expected Closing
Actual Cash
- Expected Closing
= Difference
Difference requires reason + approval when non-zero.
13. Reports and Management Information
Area Reports
Dashboard Sales, collections, expenses, stock, production, outstanding, active chambers, pending approvals
Production Daily, monthly, chamber-wise, batch-wise, quality, yield, breakage, production cost
Stock Current stock, movement, adjustments, damaged, batch-wise, location-wise
Sales Invoice register, customer-wise, product-wise, broker-wise, payment status, returns
Loading Loading register, duration, staff, verifier, mismatch, snapshots, dispatch
Broker Commission accrued, paid, pending, invoice-wise, broker-wise
Labour Attendance, salary, advances, employee ledger, department cost
Purchases Purchase register, supplier-wise, material-wise, payable
Expenses Category-wise, chamber/batch/vehicle-wise, date-wise
Finance Cash book, bank book, journals, ledgers, receivables, payables, trial balance, P&L;, balance sheet
Audit Changes, cancellations, reversals, approvals, manual adjustments, user activity
14. Owner Remote Mobile App
The owner app is a management/control surface over the same backend, not a separate accounting
system.
14.1 Navigation
Home | Operations | Approvals | Reports | More
14.2 Owner features
● Business dashboard with configurable date range.
● Production and chamber status.
● Sales and collection.
Brick Chamber ERP — Master PRD v1.0 Page 9

<!-- PDF page 10 -->
● Customer and supplier outstanding.
● Loading status and loading photographs.
● Quantity mismatch alerts.
● Broker commission.
● Labour attendance, salary payable and advances.
● Expenses and approvals.
● Cash and bank summary.
● Reports.
● Notifications.
● AI assistant.
14.3 Approval Center
● Credit sale approval
● Large expense approval
● Labour advance approval
● Broker commission approval
● Loading mismatch approval
● Stock adjustment approval
● Manual journal approval
14.4 Remote security
● Secure authentication and optional 2FA.
● Device/session management.
● Biometric/PIN confirmation for sensitive actions where supported.
● No direct database credentials in the mobile application.
15. Auditor and Audit-Ready Design
A dedicated Auditor role provides read-only access to approved data and evidence.
15.1 Auditor Center
● Sales, purchases, expenses, cash, bank, stock, production, loading, broker, labour and accounting
summaries.
● Cancelled transactions, reversals and manual adjustments.
● Approval history and user activity.
● Search by invoice, payment, customer, employee, broker, batch or loading ID.
● Date/branch/financial-year filters.
● Export to PDF/Excel/CSV.
15.2 Change history
Record created
-> value changed
-> who changed it
-> when
-> reason (when required)
Brick Chamber ERP — Master PRD v1.0 Page 10

<!-- PDF page 11 -->
-> approval
-> resulting accounting/stock effect
15.3 Audit Package
● Sales register
● Purchase register
● Expense register
● Cash/bank
● Customer/supplier/employee/broker ledgers
● Stock and production
● Loading evidence
● Trial balance
● P&L;
● Balance sheet
● Audit log
● Cancellations
● Adjustments
● Approvals
16. Database Design — Core Entities
Domain Core tables/entities
Identity users, roles, permissions, user_roles, sessions, devices
Company companies, branches, financial_years, settings, number_sequences
Masters customers, suppliers, brokers, employees, vehicles, drivers, products, categories, units, hsn_codes,
tax_rates
Production chambers, production_batches, production_entries, production_costs
Inventory stock_locations, stock_transactions, stock_adjustments, stock_balances
Sales sales_orders, sales_order_items, invoices, invoice_items, invoice_payments, sales_returns,
credit_notes
Loading loading_requests, loading_sessions, loading_events, loading_photos, loading_verifications
Delivery deliveries, delivery_items, delivery_proofs
Purchase purchase_orders, purchase_order_items, purchase_invoices, purchase_items, purchase_payments
Labour attendance, salary_runs, salary_items, employee_advances, employee_payments
Expenses expense_categories, expenses, expense_attachments
Accounting accounts, account_groups, journal_entries, journal_lines, customer_ledger, supplier_ledger,
employee_ledger, broker_ledger
Cash/Bank cash_accounts, bank_accounts, bank_transactions, reconciliations
Security/Audit audit_logs, approval_requests, approval_actions, notifications, login_events
Files files, file_links
Every transactional table should include appropriate company_id/branch_id and
created_by/created_at fields. Financial records must be versioned or audit-tracked where edits
Brick Chamber ERP — Master PRD v1.0 Page 11

<!-- PDF page 12 -->
are permitted.
17. API Specification — Initial Resource Map
/api/auth
/api/users
/api/roles
/api/companies
/api/branches
/api/financial-years
/api/customers
/api/suppliers
/api/brokers
/api/employees
/api/vehicles
/api/products
/api/chambers
/api/production
/api/stock
/api/sales-orders
/api/invoices
/api/payments
/api/loading
/api/loading/photos
/api/loading/verifications
/api/deliveries
/api/purchases
/api/expenses
/api/attendance
/api/salary
/api/employee-advances
/api/accounting
/api/ledgers
/api/cash
/api/bank
/api/reports
/api/approvals
/api/notifications
/api/audit
/api/files
/api/ai
API rules
● Validate all input server-side.
● Use authorization on every protected endpoint.
● Use idempotency keys for financial/mobile transaction creation.
● Use database transactions for multi-table financial/stock operations.
● Never trust client-side totals for accounting; recalculate on the server.
● Return stable error codes and human-readable messages.
● Version APIs when breaking changes are unavoidable.
18. Server, Database and Security Architecture
18.1 Recommended production stack
Component Recommendation
Frontend Next.js + TypeScript
Brick Chamber ERP — Master PRD v1.0 Page 12

<!-- PDF page 13 -->
Component Recommendation
Backend Node.js + TypeScript
Database PostgreSQL
Managed DB Amazon RDS for PostgreSQL as reference implementation
Object storage Private Amazon S3 bucket
Queue/cache Redis
Secrets Managed secrets store such as AWS Secrets Manager
Encryption keys Managed KMS
Monitoring CloudWatch + application monitoring
Network Private VPC for database; controlled API ingress
CI/CD GitHub-based CI/CD with protected production deployment
18.2 Security requirements
● TLS for client/API and API/database connections where supported/configured.
● Encryption at rest for database, backups and object storage.
● Private database networking; no public DB endpoint for normal operation.
● Secrets never committed to source control.
● Least-privilege IAM and application roles.
● RBAC plus action-level permissions.
● Optional row-level isolation for company/branch data.
● Session/device management and revocation.
● Rate limiting and abuse protection.
● Security logging and alerting.
● Regular dependency and vulnerability updates.
● Production data never copied into developer environments without controlled masking/approval.
19. Backup, Disaster Recovery and Data Retention
● Automated encrypted database backups.
● Point-in-time recovery capability where supported by the managed database configuration.
● Separate backup/storage protection from the primary application environment.
● Retention policy configurable by business requirements.
● Periodic restoration tests must be performed and documented.
● Photos/PDFs must have durable storage and backup/lifecycle policy.
● Disaster recovery procedure must identify RPO and RTO targets.
Term Definition / target to finalize
RPO Maximum acceptable data loss window; finalize during deployment planning.
RTO Maximum acceptable recovery time; finalize according to business criticality.
Backup test Documented restore test at defined interval.
Brick Chamber ERP — Master PRD v1.0 Page 13

<!-- PDF page 14 -->
Term Definition / target to finalize
Retention Daily/weekly/monthly retention to be agreed with owner/CA.
20. Mobile Offline and Synchronization
● Read-only cached summaries may remain available when offline.
● Permitted offline transactions are queued locally and synchronized when connectivity returns.
● Every transaction uses a unique idempotency key to prevent duplicates.
● Financial posting conflicts must require server-side resolution; no silent overwrite.
● Photo uploads can use retry/resume logic.
● Server timestamps remain authoritative for audit events.
21. Notifications and Alerts
Event Owner alert
New credit sale Configurable
Payment received Configurable
Large expense Configurable
Loading started/completed Configurable
Loading mismatch Recommended
Verification completed Configurable
Delivery completed Configurable
Labour advance request Recommended
Broker commission pending Configurable
Customer overdue Recommended
Low stock Configurable
Chamber/batch completed Configurable
Security/new device login Recommended
22. Future-Ready Modules
● Driver mobile app with delivery assignment, GPS, delivery proof and OTP.
● Customer portal for orders, invoices, balances, payment and delivery tracking.
● Supplier portal.
● Vehicle maintenance, fuel and service reminders.
● Document management and expiry reminders.
● Advanced payroll: statutory deductions, incentives, bonus and salary slips where applicable.
● Bank statement import and reconciliation.
● WhatsApp invoice/payment/dispatch notifications and future order capture.
● GPS fleet tracking.
Brick Chamber ERP — Master PRD v1.0 Page 14

<!-- PDF page 15 -->
● IoT chamber temperature/sensor integration.
● Advanced business intelligence and forecasting.
● Multi-branch and consolidated reporting.
● Partner/capital/profit-share accounting if required.
23. AI Assistant Architecture
AI must not become the source of truth for financial balances. It should query controlled application
tools/read models and present results with clear source context.
23.1 Safe AI flow
User
-> AI assistant
-> intent detection
-> permission check
-> approved ERP tool/query
-> database/read model
-> result
-> AI explanation
-> audit event
23.2 Example questions
● How is business today?
● Show customers with outstanding above ₹1 lakh.
● How much broker commission is pending?
● What is total labour advance outstanding?
● Show today's loading mismatches.
● What was Chamber 2's production cost?
● Summarize today's operations.
● Create a payment reminder draft.
AI should not directly execute unrestricted SQL or write journal entries. Write actions must use
explicit, permission-checked application functions and, for sensitive actions, approval workflows.
24. UAT / Test Plan
24.1 Critical end-to-end tests
1 Create customer → create order → assign broker → invoice → loading → photo → verification → dispatch →
payment → customer ledger.
2 Create production batch → record production → classify good/broken/rejected → post stock → verify stock
ledger.
3 Create purchase → receive material → supplier bill → payment → supplier ledger.
4 Create employee → attendance → salary → advance → deduction → salary payment → employee ledger.
5 Create expense → approve → pay → cash/bank and accounting posting.
6 Create loading mismatch → verify → trigger approval → approve → dispatch.
7 Cancel invoice → verify reversal/stock/accounting/audit effects.
8 Edit permitted field → verify change history.
9 Attempt unauthorized action → verify denial and security log.
Brick Chamber ERP — Master PRD v1.0 Page 15

<!-- PDF page 16 -->
10Disconnect mobile network → create permitted offline transaction → reconnect → verify one successful
server transaction only.
11Generate auditor reports → compare report totals to ledger/trial balance.
12Backup/restore test → verify application integrity and data consistency.
24.2 Reconciliation tests
● Invoice total equals accounting posting.
● Stock movement equals stock balance.
● Customer ledger equals receivable balance.
● Supplier ledger equals payable balance.
● Employee advance ledger equals employee advance balance.
● Broker ledger equals commission payable.
● Cash book equals posted cash transactions.
● Trial balance debits equal credits.
25. Development Roadmap
Phase Scope Exit condition
0 Requirements confirmation and configuration workshop Approved business rules and screen map
1 Project foundation, auth, roles, company/branch/settings Secure login and base environment
2 Masters All core master data CRUD + permissions
3 Chambers, production, batches, stock Production-to-stock flow reconciles
4 Sales, broker, invoice, payments Sales-to-ledger flow reconciles
5 Loading, photos, verification, delivery Evidence and mismatch workflow passes
UAT
6 Labour, attendance, salary, advances Employee ledger and payroll tests pass
7 Purchase, expenses, cash/bank, accounting Trial balance and financial reports reconcile
8 Owner mobile, notifications, approvals Remote owner workflows pass
9 Auditor center, exports, security hardening Audit package and access tests pass
10 AI + integrations AI uses controlled tools; integrations pass
sandbox/UAT
11 Production launch Backup restore, monitoring, security and
UAT sign-off
26. Codex + Claude Development Operating Model
The repository must contain the PRD and supporting specifications as the source of truth. AI agents should
work in small, reviewable increments.
26.1 Required documentation files
/docs/
MASTER_PRD.md
ARCHITECTURE.md
DATABASE.md
ACCOUNTING_RULES.md
BUSINESS_RULES.md
API_SPEC.md
Brick Chamber ERP — Master PRD v1.0 Page 16

<!-- PDF page 17 -->
UI_SPEC.md
MOBILE_SPEC.md
AI_SPEC.md
SECURITY.md
TEST_PLAN.md
UAT.md
PROJECT_RULES.md
26.2 AI task pattern
Read MASTER_PRD.md and relevant module docs.
Implement only the requested feature.
Do not change unrelated modules.
Use existing architecture and conventions.
Add/update tests.
Run lint/typecheck/tests.
Report files changed, migrations, API changes and known issues.
Do not invent business rules; mark missing decisions for review.
26.3 Suggested responsibilities
● Claude: architecture review, requirements analysis, edge cases, code review, documentation and test
design.
● Codex: repository implementation, migrations, API/UI coding, test execution, debugging and refactoring.
● Human owner/accountant: final business-rule, accounting and operational decisions.
● CA/tax professional: statutory/tax validation before production.
27. Engineering Standards
● TypeScript strict mode.
● Database migrations tracked in source control.
● No manual production database schema edits except controlled emergency procedures.
● Unit tests for calculations.
● Integration tests for transaction posting.
● End-to-end tests for critical workflows.
● API validation with a schema library.
● Database transactions around financial/stock operations.
● Idempotency for mobile and payment operations.
● Structured application logs without sensitive secrets.
● Error monitoring and alerting.
● Code review before production merge.
● Protected production branch.
● Secrets excluded from Git.
28. Configuration-Driven Rules
The following must not be hard-coded because they may differ between businesses or change over time:
● Brick units and conversion factors.
● Product rates.
● Customer-specific rates.
Brick Chamber ERP — Master PRD v1.0 Page 17

<!-- PDF page 18 -->
● Broker commission method and rate.
● Loading mismatch tolerance.
● Approval thresholds.
● Credit limits and credit days.
● Payment methods.
● Tax rates and applicability.
● Invoice numbering format.
● Salary method and pay period.
● Overtime rules.
● Branch/chamber assignment.
● Notification rules.
● Financial year.
● Report templates.
29. Critical Business Rules
1 A posted financial transaction cannot be silently deleted.
2 Stock cannot be changed without a stock transaction or authorized adjustment.
3 Invoice totals are calculated server-side.
4 Customer/supplier/employee/broker balances derive from transactions, not manually editable balance
fields.
5 Loading photos are linked to a loading record and have server timestamps.
6 Loading verification records cannot be overwritten without an audit trail.
7 Employee advances are tracked separately from salary expense until settlement.
8 Broker commission is separately accrued and paid.
9 Accounting and stock posting must be atomic for transactions that affect both.
10Auditor access is read-only.
11Owner approvals are permission-controlled and audited.
12AI cannot bypass application permissions or directly manipulate accounting tables.
30. Future Scalability Plan
● Multi-company and multi-branch data model from the beginning.
● Tenant/branch identifiers on transactional records.
● API-first architecture for mobile and portals.
● Private object storage for scalable photos/PDFs.
● Queue-based notifications and integrations.
● Read models/materialized reporting views for heavy analytics.
● Database indexing strategy for customer, invoice, payment, stock, batch and loading searches.
● Archival policy for old operational data while retaining audit requirements.
● Feature flags for future modules.
● Versioned APIs and migrations.
Brick Chamber ERP — Master PRD v1.0 Page 18

<!-- PDF page 19 -->
31. Production Launch Checklist
● Business rules signed off by owner/authorized manager.
● Accounting structure reviewed by accountant/CA.
● GST/e-invoice/e-way-bill configuration verified where applicable.
● Role and permission matrix approved.
● Backup and restore tested.
● Security review completed.
● Production database private and encrypted.
● Secrets configured outside source code.
● Audit logs enabled.
● Owner mobile tested on real devices.
● Loading photo upload tested under weak network conditions.
● UAT completed and signed off.
● Invoice numbering verified.
● Opening balances reconciled.
● Stock opening balances reconciled.
● Cash/bank opening balances reconciled.
● Customer/supplier/employee/broker opening balances reconciled.
● Monitoring and alerting enabled.
● Support and rollback procedure documented.
32. Screen Map
Area Screens
Dashboard Owner dashboard, management dashboard
Masters Customers, suppliers, brokers, employees, vehicles, products, chambers, units, tax/HSN
Production Chamber list, batch list, batch detail, production entry, cost entry
Stock Stock dashboard, stock ledger, adjustment, transfer, damaged stock
Sales Orders, order detail, invoice list, invoice detail, returns
Loading Loading queue, loading detail, timer, photo capture, verification, mismatch approval
Delivery Dispatch queue, delivery detail, proof
Labour Employee list, attendance, salary run, advance, employee ledger
Purchase Purchase order, receipt, purchase invoice, supplier payment
Expenses Expense list, create expense, approval
Accounts Chart of accounts, journal, customer ledger, supplier ledger, cash, bank, trial balance, P&L;, balance
sheet
Reports Sales, production, stock, loading, labour, broker, finance, audit
Owner Mobile Home, operations, approvals, notifications, reports, AI
Audit Audit center, audit log, changes, cancellations, exports, audit package
Settings Company, branch, users, roles, numbering, approvals, notifications, integrations
Brick Chamber ERP — Master PRD v1.0 Page 19

<!-- PDF page 20 -->
33. Definition of Done
● Feature matches the approved PRD and UI specification.
● Authorization tests pass.
● Validation tests pass.
● Database migration is reversible/controlled as appropriate.
● Accounting and stock effects are tested.
● Audit events are generated for sensitive actions.
● Mobile behavior is tested where applicable.
● No secrets or production credentials are committed.
● Unit/integration/e2e tests pass for affected areas.
● Documentation is updated.
● UAT scenario passes with expected business result.
34. Final Architecture Decision
Recommended baseline: Next.js + TypeScript web ERP, Node.js + TypeScript backend, PostgreSQL as the
system of record, managed PostgreSQL hosting (AWS RDS reference), private object storage for
photos/PDFs, Redis/queue for asynchronous work, secure RBAC, audit logging, automated encrypted
backups, point-in-time recovery capability, dedicated Auditor role, Owner mobile app and controlled AI
assistant.
This PRD is intentionally designed as a reusable core. The next project stage should customize business
rules after interviewing the actual brick chamber owner/accountant: exact products, unit conversions,
rates, chamber capacity, labour practices, broker commission rules, loading process, payment terms, tax
configuration and approval limits.
This document should be copied into the project repository as the baseline MASTER_PRD.md.
Changes after approval should be versioned and reviewed rather than silently changing the
specification.
Brick Chamber ERP — Master PRD v1.0 Page 20

