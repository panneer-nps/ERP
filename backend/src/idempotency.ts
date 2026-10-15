import { createHash, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import type { PoolClient } from "pg";

const scrypt = promisify(scryptCallback);

async function protectPasswordFields(value: unknown): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map(protectPasswordFields));
  if (!value || typeof value !== "object") return value;
  const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => {
    if (/password|passwd|passphrase/i.test(key) && typeof item === "string") {
      const fingerprint = await scrypt(item, "brick-erp-idempotency-password-v1", 32) as Buffer;
      return [key, `scrypt:${fingerprint.toString("hex")}`] as const;
    }
    return [key, await protectPasswordFields(item)] as const;
  }));
  return Object.fromEntries(entries);
}

/** Hash request bodies without leaving a fast, offline password verifier in the idempotency ledger. */
export async function hashIdempotencyRequest(operation: string, body: unknown): Promise<string> {
  const protectedBody = await protectPasswordFields(body);
  return createHash("sha256").update(JSON.stringify({ operation, body: protectedBody })).digest("hex");
}

export type IdempotencyResult =
  | { replay: false }
  | { replay: true; status: number; body: unknown };

export async function claimIdempotencyKey(
  client: PoolClient,
  args: { companyId: string; userId: string; operation: string; requestKey: string | undefined; body: unknown },
): Promise<IdempotencyResult> {
  const key = args.requestKey?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(key)) {
    throw Object.assign(new Error("Send a valid Idempotency-Key to safely retry this transaction."), {
      httpStatus: 400,
      errorCode: "IDEMPOTENCY_KEY_REQUIRED",
    });
  }
  const requestHash = await hashIdempotencyRequest(args.operation, args.body);
  const inserted = await client.query(
    `INSERT INTO transaction_idempotency_keys(company_id,user_id,operation,request_key,request_hash)
     VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING request_key`,
    [args.companyId, args.userId, args.operation, key, requestHash],
  );
  if (inserted.rowCount) return { replay: false };

  const existing = await client.query<{ request_hash: string; response_status: number | null; response_body: unknown }>(
    `SELECT request_hash,response_status,response_body FROM transaction_idempotency_keys
     WHERE company_id=$1 AND user_id=$2 AND operation=$3 AND request_key=$4 FOR UPDATE`,
    [args.companyId, args.userId, args.operation, key],
  );
  if (!existing.rowCount) {
    throw Object.assign(new Error("The transaction retry could not be resolved. Retry with the same key."), {
      httpStatus: 409,
      errorCode: "IDEMPOTENCY_RETRY_CONFLICT",
    });
  }
  const row = existing.rows[0];
  if (row.request_hash !== requestHash) {
    throw Object.assign(new Error("This Idempotency-Key was already used with different transaction details."), {
      httpStatus: 409,
      errorCode: "IDEMPOTENCY_KEY_REUSED",
    });
  }
  if (row.response_status === null || row.response_body === null) {
    throw Object.assign(new Error("The original transaction is still being resolved. Retry with the same key."), {
      httpStatus: 409,
      errorCode: "IDEMPOTENCY_REQUEST_IN_PROGRESS",
    });
  }
  return { replay: true, status: row.response_status, body: row.response_body };
}

export async function completeIdempotencyKey(
  client: PoolClient,
  args: { companyId: string; userId: string; operation: string; requestKey: string; status: number; body: unknown },
): Promise<void> {
  await client.query(
    `UPDATE transaction_idempotency_keys SET response_status=$5,response_body=$6::jsonb,completed_at=now()
     WHERE company_id=$1 AND user_id=$2 AND operation=$3 AND request_key=$4`,
    [args.companyId, args.userId, args.operation, args.requestKey, args.status, JSON.stringify(args.body)],
  );
}
