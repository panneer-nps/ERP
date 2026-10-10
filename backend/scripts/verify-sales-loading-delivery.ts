import { randomBytes } from "node:crypto";
import { pool } from "../src/db";

const api = process.env.ERP_VERIFY_API_URL ?? "http://127.0.0.1:44137";
const suffix = randomBytes(5).toString("hex");
const email = `delivery-${suffix}@example.test`;
const password = `Brick-${randomBytes(12).toString("base64url")}-9A`;
let requestCounter = 0;

async function request<T>(path: string, method = "GET", body?: unknown, token?: string, idempotencyKey?: string): Promise<{ status: number; data: T }> {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method === "POST" ? { "Idempotency-Key": idempotencyKey ?? `prd-e2e-${suffix}-${++requestCounter}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (response.status >= 400) throw new Error(`${method} ${path} returned ${response.status}: ${data.error?.message ?? "request failed"}`);
  return { status: response.status, data };
}

async function expectStatus(path: string, token: string, expectedStatus: number) {
  const response = await fetch(`${api}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json().catch(() => ({}));
  if (response.status !== expectedStatus) throw new Error(`GET ${path} expected ${expectedStatus}, received ${response.status}.`);
  return data as Record<string, unknown>;
}

async function main() {
  const setup = await request<{ message: string }>("/api/auth/setup", "POST", {
    companyName: `PRD Delivery Verification ${suffix}`,
    ownerName: "PRD Verification Owner",
    email,
    password,
  });
  if (setup.status !== 201) throw new Error(`Fresh company setup expected 201, received ${setup.status}.`);
  const login = await request<{ token: string }>("/api/auth/login", "POST", { email, password });
  const token = login.data.token;
  if (!token) throw new Error("Owner login did not return a session token.");
  const owner = await pool.query<{ id: string; company_id: string }>(
    "SELECT id,company_id FROM users WHERE lower(email)=lower($1)", [email],
  );
  if (!owner.rowCount) throw new Error("Fresh setup owner was not stored.");
  const ownerId = owner.rows[0].id;
  const { company_id: companyId } = owner.rows[0];

  const originalProfile = await request<{ profile: { name: string; legalName: string; addressLine1: string; addressLine2: string; city: string; district: string; state: string; pincode: string; phone: string; gstin: string; pan: string; timezone: string } }>("/api/company/profile", "GET", undefined, token);
  const renamedCompany = `PRD Profile Verification ${suffix}`;
  await request("/api/company/profile", "PUT", { ...originalProfile.data.profile, name: renamedCompany }, token);
  const ownerBrand = await expectStatus("/api/auth/me", token, 200) as { user?: { companyName?: string } };
  const profileNameUpdatePassed = ownerBrand.user?.companyName === renamedCompany;
  const logoData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4l8AAAAASUVORK5CYII=";
  const logoUpload = await request<{ success: boolean }>("/api/company/profile/logo", "PUT", { data: logoData }, token);
  const logoRead = await fetch(`${api}/api/company/profile/logo`, { headers: { Authorization: `Bearer ${token}` } });
  const companyProfilePassed = originalProfile.status === 200 && profileNameUpdatePassed
    && logoUpload.status === 200 && logoRead.status === 200
    && logoRead.headers.get("content-type") === "image/png";
  if (!companyProfilePassed) throw new Error("Owner company profile or logo update/read-back failed.");

  const branchA = await request<{ id: string }>("/api/admin/access/branches", "POST", { code: `A-${suffix}`, name: "Verification branch A" }, token);
  const branchB = await request<{ id: string }>("/api/admin/access/branches", "POST", { code: `B-${suffix}`, name: "Verification branch B" }, token);

  const roles = await request<{ roles: Array<{ id: string; code: string }> }>("/api/admin/access/roles", "GET", undefined, token);
  const managerRole = roles.data.roles.find((role) => role.code === "manager");
  if (!managerRole) throw new Error("Fresh setup did not seed the Manager role.");
  const managerEmail = `manager-${suffix}@example.test`;
  const managerPassword = `Manager-${randomBytes(12).toString("base64url")}-9A`;
  const manager = await request<{ id: string }>("/api/admin/access/users", "POST", {
    fullName: "Branch A Manager", email: managerEmail, password: managerPassword, roleIds: [managerRole.id], branchIds: [branchA.data.id],
  }, token);
  const managerLogin = await request<{ token: string }>("/api/auth/login", "POST", { email: managerEmail, password: managerPassword });
  const managerToken = managerLogin.data.token;
  if (!managerToken) throw new Error("Branch manager login did not return a session token.");
  const managerProfile = await expectStatus("/api/auth/me", managerToken, 200) as {
    user?: { permissions?: string[]; companyName?: string };
  };
  const managerCannotEditCompanyProfile = (await fetch(`${api}/api/company/profile`, { headers: { Authorization: `Bearer ${managerToken}` } })).status === 403;
  const cashierRole = roles.data.roles.find((role) => role.code === "cashier");
  if (!cashierRole) throw new Error("Fresh setup did not seed the Cashier role.");
  const cashierEmail = `cashier-${suffix}@example.test`;
  const cashierPassword = `Cashier-${randomBytes(12).toString("base64url")}-9A`;
  const cashier = await request<{ id: string; roles: string[] }>("/api/admin/access/users", "POST", {
    fullName: "Branch A Cashier", email: cashierEmail, password: cashierPassword, roleIds: [cashierRole.id], branchIds: [branchA.data.id],
  }, token);
  const cashierLogin = await request<{ token: string }>("/api/auth/login", "POST", { email: cashierEmail, password: cashierPassword });
  const cashierMe = cashierLogin.data.token ? await expectStatus("/api/auth/me", cashierLogin.data.token, 200) as { user?: { roles?: Array<{ code: string }> } } : {};
  const cashierRoleAndBranchPassed = cashier.status === 201 && cashierLogin.status === 200
    && cashierMe.user?.roles?.some((role) => role.code === "cashier") === true
    && (await expectStatus("/api/auth/branches", cashierLogin.data.token, 200) as { branches?: Array<{ id: string }> }).branches?.some((branch) => branch.id === branchA.data.id) === true;
  if (!cashierRoleAndBranchPassed || !managerCannotEditCompanyProfile) throw new Error("Cashier role/branch setup or Manager company-profile restriction failed.");
  const restrictedManagerPermissions = [
    "sales.invoice.reverse", "sales.pricing.configure", "stock.opening.post", "inventory.valuation.reconcile",
    "accounting.accounts.configure", "accounting.period.close", "accounting.financial-years.close",
    "payroll.configure", "products.tax.configure", "products.units.configure",
  ];
  const managerPresetLeastPrivilege = restrictedManagerPermissions.every((code) => !managerProfile.user?.permissions?.includes(code));
  if (!managerPresetLeastPrivilege) throw new Error("The default Manager role includes a restricted owner setup or reversal permission.");
  const managerBranches = await expectStatus("/api/auth/branches", managerToken, 200) as {
    branches?: Array<{ id: string }>;
    canViewAll?: boolean;
  };
  const managerBranchSwitch = await fetch(`${api}/api/auth/branch`, {
    method: "POST", headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ branchId: branchB.data.id }),
  });
  const managerAllBranchesSwitch = await fetch(`${api}/api/auth/branch`, {
    method: "POST", headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ branchId: null }),
  });
  const managerRoleAdmin = await fetch(`${api}/api/admin/access/roles`, { headers: { Authorization: `Bearer ${managerToken}` } });
  const managerBranchIsolation = managerBranches.branches?.length === 1
    && managerBranches.branches[0].id === branchA.data.id
    && managerBranches.canViewAll === false
    && managerBranchSwitch.status === 403
    && managerAllBranchesSwitch.status === 403
    && managerRoleAdmin.status === 403;
  if (!managerBranchIsolation) throw new Error("Manager branch assignment or role-admin restriction failed.");

  await request("/api/auth/branch", "POST", { branchId: branchA.data.id }, managerToken);
  const creditCustomer = await request<{ id: string }>("/api/masters/customers", "POST", {
    name: "Credit approval verification customer", code: `CC-${suffix}`, phone: "9876543213", email: "",
    address: "Test address", gstin: "", creditDays: 0, creditLimit: 1,
  }, managerToken);
  await request("/api/auth/branch", "POST", { branchId: branchB.data.id }, token);

  const customer = await request<{ id: string }>("/api/masters/customers", "POST", {
    name: "Delivery verification customer", code: `C-${suffix}`, phone: "9876543210", email: "",
    address: "Test address", gstin: "", creditDays: 0, creditLimit: "",
  }, token);
  const product = await request<{ id: string }>("/api/masters/products", "POST", {
    name: "Delivery verification brick", code: `P-${suffix}`, unit: "pieces", sellingRate: 12,
    taxRate: 0, purchaseRate: 5, purchaseTaxRate: 0,
  }, token);
  const broker = await request<{ id: string }>("/api/masters/brokers", "POST", {
    name: "Delivery verification broker", code: `BR-${suffix}`, phone: "9876543215", email: "",
    address: "Test address", gstin: "", creditDays: 0, creditLimit: "",
  }, token);
  await request(`/api/brokers/${broker.data.id}/commission-rule`, "PUT", {
    commissionType: "per_brick", rate: 1, accrualEvent: "payment",
  }, token);
  const creditOrder = await request<{ id: string; status: string }>("/api/sales/orders", "POST", {
    customerId: creditCustomer.data.id, orderDate: new Date().toISOString().slice(0, 10),
    productId: product.data.id, quality: "good", quantity: 1,
  }, managerToken);
  if (creditOrder.data.status !== "pending_approval") throw new Error("A sale over the customer's credit limit was not held for approval.");
  await request("/api/auth/branch", "POST", { branchId: branchA.data.id }, token);
  const ownerApprovals = await expectStatus("/api/approvals", token, 200) as {
    items?: Array<{ id: string; type: string }>;
  };
  if (!ownerApprovals.items?.some((item) => item.id === creditOrder.data.id && item.type === "sales_order")) {
    throw new Error("The over-limit sales order did not appear in the Owner's approval queue.");
  }
  await request(`/api/sales/orders/${creditOrder.data.id}/decision`, "POST", {
    approve: true, reason: "Disposable integration test approval.",
  }, token);
  const approvedCreditOrder = await expectStatus(`/api/sales/orders/${creditOrder.data.id}`, token, 200) as {
    order?: { status?: string };
  };
  const creditApprovalEvidence = await pool.query<{
    status: string;
    approved: boolean;
    branch_id: string;
    audit_events: number;
  }>(`SELECT o.status,o.credit_limit_override_approved AS approved,o.branch_id,
      (SELECT count(*)::int FROM audit_logs a WHERE a.company_id=o.company_id AND a.entity_id=o.id::text AND a.action='sales.order.approve') AS audit_events
    FROM sales_orders o WHERE o.company_id=$1 AND o.id=$2`, [companyId, creditOrder.data.id]);
  const creditApprovalPassed = approvedCreditOrder.order?.status === "open"
    && creditApprovalEvidence.rows[0]?.status === "open"
    && creditApprovalEvidence.rows[0]?.approved === true
    && creditApprovalEvidence.rows[0]?.branch_id === branchA.data.id
    && creditApprovalEvidence.rows[0]?.audit_events === 1;
  if (!creditApprovalPassed) throw new Error("Credit approval did not reopen the order and persist its branch-scoped override and audit event.");

  await request("/api/employee-advances/approval-settings", "PUT", { threshold: 100 }, token);
  const employee = await request<{ id: string }>("/api/employees", "POST", {
    employeeNumber: `EMP-${suffix}`, fullName: "Advance approval verification employee", phone: "9876543214",
    email: "", jobTitle: "Chamber worker", employmentType: "labour", joinedOn: new Date().toISOString().slice(0, 10),
    baseDailyRate: 650,
  }, managerToken);
  const employeeAdvance = await request<{ id: string; status: string }>("/api/employee-advances", "POST", {
    employeeId: employee.data.id, advanceDate: new Date().toISOString().slice(0, 10), amount: 150,
    paymentMethod: "cash", reference: "", notes: "Disposable approval verification advance",
  }, managerToken);
  if (employeeAdvance.data.status !== "pending_approval") throw new Error("An employee advance above the configured threshold was not held for approval.");
  const advanceApprovals = await expectStatus("/api/approvals", token, 200) as {
    items?: Array<{ id: string; type: string }>;
  };
  if (!advanceApprovals.items?.some((item) => item.id === employeeAdvance.data.id && item.type === "employee_advance")) {
    throw new Error("The employee advance did not appear in the Owner's approval queue.");
  }
  const advanceDecision = await request<{ status: string; journalPosted: boolean }>(
    `/api/employee-advances/${employeeAdvance.data.id}/decision`, "POST",
    { approve: true, reason: "Disposable integration test approval." }, token,
  );
  const advanceEvidence = await pool.query<{
    status: string;
    owner_approved: boolean;
    journal_exists: boolean;
    journal_balanced: boolean;
    audit_events: number;
  }>(`SELECT a.status,a.approved_by=$3 AS owner_approved,
      EXISTS(SELECT 1 FROM journal_entries j WHERE j.company_id=a.company_id AND j.source_type='employee_advance' AND j.source_id=a.id) AS journal_exists,
      (SELECT COALESCE(sum(l.debit),0)=COALESCE(sum(l.credit),0) FROM journal_entries j JOIN journal_entry_lines l ON l.company_id=j.company_id AND l.journal_entry_id=j.id WHERE j.company_id=a.company_id AND j.source_type='employee_advance' AND j.source_id=a.id) AS journal_balanced,
      (SELECT count(*)::int FROM audit_logs l WHERE l.company_id=a.company_id AND l.entity_id=a.id::text AND l.action='employee.advance.approve') AS audit_events
    FROM employee_advances a WHERE a.company_id=$1 AND a.id=$2`, [companyId, employeeAdvance.data.id, ownerId]);
  const employeeAdvanceApprovalPassed = advanceDecision.data.status === "posted" && advanceDecision.data.journalPosted
    && advanceEvidence.rows[0]?.status === "posted" && advanceEvidence.rows[0]?.owner_approved === true
    && advanceEvidence.rows[0]?.journal_exists === true && advanceEvidence.rows[0]?.journal_balanced === true
    && advanceEvidence.rows[0]?.audit_events === 1;
  if (!employeeAdvanceApprovalPassed) throw new Error("Employee advance approval did not post one balanced journal and an owner-linked audit event.");
  const rejectedAdvance = await request<{ id: string; status: string }>("/api/employee-advances", "POST", {
    employeeId: employee.data.id, advanceDate: new Date().toISOString().slice(0, 10), amount: 200,
    paymentMethod: "cash", reference: "", notes: "Disposable rejection verification advance",
  }, managerToken);
  if (rejectedAdvance.data.status !== "pending_approval") throw new Error("Second threshold-exceeding employee advance was not held for review.");
  const rejectedDecision = await request<{ status: string; journalPosted: boolean }>(
    `/api/employee-advances/${rejectedAdvance.data.id}/decision`, "POST",
    { approve: false, reason: "Disposable integration test rejection." }, token,
  );
  const rejectionEvidence = await pool.query<{
    status: string;
    owner_rejected: boolean;
    journal_exists: boolean;
    audit_events: number;
  }>(`SELECT a.status,a.rejected_by=$3 AS owner_rejected,
      EXISTS(SELECT 1 FROM journal_entries j WHERE j.company_id=a.company_id AND j.source_type='employee_advance' AND j.source_id=a.id) AS journal_exists,
      (SELECT count(*)::int FROM audit_logs l WHERE l.company_id=a.company_id AND l.entity_id=a.id::text AND l.action='employee.advance.reject') AS audit_events
    FROM employee_advances a WHERE a.company_id=$1 AND a.id=$2`, [companyId, rejectedAdvance.data.id, ownerId]);
  const employeeAdvanceRejectionPassed = rejectedDecision.data.status === "rejected" && !rejectedDecision.data.journalPosted
    && rejectionEvidence.rows[0]?.status === "rejected" && rejectionEvidence.rows[0]?.owner_rejected === true
    && rejectionEvidence.rows[0]?.journal_exists === false && rejectionEvidence.rows[0]?.audit_events === 1;
  if (!employeeAdvanceRejectionPassed) throw new Error("Rejected employee advance posted a journal or did not retain its owner-linked audit event.");
  const payrollDate = new Date().toISOString().slice(0, 10);
  const payrollPeriodStart = `${payrollDate.slice(0, 7)}-01`;
  const payrollPeriodEnd = new Date(Date.UTC(Number(payrollDate.slice(0, 4)), Number(payrollDate.slice(5, 7)), 0)).toISOString().slice(0, 10);
  await request(`/api/employees/${employee.data.id}/attendance`, "POST", {
    attendanceDate: payrollDate, status: "present", overtimeHours: 0, notes: "Disposable PRD payroll attendance",
  }, managerToken);
  const payrollRun = await request<{ id: string; status: string; totalGross: number; totalNet: number }>("/api/payroll/runs", "POST", {
    periodStart: payrollPeriodStart, periodEnd: payrollPeriodEnd, notes: "Disposable PRD payroll verification",
    adjustments: [{ employeeId: employee.data.id, pieceQuantity: 0, bonus: 0, otherDeductions: 0, advanceRecovery: 50, reason: "Recover a portion of the approved advance." }],
  }, token);
  if (payrollRun.data.status !== "pending_approval" || payrollRun.data.totalGross !== 650 || payrollRun.data.totalNet !== 600) {
    throw new Error(`Daily salary run did not calculate attendance and advance recovery correctly: ${JSON.stringify(payrollRun.data)}`);
  }
  await request(`/api/payroll/runs/${payrollRun.data.id}/approve`, "POST", { reason: "Disposable PRD payroll approval." }, token);
  const payrollDetail = await expectStatus(`/api/payroll/runs/${payrollRun.data.id}`, token, 200) as {
    run?: { status?: string };
    lines?: Array<{ lineId: string; employeeId: string; presentDays: number; advanceRecovery: number; netPay: number; paidAmount: number }>;
  };
  const payrollLine = payrollDetail.lines?.find((line) => line.employeeId === employee.data.id);
  if (!payrollLine || payrollDetail.run?.status !== "approved" || Number(payrollLine.presentDays) !== 1 || Number(payrollLine.advanceRecovery) !== 50 || Number(payrollLine.netPay) !== 600) {
    throw new Error("Approved payroll detail did not preserve the attendance, recovery and net-pay snapshots.");
  }
  const salaryPayment = await request<{ paymentNumber: string; status: string; remaining: number }>(
    `/api/payroll/runs/${payrollRun.data.id}/lines/${payrollLine.lineId}/payments`, "POST",
    { paymentDate: payrollDate, amount: 600, paymentMethod: "cash", reference: `PAY-${suffix}`, notes: "Disposable PRD salary payment" }, token,
  );
  const salaryPaymentRecord = await pool.query<{ id: string }>(
    "SELECT id FROM salary_payments WHERE company_id=$1 AND payment_number=$2",
    [companyId, salaryPayment.data.paymentNumber],
  );
  if (!salaryPaymentRecord.rowCount) throw new Error("Posted payroll payment was not saved.");
  const payrollEvidence = await pool.query<{
    run_status: string; advance_balance: string; payable_balance: string;
    balanced: boolean; journal_count: number; approval_audits: number; payment_audits: number;
  }>(`SELECT r.status AS run_status,
      (SELECT COALESCE(sum(l.debit-l.credit),0)::text FROM journal_entry_lines l JOIN accounts a ON a.company_id=l.company_id AND a.id=l.account_id WHERE l.company_id=r.company_id AND l.employee_id=$2 AND a.code='1400') AS advance_balance,
      (SELECT COALESCE(sum(l.credit-l.debit),0)::text FROM journal_entry_lines l JOIN accounts a ON a.company_id=l.company_id AND a.id=l.account_id WHERE l.company_id=r.company_id AND l.employee_id=$2 AND a.code='2500') AS payable_balance,
      (SELECT NOT EXISTS(SELECT 1 FROM journal_entries j JOIN journal_entry_lines l ON l.company_id=j.company_id AND l.journal_entry_id=j.id WHERE j.company_id=r.company_id AND ((j.source_type='salary_run' AND j.source_id=r.id) OR (j.source_type='salary_payment' AND j.source_id=$3)) GROUP BY j.id HAVING sum(l.debit)<>sum(l.credit))) AS balanced,
      (SELECT count(*)::int FROM journal_entries j WHERE j.company_id=r.company_id AND ((j.source_type='salary_run' AND j.source_id=r.id) OR (j.source_type='salary_payment' AND j.source_id=$3))) AS journal_count,
      (SELECT count(*)::int FROM audit_logs a WHERE a.company_id=r.company_id AND a.entity_id=r.id::text AND a.action='payroll.run.approve') AS approval_audits,
      (SELECT count(*)::int FROM audit_logs a WHERE a.company_id=r.company_id AND a.entity_id=$3::text AND a.action='payroll.payment.post') AS payment_audits
    FROM salary_runs r WHERE r.company_id=$1 AND r.id=$4`,
    [companyId, employee.data.id, salaryPaymentRecord.rows[0].id, payrollRun.data.id]);
  const payrollRow = payrollEvidence.rows[0];
  const payrollPassed = salaryPayment.status === 201 && salaryPayment.data.status === "paid" && salaryPayment.data.remaining === 0
    && payrollRow?.run_status === "paid" && Number(payrollRow.advance_balance) === 100
    && Number(payrollRow.payable_balance) === 0 && payrollRow.balanced === true && payrollRow.journal_count === 2
    && payrollRow.approval_audits === 1 && payrollRow.payment_audits === 1;
  if (!payrollPassed) throw new Error(`Payroll payment, advance recovery, journals or audit records did not reconcile: ${JSON.stringify(payrollRow)}`);
  await request("/api/expenses/approval-settings", "PUT", { threshold: 100 }, token);
  const expenseCategories = await expectStatus("/api/expenses/categories", token, 200) as {
    categories?: Array<{ id: string; code: string; active: boolean }>;
  };
  const expenseCategory = expenseCategories.categories?.find((category) => category.code === "OTHER" && category.active);
  if (!expenseCategory) throw new Error("Fresh setup did not provide an active expense category.");
  const offlineExpenseBody = {
    categoryId: expenseCategory.id, expenseDate: payrollDate, amount: 150, paymentMethod: "cash",
    description: "Disposable PRD expense approval", reference: `EXP-${suffix}`,
  };
  const offlineExpenseKey = `prd-offline-${suffix}-expense`;
  const expense = await request<{ id: string; status: string; expenseNumber: string }>("/api/expenses", "POST", offlineExpenseBody, managerToken, offlineExpenseKey);
  // Simulate losing the first HTTP response after the server committed. The browser outbox
  // must retry the same payload with the same key and receive the original result.
  const expenseRetry = await request<{ id: string; status: string; expenseNumber: string }>("/api/expenses", "POST", offlineExpenseBody, managerToken, offlineExpenseKey);
  const retryEvidence = await pool.query<{ expense_count: number; audit_count: number; idempotency_count: number }>(
    `SELECT
       (SELECT count(*)::int FROM expenses WHERE company_id=$1 AND id=$2) AS expense_count,
       (SELECT count(*)::int FROM audit_logs WHERE company_id=$1 AND entity_id=$2::text AND action='expense.submit_for_approval') AS audit_count,
       (SELECT count(*)::int FROM transaction_idempotency_keys WHERE company_id=$1 AND user_id=$3 AND operation='expenses.post' AND request_key=$4) AS idempotency_count`,
    [companyId, expense.data.id, manager.data.id, offlineExpenseKey],
  );
  const offlineRetryExactlyOnce = expense.status === 201 && expenseRetry.status === 201
    && expense.data.id === expenseRetry.data.id && expense.data.expenseNumber === expenseRetry.data.expenseNumber
    && retryEvidence.rows[0]?.expense_count === 1 && retryEvidence.rows[0]?.audit_count === 1
    && retryEvidence.rows[0]?.idempotency_count === 1;
  if (!offlineRetryExactlyOnce) throw new Error("Offline expense retry created duplicate effects or failed to replay its original response.");
  if (expense.data.status !== "pending_approval") throw new Error("Expense above the configured threshold was not queued for approval.");
  const expenseQueue = await expectStatus("/api/expenses", token, 200) as { expenses?: Array<{ id: string; status: string }> };
  if (!expenseQueue.expenses?.some((item) => item.id === expense.data.id && item.status === "pending_approval")) {
    throw new Error("Pending expense was not visible in the Owner's expense queue.");
  }
  await request(`/api/expenses/${expense.data.id}/approve`, "POST", { reason: "Disposable PRD expense approval." }, token);
  const expenseEvidence = await pool.query<{
    status: string; branch_id: string; journal_count: number; debit: string; credit: string; audit_events: number;
  }>(`SELECT e.status,e.branch_id,
      (SELECT count(*)::int FROM journal_entries j WHERE j.company_id=e.company_id AND j.source_type='expense' AND j.source_id=e.id) AS journal_count,
      (SELECT COALESCE(sum(l.debit),0)::text FROM journal_entries j JOIN journal_entry_lines l ON l.company_id=j.company_id AND l.journal_entry_id=j.id WHERE j.company_id=e.company_id AND j.source_type='expense' AND j.source_id=e.id) AS debit,
      (SELECT COALESCE(sum(l.credit),0)::text FROM journal_entries j JOIN journal_entry_lines l ON l.company_id=j.company_id AND l.journal_entry_id=j.id WHERE j.company_id=e.company_id AND j.source_type='expense' AND j.source_id=e.id) AS credit,
      (SELECT count(*)::int FROM audit_logs a WHERE a.company_id=e.company_id AND a.entity_id=e.id::text AND a.action='expense.approve') AS audit_events
    FROM expenses e WHERE e.company_id=$1 AND e.id=$2`, [companyId, expense.data.id]);
  const expenseRow = expenseEvidence.rows[0];
  const expenseApprovalPassed = expenseRow?.status === "posted" && expenseRow.branch_id === branchA.data.id && expenseRow.journal_count === 1
    && Number(expenseRow.debit) === 150 && Number(expenseRow.credit) === 150 && expenseRow.audit_events === 1;
  if (!expenseApprovalPassed) throw new Error(`Expense approval did not post one balanced cash journal and approval audit: ${JSON.stringify(expenseRow)}`);
  await request("/api/auth/branch", "POST", { branchId: branchB.data.id }, token);
  const supplier = await request<{ id: string }>("/api/masters/suppliers", "POST", {
    name: "Delivery verification supplier", code: `S-${suffix}`, phone: "9876543212", email: "",
    address: "Test address", gstin: "", creditDays: 0, creditLimit: "",
  }, token);
  const chamber = await request<{ id: string }>("/api/masters/chambers", "POST", {
    name: "Verification chamber", code: `CH-${suffix}`, capacity: 100, capacityUnit: "pieces", sections: 1, location: "Test branch",
  }, token);
  const vehicle = await request<{ id: string }>("/api/masters/vehicles", "POST", {
    name: "Verification truck", code: `V-${suffix}`, vehicleType: "truck", capacity: "", capacityUnit: "",
  }, token);
  const driver = await request<{ id: string }>("/api/masters/drivers", "POST", {
    name: "Verification driver", code: `DL-${suffix}`, licenseType: "LMV", phone: "9876543211",
  }, token);

  const batch = await request<{ id: string }>("/api/production/batches", "POST", {
    batchCode: `BATCH-${suffix}`, chamberId: chamber.data.id, productId: product.data.id,
    startedOn: new Date().toISOString().slice(0, 10), plannedQuantity: 30,
  }, token);
  await request(`/api/production/batches/${batch.data.id}/costs`, "POST", {
    category: "fuel", description: "Disposable kiln fuel cost", amount: 100,
    incurredOn: new Date().toISOString().slice(0, 10), fundingAccountCode: "1110", reference: `FUEL-${suffix}`,
  }, token);
  await request(`/api/production/batches/${batch.data.id}/start`, "POST", undefined, token);
  await request(`/api/production/batches/${batch.data.id}/milestones`, "POST", {
    milestone: "firing", loadedQuantity: 28, notes: "Disposable PRD verification kiln load.",
  }, token);
  await request(`/api/production/batches/${batch.data.id}/milestones`, "POST", { milestone: "cooling" }, token);
  await request(`/api/production/batches/${batch.data.id}/milestones`, "POST", { milestone: "unloading" }, token);
  const production = await request<{ lossQuantity: number; outputQuantity: number; quantities: { goodQuantity: number; secondQuantity: number; brokenQuantity: number; rejectedQuantity: number } }>(
    `/api/production/batches/${batch.data.id}/complete`, "POST",
    { goodQuantity: 24, secondQuantity: 2, brokenQuantity: 1, rejectedQuantity: 0, unitCode: "PIECES" }, token,
  );
  const productionEvidence = await pool.query<{
    status: string; loaded_quantity: string; good_quantity: string; second_quantity: string;
    broken_quantity: string; rejected_quantity: string; loss_quantity: string;
    production_stock: string; production_inventory_cost: string; production_layer_value: string;
    gl_inventory_delta: string; wip_balance: string; balanced: boolean; journal_count: number; milestones: number;
  }>(`SELECT b.status,b.loaded_quantity::text,b.good_quantity::text,b.second_quantity::text,b.broken_quantity::text,b.rejected_quantity::text,b.loss_quantity::text,
      (SELECT COALESCE(sum(sm.quantity),0)::text FROM stock_movements sm WHERE sm.company_id=b.company_id AND sm.batch_id=b.id AND sm.movement_type='production_in') AS production_stock,
      (SELECT COALESCE(sum(sm.inventory_cost),0)::text FROM stock_movements sm WHERE sm.company_id=b.company_id AND sm.batch_id=b.id AND sm.movement_type='production_in') AS production_inventory_cost,
      (SELECT round(COALESCE(sum(l.remaining_quantity*l.unit_cost),0),2)::text FROM inventory_cost_layers l WHERE l.company_id=b.company_id AND l.source_type='production_batch' AND l.source_id=b.id) AS production_layer_value,
      (SELECT COALESCE(sum(jl.debit-jl.credit),0)::text FROM journal_entries j JOIN journal_entry_lines jl ON jl.company_id=j.company_id AND jl.journal_entry_id=j.id JOIN accounts a ON a.company_id=jl.company_id AND a.id=jl.account_id WHERE j.company_id=b.company_id AND a.code='1300' AND ((j.source_type='production_batch_completion' AND j.source_id=b.id) OR (j.source_type='production_cost_line' AND j.source_id IN (SELECT id FROM production_cost_lines WHERE company_id=b.company_id AND batch_id=b.id)))) AS gl_inventory_delta,
      (SELECT COALESCE(sum(jl.debit-jl.credit),0)::text FROM journal_entries j JOIN journal_entry_lines jl ON jl.company_id=j.company_id AND jl.journal_entry_id=j.id JOIN accounts a ON a.company_id=jl.company_id AND a.id=jl.account_id WHERE j.company_id=b.company_id AND a.code='1350' AND ((j.source_type='production_batch_completion' AND j.source_id=b.id) OR (j.source_type='production_cost_line' AND j.source_id IN (SELECT id FROM production_cost_lines WHERE company_id=b.company_id AND batch_id=b.id)))) AS wip_balance,
      (SELECT NOT EXISTS(SELECT 1 FROM journal_entries j JOIN journal_entry_lines jl ON jl.company_id=j.company_id AND jl.journal_entry_id=j.id WHERE j.company_id=b.company_id AND ((j.source_type='production_batch_completion' AND j.source_id=b.id) OR (j.source_type='production_cost_line' AND j.source_id IN (SELECT id FROM production_cost_lines WHERE company_id=b.company_id AND batch_id=b.id))) GROUP BY j.id HAVING sum(jl.debit)<>sum(jl.credit))) AS balanced,
      (SELECT count(*)::int FROM journal_entries j WHERE j.company_id=b.company_id AND ((j.source_type='production_batch_completion' AND j.source_id=b.id) OR (j.source_type='production_cost_line' AND j.source_id IN (SELECT id FROM production_cost_lines WHERE company_id=b.company_id AND batch_id=b.id)))) AS journal_count,
      (SELECT count(*)::int FROM production_batch_milestones m WHERE m.company_id=b.company_id AND m.batch_id=b.id) AS milestones
    FROM production_batches b WHERE b.company_id=$1 AND b.id=$2`, [companyId, batch.data.id]);
  const productionRow = productionEvidence.rows[0];
  const productionToStockPassed = production.data.lossQuantity === 1 && production.data.outputQuantity === 27
    && productionRow?.status === "completed" && Number(productionRow.loaded_quantity) === 28
    && Number(productionRow.good_quantity) === 24 && Number(productionRow.second_quantity) === 2
    && Number(productionRow.broken_quantity) === 1 && Number(productionRow.rejected_quantity) === 0
    && Number(productionRow.loss_quantity) === 1 && Number(productionRow.production_stock) === 26
    && Number(productionRow.production_inventory_cost) === 100 && Number(productionRow.production_layer_value) === 100
    && Number(productionRow.gl_inventory_delta) === 100 && Number(productionRow.wip_balance) === 0
    && productionRow.balanced === true && productionRow.journal_count === 2 && productionRow.milestones === 6;
  if (!productionToStockPassed) throw new Error(`Production output did not reconcile with stock, milestones and journal: ${JSON.stringify(productionRow)} ${JSON.stringify(production.data)}`);
  const purchaseOrder = await request<{ id: string }>("/api/purchases/orders", "POST", {
    supplierId: supplier.data.id, productId: product.data.id, orderDate: new Date().toISOString().slice(0, 10), quantity: 5,
  }, token);
  const purchaseOrderList = await expectStatus("/api/purchases/orders", token, 200) as {
    orders?: Array<{ id: string; orderLineId: string; status: string; quantity: number }>;
  };
  const purchaseOrderLine = purchaseOrderList.orders?.find((row) => row.id === purchaseOrder.data.id);
  if (!purchaseOrderLine) throw new Error("Created purchase order line was not visible to its owner.");
  const purchaseReceipt = await request<{ id: string; subtotal: number }>(`/api/purchases/orders/${purchaseOrder.data.id}/receipts`, "POST", {
    receiptDate: new Date().toISOString().slice(0, 10), notes: "Disposable PRD supplier receipt",
    lines: [{ orderLineId: purchaseOrderLine.orderLineId, quantity: 5 }],
  }, token);
  const supplierBill = await request<{ id: string; total: number }>(`/api/purchases/orders/${purchaseOrder.data.id}/bills`, "POST", {
    billDate: new Date().toISOString().slice(0, 10), supplierInvoiceNumber: `INV-${suffix}`,
  }, token);
  const supplierPayment = await request<{ id: string }>("/api/purchases/payments", "POST", {
    supplierId: supplier.data.id, billId: supplierBill.data.id, paymentDate: new Date().toISOString().slice(0, 10),
    amount: supplierBill.data.total, paymentMethod: "cash", reference: `PAY-${suffix}`,
  }, token);
  const supplierLedger = await expectStatus(`/api/purchases/suppliers/${supplier.data.id}/ledger`, token, 200) as { balance?: number };
  const purchaseEvidence = await pool.query<{
    order_status: string; received: string; billed: string; paid: string; outstanding: string;
    receipt_inventory: string; journal_count: number; journals_balanced: boolean;
  }>(`SELECT po.status AS order_status,
      (SELECT COALESCE(sum(l.received_quantity),0)::text FROM purchase_order_lines l WHERE l.company_id=po.company_id AND l.order_id=po.id) AS received,
      (SELECT COALESCE(sum(l.billed_quantity),0)::text FROM purchase_order_lines l WHERE l.company_id=po.company_id AND l.order_id=po.id) AS billed,
      (SELECT COALESCE(sum(p.amount),0)::text FROM supplier_payments p WHERE p.company_id=po.company_id AND p.bill_id=$3) AS paid,
      (SELECT b.total-COALESCE(sum(p.amount),0) FROM purchase_bills b LEFT JOIN supplier_payments p ON p.company_id=b.company_id AND p.bill_id=b.id WHERE b.company_id=po.company_id AND b.id=$3 GROUP BY b.total)::text AS outstanding,
      (SELECT COALESCE(sum(sm.inventory_cost),0)::text FROM stock_movements sm WHERE sm.company_id=po.company_id AND sm.movement_type='purchase_in' AND sm.reference_type='purchase_receipt' AND sm.reference_id=$2) AS receipt_inventory,
      (SELECT count(*)::int FROM journal_entries j WHERE j.company_id=po.company_id AND ((j.source_type='purchase_receipt' AND j.source_id=$2) OR (j.source_type='purchase_bill' AND j.source_id=$3) OR (j.source_type='supplier_payment' AND j.source_id=$4))) AS journal_count,
      (SELECT NOT EXISTS(SELECT 1 FROM journal_entries j JOIN journal_entry_lines l ON l.company_id=j.company_id AND l.journal_entry_id=j.id WHERE j.company_id=po.company_id AND ((j.source_type='purchase_receipt' AND j.source_id=$2) OR (j.source_type='purchase_bill' AND j.source_id=$3) OR (j.source_type='supplier_payment' AND j.source_id=$4)) GROUP BY j.id HAVING sum(l.debit)<>sum(l.credit))) AS journals_balanced
    FROM purchase_orders po WHERE po.company_id=$1 AND po.id=$5`,
    [companyId, purchaseReceipt.data.id, supplierBill.data.id, supplierPayment.data.id, purchaseOrder.data.id]);
  const purchaseRow = purchaseEvidence.rows[0];
  const purchaseToPaymentPassed = purchaseRow?.order_status === "billed" && Number(purchaseRow.received) === 5
    && Number(purchaseRow.billed) === 5 && Number(purchaseRow.paid) === supplierBill.data.total
    && Number(purchaseRow.outstanding) === 0 && Number(purchaseRow.receipt_inventory) === 25
    && purchaseRow.journal_count === 3 && purchaseRow.journals_balanced === true
    && Math.abs(Number(supplierLedger.balance)) < 0.005;
  if (!purchaseToPaymentPassed) throw new Error(`Purchase, receipt, bill, payment or supplier ledger did not reconcile: ${JSON.stringify(purchaseRow)}`);

  const location = await pool.query<{ id: string }>(
    "SELECT id FROM stock_locations WHERE company_id=$1 AND branch_id=$2 AND active=true LIMIT 1", [companyId, branchB.data.id],
  );
  if (!location.rowCount) throw new Error("Fresh setup did not create an active stock location.");
  const opening = await request<{ id: string }>("/api/stock/opening-balances", "POST", {
    locationId: location.rows[0].id,
    openingDate: new Date().toISOString().slice(0, 10),
    notes: "Disposable PRD delivery workflow verification",
    lines: [{ productId: product.data.id, quality: "good", quantity: 20, unitCode: "PIECES", unitCost: 5 }],
  }, token);
  const reversalOrder = await request<{ id: string }>("/api/sales/orders", "POST", {
    customerId: customer.data.id, orderDate: new Date().toISOString().slice(0, 10),
    productId: product.data.id, quality: "good", quantity: 1,
  }, token);
  const reversalInvoice = await request<{ id: string }>(`/api/sales/orders/${reversalOrder.data.id}/invoice`, "POST", {}, token);
  await pool.query(`INSERT INTO role_permissions(role_id,permission_id)
    SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='sales.invoice.reverse'
    WHERE r.company_id=$1 AND r.code='manager' ON CONFLICT DO NOTHING`, [companyId]);
  const managerReverseAttempt = await fetch(`${api}/api/sales/invoices/${reversalInvoice.data.id}/reverse`, {
    method: "POST",
    headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json", "Idempotency-Key": `prd-e2e-${suffix}-manager-reversal` },
    body: JSON.stringify({ reversalDate: new Date().toISOString().slice(0, 10), reason: "Verify Owner-only invoice reversal." }),
  });
  const managerReverseBody = await managerReverseAttempt.json() as { error?: { code?: string } };
  if (managerReverseAttempt.status !== 403 || managerReverseBody.error?.code !== "OWNER_REQUIRED") {
    throw new Error(`A Manager with an injected reversal permission was not blocked by the Owner-only guard: ${managerReverseAttempt.status}/${managerReverseBody.error?.code}.`);
  }
  const reversal = await request<{ id: string; reversalNumber: string }>(
    `/api/sales/invoices/${reversalInvoice.data.id}/reverse`, "POST",
    { reversalDate: new Date().toISOString().slice(0, 10), reason: "Disposable PRD invoice reversal verification." }, token,
  );
  const reversalEvidence = await pool.query<{
    invoice_status: string; order_status: string; reversal_count: number; restored_quantity: string;
    journal_count: number; balanced: boolean; audit_events: number;
  }>(`SELECT i.status AS invoice_status,o.status AS order_status,
      (SELECT count(*)::int FROM sales_invoice_reversals r WHERE r.company_id=i.company_id AND r.id=$2) AS reversal_count,
      (SELECT COALESCE(sum(sm.quantity),0)::text FROM stock_movements sm WHERE sm.company_id=i.company_id AND sm.movement_type='sale_reversal_in' AND sm.reference_id=$2) AS restored_quantity,
      (SELECT count(*)::int FROM journal_entries j WHERE j.company_id=i.company_id AND ((j.source_type='sales_invoice' AND j.source_id=i.id) OR (j.source_type='sales_invoice_reversal' AND j.source_id=$2))) AS journal_count,
      (SELECT NOT EXISTS(SELECT 1 FROM journal_entries j JOIN journal_entry_lines l ON l.company_id=j.company_id AND l.journal_entry_id=j.id WHERE j.company_id=i.company_id AND ((j.source_type='sales_invoice' AND j.source_id=i.id) OR (j.source_type='sales_invoice_reversal' AND j.source_id=$2)) GROUP BY j.id HAVING sum(l.debit)<>sum(l.credit))) AS balanced,
      (SELECT count(*)::int FROM audit_logs a WHERE a.company_id=i.company_id AND a.entity_id=$2::text AND a.action='sales.invoice.reverse') AS audit_events
    FROM sales_invoices i JOIN sales_orders o ON o.company_id=i.company_id AND o.id=i.order_id
    WHERE i.company_id=$1 AND i.id=$3`, [companyId, reversal.data.id, reversalInvoice.data.id]);
  const reversalRow = reversalEvidence.rows[0];
  const invoiceReversalPassed = managerReverseAttempt.status === 403 && reversalRow?.invoice_status === "reversed"
    && reversalRow.order_status === "cancelled" && reversalRow.reversal_count === 1
    && Number(reversalRow.restored_quantity) === 1 && reversalRow.journal_count === 2
    && reversalRow.balanced === true && reversalRow.audit_events === 1;
  if (!invoiceReversalPassed) throw new Error(`Invoice reversal did not restore stock and reverse accounting/audit consistently: ${JSON.stringify(reversalRow)}`);
  const order = await request<{ id: string; status?: string }>("/api/sales/orders", "POST", {
    customerId: customer.data.id,
    brokerId: broker.data.id,
    orderDate: new Date().toISOString().slice(0, 10),
    productId: product.data.id,
    quality: "good",
    quantity: 10,
  }, token);
  const invoice = await request<{ id: string; invoiceNumber: string; total: number }>(
    `/api/sales/orders/${order.data.id}/invoice`, "POST", {}, token,
  );
  const loading = await request<{ id: string; status?: string }>("/api/loading", "POST", {
    invoiceId: invoice.data.id, vehicleId: vehicle.data.id, driverId: driver.data.id, destination: "Verification destination",
  }, token);
  const testPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4RkAAAAASUVORK5CYII=";
  await request(`/api/loading/${loading.data.id}/photos`, "POST", {
    photoType: "before", contentType: "image/png", imageBase64: testPngBase64,
  }, token);
  await request(`/api/loading/${loading.data.id}/complete`, "POST", { quantity: 10 }, token);
  await request(`/api/loading/${loading.data.id}/photos`, "POST", {
    photoType: "during", contentType: "image/png", imageBase64: testPngBase64,
  }, token);
  const verified = await request<{ status: string; variance: number }>(
    `/api/loading/${loading.data.id}/verify`, "POST", { quantity: 10 }, token,
  );
  if (verified.data.status !== "verified" || verified.data.variance !== 0) throw new Error("Matching loading quantity did not verify cleanly.");
  await request(`/api/loading/${loading.data.id}/photos`, "POST", {
    photoType: "after", contentType: "image/png", imageBase64: testPngBase64,
  }, token);
  const loadingWithPhotos = await expectStatus(`/api/loading/${loading.data.id}`, token, 200) as {
    photos?: Array<{ photoType: string; byteSize: number; imageBase64: string }>;
  };
  const loadingPhotosPassed = loadingWithPhotos.photos?.length === 3
    && ["before", "during", "after"].every((type) => loadingWithPhotos.photos?.some((photo) => photo.photoType === type
      && Number(photo.byteSize) > 0
      && photo.imageBase64.replace(/\s/g, "").replace(/=+$/g, "") === testPngBase64.replace(/=+$/g, "")));
  if (!loadingPhotosPassed) throw new Error(`Loading photo evidence did not round-trip with its stage, content and size metadata: ${JSON.stringify(loadingWithPhotos.photos?.map(({ photoType, byteSize, imageBase64 }) => ({ photoType, byteSize, base64Length: imageBase64.length })))}`);

  const branchBDetails = await Promise.all([
    expectStatus(`/api/sales/orders/${order.data.id}`, token, 200),
    expectStatus(`/api/loading/${loading.data.id}`, token, 200),
    expectStatus(`/api/purchases/orders/${purchaseOrder.data.id}`, token, 200),
    expectStatus(`/api/production/batches/${batch.data.id}/costs`, token, 200),
    expectStatus(`/api/production/batches/${batch.data.id}/milestones`, token, 200),
  ]);
  const productionAuditPath = `/api/audit/logs?search=${encodeURIComponent(batch.data.id)}&entityType=production_batch`;
  const branchBAudit = await expectStatus(productionAuditPath, token, 200) as { events?: unknown[] };
  if (!branchBAudit.events?.length) throw new Error("Branch B did not receive its production batch audit event.");

  const tooEarly = await fetch(`${api}/api/loading/${loading.data.id}/deliver`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": `prd-e2e-${suffix}-early-delivery` },
  });
  if (tooEarly.status !== 409) throw new Error(`Delivery before dispatch should return 409; received ${tooEarly.status}.`);
  await request(`/api/loading/${loading.data.id}/dispatch`, "POST", undefined, token);
  const photoAfterDispatch = await fetch(`${api}/api/loading/${loading.data.id}/photos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": `prd-e2e-${suffix}-photo-after-dispatch` },
    body: JSON.stringify({ photoType: "after", contentType: "image/png", imageBase64: testPngBase64 }),
  });
  if (photoAfterDispatch.status !== 409) throw new Error(`Loading evidence after dispatch should return 409; received ${photoAfterDispatch.status}.`);
  await request(`/api/loading/${loading.data.id}/deliver`, "POST", undefined, token);

  const receipt = await request<{ id: string }>("/api/sales/receipts", "POST", {
    customerId: customer.data.id, invoiceId: invoice.data.id, receiptDate: new Date().toISOString().slice(0, 10),
    amount: invoice.data.total, paymentMethod: "cash", reference: "Delivery verification receipt",
  }, token);
  const customerLedger = await expectStatus(`/api/sales/customers/${customer.data.id}/ledger`, token, 200) as {
    balance?: number;
  };
  const commissionList = await expectStatus("/api/broker-commissions", token, 200) as {
    commissions?: Array<{ id: string; brokerId: string; invoiceId: string; commissionAmount: number; accruedAmount: number; payableAmount: number }>;
  };
  const commission = commissionList.commissions?.find((item) => item.brokerId === broker.data.id && item.invoiceId === invoice.data.id);
  const customerReceiptJournal = await pool.query<{ debit: string; credit: string }>(
    `SELECT COALESCE(sum(l.debit),0)::text AS debit,COALESCE(sum(l.credit),0)::text AS credit
     FROM journal_entries j JOIN journal_entry_lines l ON l.company_id=j.company_id AND l.journal_entry_id=j.id
     WHERE j.company_id=$1 AND j.source_type='customer_receipt' AND j.source_id=$2`,
    [companyId, receipt.data.id],
  );
  const receiptAndCommissionPassed = Math.abs(Number(customerLedger.balance)) < 0.005
    && Number(customerReceiptJournal.rows[0]?.debit) === invoice.data.total
    && Number(customerReceiptJournal.rows[0]?.credit) === invoice.data.total
    && Number(commission?.commissionAmount) === 10 && Number(commission?.accruedAmount) === 10 && Number(commission?.payableAmount) === 10;
  if (!receiptAndCommissionPassed || !commission) throw new Error("Customer payment, receivable ledger, or payment-triggered broker commission did not reconcile.");
  const brokerPayment = await request<{ id: string }>(`/api/broker-commissions/${commission.id}/payments`, "POST", {
    paymentDate: new Date().toISOString().slice(0, 10), amount: 10, paymentMethod: "cash", reference: "Verification payout",
  }, token);
  const brokerLedgerAfterPayment = await expectStatus(`/api/brokers/${broker.data.id}/ledger`, token, 200) as {
    balance?: number;
  };
  const brokerPaymentJournal = await pool.query<{ debit: string; credit: string }>(
    `SELECT COALESCE(sum(l.debit),0)::text AS debit,COALESCE(sum(l.credit),0)::text AS credit
     FROM journal_entries j JOIN journal_entry_lines l ON l.company_id=j.company_id AND l.journal_entry_id=j.id
     WHERE j.company_id=$1 AND j.source_type='broker_commission_payment' AND j.source_id=$2`,
    [companyId, brokerPayment.data.id],
  );
  const brokerSettlementPassed = Math.abs(Number(brokerLedgerAfterPayment.balance)) < 0.005
    && Number(brokerPaymentJournal.rows[0]?.debit) === 10 && Number(brokerPaymentJournal.rows[0]?.credit) === 10;
  if (!brokerSettlementPassed) throw new Error("Broker payment did not clear the commission payable with a balanced journal.");

  await request("/api/auth/branch", "POST", { branchId: branchA.data.id }, token);
  const crossBranchStatuses = await Promise.all([
    expectStatus(`/api/sales/orders/${order.data.id}`, token, 404),
    expectStatus(`/api/loading/${loading.data.id}`, token, 404),
    expectStatus(`/api/purchases/orders/${purchaseOrder.data.id}`, token, 404),
    expectStatus(`/api/production/batches/${batch.data.id}/costs`, token, 404),
    expectStatus(`/api/production/batches/${batch.data.id}/milestones`, token, 404),
  ]);
  const branchAAudit = await expectStatus(productionAuditPath, token, 200) as { events?: unknown[] };
  if (branchAAudit.events?.length) throw new Error("Branch A received audit events for a branch-B production batch.");
  const managerBranchBDetails = await Promise.all([
    expectStatus(`/api/sales/orders/${order.data.id}`, managerToken, 404),
    expectStatus(`/api/loading/${loading.data.id}`, managerToken, 404),
    expectStatus(`/api/purchases/orders/${purchaseOrder.data.id}`, managerToken, 404),
    expectStatus(`/api/production/batches/${batch.data.id}/costs`, managerToken, 404),
    expectStatus(`/api/production/batches/${batch.data.id}/milestones`, managerToken, 404),
  ]);
  const managerBranchAudit = await expectStatus(productionAuditPath, managerToken, 200) as { events?: unknown[] };
  if (managerBranchAudit.events?.length) throw new Error("Branch A Manager received audit events for a branch-B production batch.");

  await request("/api/auth/branch", "POST", { branchId: null }, token);
  const years = await expectStatus("/api/accounting/financial-years", token, 200) as {
    years?: Array<{ id: string; startsOn: string; endsOn: string; status: string }>;
  };
  const reportingYear = years.years?.find(year => year.status === "open");
  if (!reportingYear) throw new Error("The Owner has no open financial year for report reconciliation.");
  const reportDate = new Date().toISOString().slice(0, 10);
  const trial = await expectStatus(`/api/accounting/trial-balance?financialYearId=${reportingYear.id}&to=${reportDate}`, token, 200) as {
    rows?: Array<{ code: string; accountType: string; balance: number }>;
    totalDebit?: number; totalCredit?: number;
  };
  const profitLoss = await expectStatus(`/api/accounting/profit-loss?from=${reportingYear.startsOn}&to=${reportDate}`, token, 200) as {
    rows?: Array<{ accountType: string; amount: number }>;
    income?: number; expenses?: number; netProfit?: number;
  };
  const balanceSheet = await expectStatus(`/api/accounting/balance-sheet?to=${reportDate}`, token, 200) as {
    totalAssets?: number; totalLiabilitiesAndEquity?: number; balanced?: boolean;
  };
  const cashBook = await expectStatus(`/api/accounting/cash-bank-book?account=1110&from=${reportingYear.startsOn}&to=${reportDate}`, token, 200) as {
    closingBalance?: number;
  };
  const bankBook = await expectStatus(`/api/accounting/cash-bank-book?account=1120&from=${reportingYear.startsOn}&to=${reportDate}`, token, 200) as {
    closingBalance?: number;
  };
  const amountMatches = (left: number | undefined, right: number | undefined) =>
    typeof left === "number" && typeof right === "number" && Math.abs(left - right) < 0.011;
  const trialIncome = trial.rows?.filter(row => row.accountType === "income").reduce((sum, row) => sum + row.balance, 0) ?? NaN;
  const trialExpenses = trial.rows?.filter(row => row.accountType === "expense").reduce((sum, row) => sum + row.balance, 0) ?? NaN;
  const reportReconciliationPassed = amountMatches(trial.totalDebit, trial.totalCredit)
    && amountMatches(profitLoss.income, trialIncome)
    && amountMatches(profitLoss.expenses, trialExpenses)
    && amountMatches(profitLoss.netProfit, trialIncome - trialExpenses)
    && balanceSheet.balanced === true
    && amountMatches(balanceSheet.totalAssets, balanceSheet.totalLiabilitiesAndEquity)
    && amountMatches(cashBook.closingBalance, trial.rows?.find(row => row.code === "1110")?.balance)
    && amountMatches(bankBook.closingBalance, trial.rows?.find(row => row.code === "1120")?.balance);
  if (!reportReconciliationPassed) {
    throw new Error(`Auditor report totals did not reconcile to the trial balance: ${JSON.stringify({
      trialDebit: trial.totalDebit, trialCredit: trial.totalCredit, trialIncome, reportIncome: profitLoss.income,
      trialExpenses, reportExpenses: profitLoss.expenses, reportNetProfit: profitLoss.netProfit,
      assets: balanceSheet.totalAssets, liabilitiesAndEquity: balanceSheet.totalLiabilitiesAndEquity,
      cashBook: cashBook.closingBalance, cashTrialBalance: trial.rows?.find(row => row.code === "1110")?.balance,
      bankBook: bankBook.closingBalance, bankTrialBalance: trial.rows?.find(row => row.code === "1120")?.balance,
    })}`);
  }

  const evidence = await pool.query<{
    loading_status: string; stock_quantity: string; invoice_status: string; invoice_total: string;
    journal_debits: string; journal_credits: string; audit_events: string;
    customer_credit_limit_is_null: boolean; vehicle_capacity_is_null: boolean;
    sales_order_in_branch_b: boolean; loading_in_branch_b: boolean;
    purchase_order_in_branch_b: boolean; production_batch_in_branch_b: boolean;
  }>(`SELECT ls.status AS loading_status,
      (SELECT COALESCE(sum(CASE WHEN sm.direction='in' THEN sm.quantity ELSE -sm.quantity END),0)::text
       FROM stock_movements sm WHERE sm.company_id=$1 AND sm.product_id=$2 AND sm.location_id=$3 AND sm.quality='good') AS stock_quantity,
      si.status AS invoice_status,si.total::text AS invoice_total,
      (SELECT COALESCE(sum(jl.debit),0)::text FROM journal_entries je JOIN journal_entry_lines jl ON jl.company_id=je.company_id AND jl.journal_entry_id=je.id WHERE je.company_id=$1 AND je.source_type='sales_invoice' AND je.source_id=si.id) AS journal_debits,
      (SELECT COALESCE(sum(jl.credit),0)::text FROM journal_entries je JOIN journal_entry_lines jl ON jl.company_id=je.company_id AND jl.journal_entry_id=je.id WHERE je.company_id=$1 AND je.source_type='sales_invoice' AND je.source_id=si.id) AS journal_credits,
      (SELECT count(*)::text FROM audit_logs al WHERE al.company_id=$1 AND al.entity_id=ls.id::text AND al.action IN ('loading.complete','loading.verify','delivery.dispatch','delivery.complete')) AS audit_events
      ,(SELECT credit_limit IS NULL FROM business_partners WHERE company_id=$1 AND id=$5) AS customer_credit_limit_is_null
      ,(SELECT capacity IS NULL FROM vehicles WHERE company_id=$1 AND id=$6) AS vehicle_capacity_is_null
      ,(SELECT branch_id=$7 FROM sales_orders WHERE company_id=$1 AND id=$8) AS sales_order_in_branch_b
      ,(SELECT branch_id=$7 FROM loading_sessions WHERE company_id=$1 AND id=$4) AS loading_in_branch_b
      ,(SELECT branch_id=$7 FROM purchase_orders WHERE company_id=$1 AND id=$9) AS purchase_order_in_branch_b
      ,(SELECT branch_id=$7 FROM production_batches WHERE company_id=$1 AND id=$10) AS production_batch_in_branch_b
    FROM loading_sessions ls JOIN sales_invoices si ON si.company_id=ls.company_id AND si.id=ls.invoice_id
    WHERE ls.company_id=$1 AND ls.id=$4`, [companyId, product.data.id, location.rows[0].id, loading.data.id, customer.data.id, vehicle.data.id, branchB.data.id, order.data.id, purchaseOrder.data.id, batch.data.id]);
  if (!evidence.rowCount) throw new Error("Final workflow records could not be found in PostgreSQL.");
  const row = evidence.rows[0];
  const result = {
    check: "sales-order-to-delivery-e2e",
    setup: setup.status,
    login: login.status,
    managerLogin: managerLogin.status,
    cashierLogin: cashierLogin.status,
    cashierRoleAndBranchPassed,
    companyProfilePassed,
    reportReconciliationPassed,
    trialBalanceDebit: trial.totalDebit,
    trialBalanceCredit: trial.totalCredit,
    trialIncome: Number(trialIncome.toFixed(2)),
    profitLossIncome: profitLoss.income,
    trialExpenses: Number(trialExpenses.toFixed(2)),
    profitLossExpenses: profitLoss.expenses,
    reportCashBookClosing: cashBook.closingBalance,
    trialCashBalance: trial.rows?.find(row => row.code === "1110")?.balance,
    reportBankBookClosing: bankBook.closingBalance,
    trialBankBalance: trial.rows?.find(row => row.code === "1120")?.balance,
    managerCannotEditCompanyProfile,
    managerPresetLeastPrivilege,
    invoiceReversalPassed,
    invoiceReversalManagerStatus: managerReverseAttempt.status,
    invoiceReversalRestoredQuantity: reversalRow?.restored_quantity,
    managerBranchIsolation,
    creditOrderStatusBeforeApproval: creditOrder.data.status,
    creditApprovalQueueIncludedOrder: true,
    creditApprovalPassed,
    employeeAdvanceStatusBeforeApproval: employeeAdvance.data.status,
    employeeAdvanceApprovalPassed,
    employeeAdvanceRejectionPassed,
    payrollPassed,
    payrollGross: payrollRun.data.totalGross,
    payrollAdvanceRecovery: payrollLine.advanceRecovery,
    payrollNetPaid: payrollRun.data.totalNet,
    payrollAdvanceRemaining: Number(payrollRow.advance_balance),
    payrollPayableRemaining: Number(payrollRow.payable_balance),
    expenseApprovalPassed,
    offlineExpenseRetryExactlyOnce: offlineRetryExactlyOnce,
    expenseStatus: expenseRow.status,
    expensePaidFromCash: Number(expenseRow.credit),
    loadingPhotosPassed,
    productionToStockPassed,
    productionStatus: productionRow.status,
    productionLoadedQuantity: Number(productionRow.loaded_quantity),
    productionOutputQuantity: production.data.outputQuantity,
    productionStockQuantity: Number(productionRow.production_stock),
    productionInventoryCost: Number(productionRow.production_inventory_cost),
    productionLayerValue: Number(productionRow.production_layer_value),
    productionGlInventoryDelta: Number(productionRow.gl_inventory_delta),
    productionWipBalance: Number(productionRow.wip_balance),
    productionLossQuantity: Number(productionRow.loss_quantity),
    productionBalancedJournal: productionRow.balanced,
    purchaseToPaymentPassed,
    purchaseOrderStatus: purchaseRow.order_status,
    purchaseReceived: Number(purchaseRow.received),
    supplierBillTotal: supplierBill.data.total,
    supplierPaid: Number(purchaseRow.paid),
    supplierOutstanding: Number(purchaseRow.outstanding),
    supplierLedgerBalance: Number(supplierLedger.balance),
    loadingPhotoAfterDispatchStatus: photoAfterDispatch.status,
    customerReceiptAndLedgerPassed: receiptAndCommissionPassed,
    brokerSettlementPassed,
    managerBranchBDetailStatuses: managerBranchBDetails.map(() => 404),
    managerBranchBProductionAuditEvents: managerBranchAudit.events?.length ?? 0,
    masterCreates: [customer.status, product.status, vehicle.status, driver.status],
    openingStock: opening.status,
    order: order.status,
    invoice: invoice.status,
    loadingVerified: verified.data.status,
    earlyDeliveryGuard: tooEarly.status,
    finalLoadingStatus: row.loading_status,
    remainingGoodStock: Number(row.stock_quantity),
    postedInvoice: row.invoice_status,
    invoiceTotal: Number(row.invoice_total),
    blankCustomerCreditLimitStayedNull: row.customer_credit_limit_is_null,
    blankVehicleCapacityStayedNull: row.vehicle_capacity_is_null,
    branchRecordsStoredInBranchB: row.sales_order_in_branch_b && row.loading_in_branch_b
      && row.purchase_order_in_branch_b && row.production_batch_in_branch_b,
    balancedInvoiceJournal: Number(row.journal_debits) === Number(row.journal_credits) && Number(row.journal_debits) === Number(row.invoice_total),
    loadingAndDeliveryAuditEvents: Number(row.audit_events),
    branchBDetailStatuses: branchBDetails.map(() => 200),
    branchADetailStatusesForBranchBRecords: crossBranchStatuses.map(() => 404),
    branchBProductionAuditEvents: branchBAudit.events.length,
    branchAProductionAuditEventsForBranchBRecord: branchAAudit.events?.length ?? 0,
  };
  console.log(JSON.stringify(result));
  if (row.loading_status !== "delivered" || Number(row.stock_quantity) !== 39 || row.invoice_status !== "posted"
      || Number(row.journal_debits) !== Number(row.journal_credits) || Number(row.journal_debits) !== Number(row.invoice_total)
      || !row.customer_credit_limit_is_null || !row.vehicle_capacity_is_null
      || !row.sales_order_in_branch_b || !row.loading_in_branch_b || !row.purchase_order_in_branch_b || !row.production_batch_in_branch_b
      || Number(row.audit_events) < 4 || branchBDetails.length !== 5 || crossBranchStatuses.length !== 5
      || !branchBAudit.events.length || branchAAudit.events?.length || !reportReconciliationPassed
      || managerBranchBDetails.length !== 5 || managerBranchAudit.events?.length
      || !loadingPhotosPassed || !productionToStockPassed || !purchaseToPaymentPassed || !payrollPassed || !expenseApprovalPassed || !offlineRetryExactlyOnce || photoAfterDispatch.status !== 409 || !receiptAndCommissionPassed || !brokerSettlementPassed) process.exitCode = 1;
  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error("Sales/loading/delivery verification failed:", error instanceof Error ? error.message : "unknown error");
  await pool.end();
  process.exitCode = 1;
});
