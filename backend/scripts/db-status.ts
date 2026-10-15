import "dotenv/config";
import { pool } from "../src/db";
import { readDatabaseSchemaStatus } from "../src/schema-status";

async function main() {
  try {
    const schema = await readDatabaseSchemaStatus(pool);
    const status = schema.changed.length > 0
      ? "changed_applied_migration"
      : !schema.migrationTableExists || schema.pending.length > 0
        ? "pending_migrations"
        : schema.databaseOnlyMigrations.length > 0
          ? "database_has_unknown_migrations"
          : "up_to_date";
    console.log(JSON.stringify({ databaseReachable: true, status, ...schema }, null, 2));
  } catch {
    console.error("Database migration status could not be read; credentials and connection details are omitted.");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
