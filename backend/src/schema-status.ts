import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";

export type DatabaseSchemaStatus = {
  migrationTableExists: boolean;
  appliedCount: number;
  migrationsOnDisk: number;
  latestApplied: string | null;
  pending: string[];
  changed: string[];
  databaseOnlyMigrations: string[];
};

type LocalMigration = { filename: string; checksum: string };

async function localMigrations() {
  const migrationDirectory = join(__dirname, "..", "migrations");
  const filenames = (await readdir(migrationDirectory))
    .filter((filename) => /^\d+.*\.sql$/.test(filename))
    .sort((a, b) => a.localeCompare(b));
  return Promise.all(filenames.map(async (filename) => ({
    filename,
    checksum: createHash("sha256").update(await readFile(join(migrationDirectory, filename))).digest("hex"),
  })));
}

function sqlState(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
}

export async function readDatabaseSchemaStatus(pool: Pool): Promise<DatabaseSchemaStatus> {
  const files = await localMigrations();
  let applied: { filename: string; checksum: string }[];
  try {
    const result = await pool.query<{ filename: string; checksum: string }>(
      "SELECT filename, checksum FROM schema_migrations ORDER BY filename",
    );
    applied = result.rows;
  } catch (error) {
    if (sqlState(error) !== "42P01") throw error;
    return {
      migrationTableExists: false,
      appliedCount: 0,
      migrationsOnDisk: files.length,
      latestApplied: null,
      pending: files.map((file) => file.filename),
      changed: [],
      databaseOnlyMigrations: [],
    };
  }

  const appliedByName = new Map(applied.map((row) => [row.filename, row.checksum]));
  const localNames = new Set(files.map((file) => file.filename));
  const pending: string[] = [];
  const changed: string[] = [];
  for (const file of files) {
    const checksum = appliedByName.get(file.filename);
    if (checksum === undefined) pending.push(file.filename);
    else if (checksum !== file.checksum) changed.push(file.filename);
  }

  return {
    migrationTableExists: true,
    appliedCount: applied.length,
    migrationsOnDisk: files.length,
    latestApplied: applied.at(-1)?.filename ?? null,
    pending,
    changed,
    databaseOnlyMigrations: applied.map((row) => row.filename).filter((filename) => !localNames.has(filename)),
  };
}
