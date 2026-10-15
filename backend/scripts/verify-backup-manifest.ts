import assert from "node:assert/strict";
import { allPublicTableCounts, matchesManifestCounts, parseManifest } from "./backup-database";

async function main() {
  const sourceCounts: Record<string, number> = {
    companies: 1,
    journal_entries: 14,
    "odd\"; DROP TABLE companies;--": 3,
    schema_migrations: 99,
    users: 2,
  };
  const statements: string[] = [];
  const fakeQuery = async (sql: string) => {
    statements.push(sql);
    if (sql.startsWith("SELECT table_name FROM information_schema.tables")) {
      return { rows: Object.keys(sourceCounts).sort().map((table_name) => ({ table_name })) };
    }
    const match = sql.match(/^SELECT count\(\*\)::text AS count FROM public\."((?:[^"]|"")*)"$/);
    assert.ok(match, `table count query must quote exactly one identifier: ${sql}`);
    const tableName = match[1].replaceAll('""', '"');
    assert.ok(Object.hasOwn(sourceCounts, tableName), `unexpected table queried: ${tableName}`);
    return { rows: [{ count: String(sourceCounts[tableName]) }] };
  };
  const collected = await allPublicTableCounts(fakeQuery);
  assert.deepEqual(collected, Object.fromEntries(Object.entries(sourceCounts).sort(([a], [b]) => a.localeCompare(b))));
  assert.equal(statements.filter((sql) => sql.startsWith("SELECT count(")).length, Object.keys(sourceCounts).length);

  const currentManifest = parseManifest({
    tableCounts: collected,
    operationalTableCounts: { journal_entry_lines: 25 },
    latestMigration: "099_cash_opening_balances.sql",
    createdAt: "2026-10-12T00:00:00.000Z",
  });
  assert.deepEqual(currentManifest.tableCounts, collected);
  assert.equal(matchesManifestCounts(collected, currentManifest.tableCounts), true);
  assert.equal(matchesManifestCounts({ ...collected, "new_module_records": 0 }, collected), false, "unexpected or missing tables must fail full-manifest comparison");
  assert.equal(matchesManifestCounts({ ...collected, users: 1 }, collected), false, "a changed table row count must fail comparison");

  const legacyCounts = {
    companies: 1,
    branches: 2,
    users: 2,
    audit_logs: 44,
    schema_migrations: 88,
    expenses: 3,
    journal_entries: 14,
  };
  assert.equal(matchesManifestCounts({ ...collected, ...legacyCounts }, legacyCounts), true, "legacy seven-table archives remain verifiable");
  assert.equal(matchesManifestCounts({ ...collected, ...legacyCounts, users: 1 }, legacyCounts), false, "legacy mismatched rows must fail");

  assert.throws(() => parseManifest({ tableCounts: { companies: -1 }, latestMigration: null, createdAt: "now" }), /unsupported shape/);
  assert.throws(() => parseManifest({ tableCounts: [], latestMigration: null, createdAt: "now" }), /unsupported shape/);
  assert.throws(() => parseManifest({ tableCounts: { companies: 1.5 }, latestMigration: null, createdAt: "now" }), /unsupported shape/);
  console.log(JSON.stringify({
    status: "passed",
    checks: [
      "all public table names are counted",
      "quoted identifiers cannot escape the table count query",
      "new manifests require an exact table set and row counts",
      "legacy seven-table manifests remain compatible",
      "invalid and malformed manifests are rejected",
    ],
  }));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Backup manifest verification failed.");
  process.exitCode = 1;
});
