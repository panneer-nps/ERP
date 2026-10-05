import "dotenv/config";
import { pool } from "./db";
import { createPasswordHash } from "./auth";

async function main() {
  const email = process.env.BOOTSTRAP_OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_OWNER_PASSWORD;
  const companyName = process.env.BOOTSTRAP_COMPANY_NAME?.trim();
  if (!email || !password || !companyName) {
    throw new Error("Set BOOTSTRAP_OWNER_EMAIL, BOOTSTRAP_OWNER_PASSWORD, and BOOTSTRAP_COMPANY_NAME.");
  }
  if (password.length < 12) throw new Error("BOOTSTRAP_OWNER_PASSWORD must contain at least 12 characters.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT 1 FROM companies LIMIT 1");
    if (existing.rowCount) throw new Error("A company already exists. Owner bootstrap is one-time only.");

    const company = await client.query<{ id: string }>("INSERT INTO companies (name) VALUES ($1) RETURNING id", [companyName]);
    const companyId = company.rows[0].id;
    const passwordHash = await createPasswordHash(password);
    const user = await client.query<{ id: string }>(
      "INSERT INTO users (company_id, email, full_name, password_hash) VALUES ($1, $2, 'Owner', $3) RETURNING id",
      [companyId, email, passwordHash],
    );
    const role = await client.query<{ id: string }>(
      "INSERT INTO roles (company_id, code, name, system_role) VALUES ($1, 'owner', 'Owner', true) RETURNING id",
      [companyId],
    );
    await client.query("INSERT INTO user_roles (company_id, user_id, role_id) VALUES ($1, $2, $3)", [companyId, user.rows[0].id, role.rows[0].id]);
    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions`,
      [role.rows[0].id],
    );
    await client.query(
      `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'bootstrap.create', 'company', ($1::uuid)::text, jsonb_build_object('name', $3::text))`,
      [companyId, user.rows[0].id, companyName],
    );
    await client.query("COMMIT");
    console.log(`Initial owner created for ${companyName}. Remove bootstrap environment values after setup.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Owner bootstrap failed.");
  process.exitCode = 1;
});
