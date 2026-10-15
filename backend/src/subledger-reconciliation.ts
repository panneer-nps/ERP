import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "./auth";
import { pool } from "./db";

const asOfSchema = z.object({ asOf: z.string().date().optional() });

const controlAccounts = [
  { code: "1100", kind: "customer", label: "Customer receivables", table: "business_partners", idColumn: "customer_id", nameColumn: "name", typeFilter: "partner_type='customer'", sign: 1 },
  { code: "2100", kind: "supplier", label: "Supplier payables", table: "business_partners", idColumn: "supplier_id", nameColumn: "name", typeFilter: "partner_type='supplier'", sign: -1 },
  { code: "2150", kind: "broker", label: "Broker payables", table: "business_partners", idColumn: "broker_id", nameColumn: "name", typeFilter: "partner_type='broker'", sign: -1 },
  { code: "1400", kind: "employee", label: "Employee advances", table: "employees", idColumn: "employee_id", nameColumn: "full_name", typeFilter: "TRUE", sign: 1 },
] as const;

export const subledgerReconciliationRouter = Router();
subledgerReconciliationRouter.use(requireAuth);

subledgerReconciliationRouter.get("/subledger-reconciliation", requirePermission("accounting.view"), async (req, res, next) => {
  const parsed = asOfSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: { code: "INVALID_AS_OF_DATE", message: "Choose a valid as-of date." } });
  try {
    const dateRow = await pool.query<{ as_of: string }>(
      "SELECT COALESCE($2::date, timezone(c.timezone,now())::date)::text AS as_of FROM companies c WHERE c.id=$1",
      [req.auth!.companyId, parsed.data.asOf ?? null],
    );
    if (!dateRow.rowCount) return res.status(404).json({ error: { code: "COMPANY_NOT_FOUND", message: "Company was not found." } });
    const asOf = dateRow.rows[0].as_of;
    const accounts = await Promise.all(controlAccounts.map(async account => {
      const [control, partnerBalances, unallocated] = await Promise.all([
        pool.query<{ balance: string }>(`
          SELECT COALESCE(SUM(jl.debit-jl.credit),0)::numeric(14,2)::text AS balance
          FROM journal_entry_lines jl
          JOIN journal_entries je ON je.company_id=jl.company_id AND je.id=jl.journal_entry_id
          JOIN accounts a ON a.company_id=jl.company_id AND a.id=jl.account_id
          WHERE jl.company_id=$1 AND a.code=$2 AND je.effective_date<=$3::date
            AND ($4::uuid IS NULL OR je.branch_id IS NULL OR je.branch_id=$4)
        `, [req.auth!.companyId, account.code, asOf, req.auth!.branchId]),
        pool.query<{ id: string; name: string; balance: string }>(`
          SELECT p.id,p.${account.nameColumn} AS name,
            (COALESCE(SUM(jl.debit-jl.credit),0)*$5)::numeric(14,2)::text AS balance
          FROM ${account.table} p
          JOIN journal_entry_lines jl ON jl.company_id=p.company_id AND jl.${account.idColumn}=p.id
          JOIN journal_entries je ON je.company_id=jl.company_id AND je.id=jl.journal_entry_id
          JOIN accounts a ON a.company_id=jl.company_id AND a.id=jl.account_id AND a.code=$2
          WHERE p.company_id=$1 AND ${account.typeFilter} AND je.effective_date<=$3::date
            AND ($4::uuid IS NULL OR je.branch_id IS NULL OR je.branch_id=$4)
          GROUP BY p.id,p.${account.nameColumn}
          ORDER BY lower(p.${account.nameColumn}),p.id
        `, [req.auth!.companyId, account.code, asOf, req.auth!.branchId, account.sign]),
        pool.query<{ id: string; entryNumber: string; date: string; description: string; detail: string; amount: string; totalCount: string }>(`
          SELECT je.id,je.entry_number AS "entryNumber",je.effective_date::text AS date,je.description,
            jl.description AS detail,(jl.debit-jl.credit)*$5 AS amount,count(*) OVER()::text AS "totalCount"
          FROM journal_entry_lines jl
          JOIN journal_entries je ON je.company_id=jl.company_id AND je.id=jl.journal_entry_id
          JOIN accounts a ON a.company_id=jl.company_id AND a.id=jl.account_id AND a.code=$2
          WHERE jl.company_id=$1 AND jl.${account.idColumn} IS NULL AND je.effective_date<=$3::date
            AND ($4::uuid IS NULL OR je.branch_id IS NULL OR je.branch_id=$4)
          ORDER BY je.effective_date DESC,je.entry_number DESC,jl.line_number DESC
          LIMIT 500
        `, [req.auth!.companyId, account.code, asOf, req.auth!.branchId, account.sign]),
      ]);
      const controlBalance = Number(control.rows[0]?.balance ?? 0) * account.sign;
      const partners = partnerBalances.rows.map(row => ({ id: row.id, name: row.name, balance: Number(row.balance) }));
      const subledgerBalance = partners.reduce((sum, row) => sum + row.balance, 0);
      const difference = Math.round((controlBalance - subledgerBalance + Number.EPSILON) * 100) / 100;
      return {
        code: account.code,
        kind: account.kind,
        label: account.label,
        controlBalance,
        subledgerBalance: Math.round((subledgerBalance + Number.EPSILON) * 100) / 100,
        difference,
        balanced: Math.abs(difference) < 0.01,
        partners,
        unallocatedLineCount: Number(unallocated.rows[0]?.totalCount ?? 0),
        unallocatedLines: unallocated.rows.map(row => ({ id: row.id, entryNumber: row.entryNumber, date: row.date, description: row.description, detail: row.detail, amount: Number(row.amount) })),
      };
    }));
    return res.json({ asOf, branchId: req.auth!.branchId, accounts });
  } catch (error) {
    return next(error);
  }
});
