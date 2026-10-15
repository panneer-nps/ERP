import type { PoolClient } from "pg";

type ApprovalLimitError = Error & { httpStatus: number; errorCode: string };

function failure(code: string, message: string): ApprovalLimitError {
  return Object.assign(new Error(message), { httpStatus: 403, errorCode: code });
}

/**
 * Enforce the highest configured ceiling among the acting user's roles that
 * grant this exact action. Owner approvals remain unrestricted. Missing caps
 * fail closed so newly granted approval permissions cannot silently become
 * unlimited.
 */
export async function enforceApprovalLimit(
  client: PoolClient,
  input: { companyId: string; userId: string; permissionCode: string; amount: number },
): Promise<void> {
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    throw failure("APPROVAL_AMOUNT_INVALID", "This action has no valid amount to check against its approval limit.");
  }

  const result = await client.query<{ is_owner: boolean; max_amount: string | null }>(
    `SELECT
       EXISTS (
         SELECT 1 FROM user_roles ur
         JOIN roles r ON r.company_id=ur.company_id AND r.id=ur.role_id
         WHERE ur.company_id=$1 AND ur.user_id=$2 AND r.code='owner'
       ) AS is_owner,
       MAX(l.max_amount)::text AS max_amount
     FROM user_roles ur
     JOIN roles r ON r.company_id=ur.company_id AND r.id=ur.role_id
     JOIN role_permissions rp ON rp.role_id=r.id
     JOIN permissions p ON p.id=rp.permission_id
     LEFT JOIN role_approval_limits l
       ON l.company_id=ur.company_id AND l.role_id=r.id AND l.permission_code=p.code
     WHERE ur.company_id=$1 AND ur.user_id=$2 AND p.code=$3`,
    [input.companyId, input.userId, input.permissionCode],
  );

  if (result.rows[0]?.is_owner) return;
  const ceiling = result.rows[0]?.max_amount;
  if (ceiling === null || ceiling === undefined) {
    throw failure(
      "APPROVAL_LIMIT_NOT_CONFIGURED",
      "An Owner must configure an amount limit for this role before it can approve or pay this item.",
    );
  }
  if (input.amount > Number(ceiling)) {
    throw failure(
      "APPROVAL_LIMIT_EXCEEDED",
      `This amount exceeds the configured role limit of ₹${Number(ceiling).toFixed(2)}. Ask the Owner to review it.`,
    );
  }
}
