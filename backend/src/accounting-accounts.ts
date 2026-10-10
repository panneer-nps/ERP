import { Response, Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { requireAuth, requirePermission } from "./auth";
import { pool } from "./db";

export const accountingAccountsRouter = Router();

const accountType = z.enum(["asset", "liability", "equity", "income", "expense"]);
const groupCreate = z.object({
  code: z.string().trim().toUpperCase().min(2).max(20).regex(/^[A-Z0-9_-]+$/),
  name: z.string().trim().min(2).max(100),
  accountType,
  parentGroupId: z.string().uuid().nullable().optional(),
});
const groupUpdate = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  active: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0);
const accountCreate = z.object({
  code: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().trim().min(2).max(120),
  accountType,
  groupId: z.string().uuid().optional(),
});
const accountUpdate = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  groupId: z.string().uuid().optional(),
  active: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0);
const idSchema = z.string().uuid();

function invalid(message: string, errorCode: string, httpStatus = 400) {
  return Object.assign(new Error(message), { errorCode, httpStatus });
}

function sendFailure(res: Response, error: unknown) {
  const status = (error as { httpStatus?: number }).httpStatus;
  if (status) {
    return res.status(status).json({
      error: {
        code: (error as { errorCode?: string }).errorCode ?? "ACCOUNTING_CONFIGURATION_INVALID",
        message: (error as Error).message,
      },
    });
  }
  if ((error as { code?: string }).code === "23505") {
    return res.status(409).json({ error: { code: "ACCOUNT_CODE_EXISTS", message: "A code with this value already exists." } });
  }
  return res.status(500).json({ error: { code: "ACCOUNTING_CONFIGURATION_ERROR", message: "The accounting configuration could not be saved." } });
}

async function audit(
  client: PoolClient,
  companyId: string,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
) {
  await client.query(
    "INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)",
    [companyId, actorId, action, entityType, entityId, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after)],
  );
}

accountingAccountsRouter.get("/account-groups", requireAuth, requirePermission("accounting.accounts.view"), async (req, res, next) => {
  try {
    const [groups, permission] = await Promise.all([
      pool.query(`SELECT g.id,g.code,g.name,g.account_type AS "accountType",g.parent_group_id AS "parentGroupId",p.name AS "parentName",g.system_managed AS "systemManaged",g.active,COUNT(a.id) FILTER(WHERE a.active)::int AS "activeAccounts"
        FROM account_groups g LEFT JOIN account_groups p ON p.company_id=g.company_id AND p.id=g.parent_group_id
        LEFT JOIN accounts a ON a.company_id=g.company_id AND a.group_id=g.id
        WHERE g.company_id=$1 GROUP BY g.id,p.name ORDER BY g.account_type,g.parent_group_id NULLS FIRST,g.code`, [req.auth!.companyId]),
      pool.query(`SELECT EXISTS(SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.company_id=$1 AND ur.user_id=$2 AND p.code='accounting.accounts.configure') AS allowed`, [req.auth!.companyId, req.auth!.userId]),
    ]);
    return res.json({ groups: groups.rows, canConfigure: permission.rows[0].allowed });
  } catch (error) {
    return next(error);
  }
});

accountingAccountsRouter.post("/account-groups", requireAuth, requirePermission("accounting.accounts.configure"), async (req, res, next) => {
  const parsed = groupCreate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Enter a group code, name and account type." } });
  const input = parsed.data;
  const companyId = req.auth!.companyId;
  const actorId = req.auth!.userId;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (input.parentGroupId) {
      const parent = await client.query<{ account_type: string; active: boolean }>(
        "SELECT account_type,active FROM account_groups WHERE company_id=$1 AND id=$2 FOR UPDATE",
        [companyId, input.parentGroupId],
      );
      if (!parent.rowCount || !parent.rows[0].active || parent.rows[0].account_type !== input.accountType) {
        throw invalid("Choose an active parent group with the same account type.", "INVALID_ACCOUNT_GROUP_PARENT");
      }
    }
    const saved = await client.query<{ id: string }>(
      "INSERT INTO account_groups(company_id,code,name,account_type,parent_group_id) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [companyId, input.code, input.name, input.accountType, input.parentGroupId ?? null],
    );
    const after = { id: saved.rows[0].id, ...input, active: true, systemManaged: false };
    await client.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'accounting.account_group.create','account_group',$3,$4::jsonb)", [companyId, actorId, after.id, JSON.stringify(after)]);
    await client.query("COMMIT");
    return res.status(201).json({ group: after });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((error as { code?: string }).code === "23505") return res.status(409).json({ error: { code: "ACCOUNT_GROUP_EXISTS", message: "A group with this code already exists." } });
    if ((error as { httpStatus?: number }).httpStatus) return sendFailure(res, error);
    return next(error);
  } finally {
    client.release();
  }
});

