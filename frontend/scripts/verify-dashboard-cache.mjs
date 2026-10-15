import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, "../app/dashboard-cache.ts");
const testDir = await mkdtemp(path.join(tmpdir(), "brick-erp-dashboard-cache-"));
try {
  const source = await readFile(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    fileName: sourcePath,
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  assert.equal(compiled.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error), false, "cache helper failed TypeScript transpilation");
  const modulePath = path.join(testDir, "dashboard-cache.mjs");
  await writeFile(modulePath, compiled.outputText);
  const { dashboardSummaryCacheKey, dashboardSummaryMatchesScope, readDashboardBranchScope } = await import(pathToFileURL(modulePath));
  const base = { from: "2026-10-01", to: "2026-10-12" };
  const branchA = { ...base, branchId: "branch-a" };
  const branchB = { ...base, branchId: "branch-b" };
  const company = { ...base, branchId: null };
  const keyA = dashboardSummaryCacheKey("session-fingerprint", branchA);
  assert.notEqual(keyA, dashboardSummaryCacheKey("session-fingerprint", branchB), "branch A and B share a cache key");
  assert.notEqual(keyA, dashboardSummaryCacheKey("session-fingerprint", company), "branch and company-wide scopes share a cache key");
  const summaryA = { ...branchA, sales: "100" };
  assert.equal(dashboardSummaryMatchesScope(summaryA, branchA), true, "matching branch summary was rejected");
  assert.equal(dashboardSummaryMatchesScope(summaryA, branchB), false, "branch A summary passed branch B scope");
  assert.equal(dashboardSummaryMatchesScope(summaryA, company), false, "branch summary passed company-wide scope");
  assert.equal(dashboardSummaryMatchesScope({ ...summaryA, branchId: undefined }, branchA), false, "legacy summary without branch identity was accepted");
  assert.equal(dashboardSummaryMatchesScope({ ...summaryA, from: "2026-09-01" }, branchA), false, "summary with another date range was accepted");
  const now = Date.parse("2026-10-12T12:00:00Z");
  const fresh = { fingerprint: "session-fingerprint", branchId: "branch-a", savedAt: new Date(now - 1000).toISOString() };
  assert.deepEqual(readDashboardBranchScope(fresh, "session-fingerprint", now, 60_000), { branchId: "branch-a", savedAt: fresh.savedAt });
  assert.equal(readDashboardBranchScope(fresh, "other-session", now, 60_000), null, "scope leaked across sessions");
  assert.equal(readDashboardBranchScope({ ...fresh, branchId: "branch-b" }, "session-fingerprint", now, 500), null, "expired scope was accepted");
  assert.equal(readDashboardBranchScope({ ...fresh, branchId: undefined }, "session-fingerprint", now, 60_000), null, "missing branch identity was accepted");
  console.log("Dashboard cache verifier passed: branch/company key isolation, date and scope matching, legacy rejection, session binding, and expiration.");
} finally {
  await rm(testDir, { recursive: true, force: true });
}