accountingAccountsRouter.patch("/account-groups/:id", requireAuth, requirePermission("accounting.accounts.configure"), async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  const parsed = groupUpdate.safeParse(req.body);
  if (!id.success) return res.status(404).json({ error: { code: "ACCOUNT_GROUP_NOT_FOUND", message: "Account group was not found." } });
  if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Enter a valid group name or status." } });
  const companyId = req.auth!.companyId;
  const actorId = req.auth!.userId;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{ id: string; name: string; active: boolean; system_managed: boolean }>(
      "SELECT id,name,active,system_managed FROM account_groups WHERE company_id=$1 AND id=$2 FOR UPDATE", [companyId, id.data],
    );
    if (!current.rowCount) throw invalid("Account group was not found.", "ACCOUNT_GROUP_NOT_FOUND", 404);
    if (current.rows[0].system_managed) throw invalid("Standard account groups cannot be renamed or deactivated.", "SYSTEM_ACCOUNT_GROUP", 409);
    if (parsed.data.active === false) {
      const used = await client.query<{ used: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM accounts WHERE company_id=$1 AND group_id=$2 AND active=true) OR EXISTS(SELECT 1 FROM account_groups WHERE company_id=$1 AND parent_group_id=$2 AND active=true) AS used",
        [companyId, id.data],
      );
      if (used.rows[0].used) throw invalid("Move active accounts and subgroups before deactivating this group.", "ACCOUNT_GROUP_IN_USE", 409);
    }
    const saved = await client.query(
      "UPDATE account_groups SET name=$3,active=$4 WHERE company_id=$1 AND id=$2 RETURNING id,code,name,account_type AS \"accountType\",parent_group_id AS \"parentGroupId\",active",
      [companyId, id.data, parsed.data.name ?? current.rows[0].name, parsed.data.active ?? current.rows[0].active],
    );
    await audit(client, companyId, actorId, "accounting.account_group.update", "account_group", id.data, current.rows[0], saved.rows[0]);
    await client.query("COMMIT");
    return res.json({ group: saved.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((error as { httpStatus?: number }).httpStatus) return sendFailure(res, error);
    return next(error);
  } finally {
    client.release();
  }
});

accountingAccountsRouter.get("/accounts", requireAuth, requirePermission("accounting.accounts.view"), async (req, res, next) => {
  try {
    const [accounts, permission] = await Promise.all([
      pool.query(`SELECT a.id,a.code,a.name,a.account_type AS "accountType",a.group_id AS "groupId",g.code AS "groupCode",g.name AS "groupName",a.system_managed AS "systemManaged",a.active,EXISTS(SELECT 1 FROM journal_entry_lines jl WHERE jl.company_id=a.company_id AND jl.account_id=a.id) AS "hasTransactions"
        FROM accounts a LEFT JOIN account_groups g ON g.company_id=a.company_id AND g.id=a.group_id WHERE a.company_id=$1 ORDER BY a.code`, [req.auth!.companyId]),
      pool.query(`SELECT EXISTS(SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.company_id=$1 AND ur.user_id=$2 AND p.code='accounting.accounts.configure') AS allowed`, [req.auth!.companyId, req.auth!.userId]),
    ]);
    return res.json({ accounts: accounts.rows, canConfigure: permission.rows[0].allowed });
  } catch (error) {
    return next(error);
  }
});

accountingAccountsRouter.post("/accounts", requireAuth, requirePermission("accounting.accounts.configure"), async (req, res, next) => {
  const parsed = accountCreate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Enter an account code, name and type." } });
  const input = parsed.data;
  const companyId = req.auth!.companyId;
  const actorId = req.auth!.userId;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let groupId = input.groupId;
    if (groupId) {
      const group = await client.query<{ account_type: string; active: boolean }>(
        "SELECT account_type,active FROM account_groups WHERE company_id=$1 AND id=$2 FOR SHARE", [companyId, groupId],
      );
      if (!group.rowCount || !group.rows[0].active || group.rows[0].account_type !== input.accountType) {
        throw invalid("Choose an active account group with the same account type.", "INVALID_ACCOUNT_GROUP");
      }
    } else {
      const group = await client.query<{ id: string }>(
        "SELECT id FROM account_groups WHERE company_id=$1 AND account_type=$2 AND system_managed=true AND active=true AND parent_group_id IS NULL",
        [companyId, input.accountType],
      );
      if (!group.rowCount) throw invalid("The standard group for this account type is missing.", "DEFAULT_ACCOUNT_GROUP_MISSING", 409);
      groupId = group.rows[0].id;
    }
    const saved = await client.query<{ id: string }>(
      "INSERT INTO accounts(company_id,code,name,account_type,group_id) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [companyId, input.code, input.name, input.accountType, groupId],
    );
    const after = { id: saved.rows[0].id, ...input, groupId, systemManaged: false, active: true, hasTransactions: false };
    await client.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'accounting.account.create','account',$3,$4::jsonb)", [companyId, actorId, after.id, JSON.stringify(after)]);
    await client.query("COMMIT");
    return res.status(201).json({ account: after });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((error as { code?: string }).code === "23505") return res.status(409).json({ error: { code: "ACCOUNT_CODE_EXISTS", message: "An account with this code already exists." } });
    if ((error as { httpStatus?: number }).httpStatus) return sendFailure(res, error);
    return next(error);
  } finally {
    client.release();
  }
});

accountingAccountsRouter.patch("/accounts/:id", requireAuth, requirePermission("accounting.accounts.configure"), async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  const parsed = accountUpdate.safeParse(req.body);
  if (!id.success) return res.status(404).json({ error: { code: "ACCOUNT_NOT_FOUND", message: "Account was not found." } });
  if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Enter an account name, group or status." } });
  const companyId = req.auth!.companyId;
  const actorId = req.auth!.userId;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{ id: string; code: string; name: string; account_type: string; group_id: string | null; active: boolean; system_managed: boolean }>(
      "SELECT id,code,name,account_type,group_id,active,system_managed FROM accounts WHERE company_id=$1 AND id=$2 FOR UPDATE", [companyId, id.data],
    );
    if (!current.rowCount) throw invalid("Account was not found.", "ACCOUNT_NOT_FOUND", 404);
    const before = current.rows[0];
    if (before.system_managed) throw invalid("Standard accounts used by ERP postings cannot be changed here.", "SYSTEM_ACCOUNT", 409);
    if (parsed.data.active === false && before.active) {
      const used = await client.query<{ used: boolean }>("SELECT EXISTS(SELECT 1 FROM journal_entry_lines WHERE company_id=$1 AND account_id=$2) AS used", [companyId, id.data]);
      if (used.rows[0].used) throw invalid("An account with ledger history cannot be deactivated. Keep its history available for reporting.", "ACCOUNT_HAS_HISTORY", 409);
    }
    const groupId = parsed.data.groupId ?? before.group_id;
    const group = await client.query<{ account_type: string; active: boolean }>(
      "SELECT account_type,active FROM account_groups WHERE company_id=$1 AND id=$2 FOR SHARE", [companyId, groupId],
    );
    if (!group.rowCount || !group.rows[0].active || group.rows[0].account_type !== before.account_type) {
      throw invalid("Choose an active account group with the same account type.", "INVALID_ACCOUNT_GROUP");
    }
    const saved = await client.query(
      "UPDATE accounts SET name=$3,group_id=$4,active=$5 WHERE company_id=$1 AND id=$2 RETURNING id,code,name,account_type AS \"accountType\",group_id AS \"groupId\",active",
      [companyId, id.data, parsed.data.name ?? before.name, groupId, parsed.data.active ?? before.active],
    );
    await audit(client, companyId, actorId, "accounting.account.update", "account", id.data, before, saved.rows[0]);
    await client.query("COMMIT");
    return res.json({ account: saved.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((error as { httpStatus?: number }).httpStatus) return sendFailure(res, error);
    return next(error);
  } finally {
    client.release();
  }
});
