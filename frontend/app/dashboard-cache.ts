export type DashboardCacheScope = { from: string; to: string; branchId: string | null };

export function dashboardSummaryCacheKey(fingerprint: string, scope: DashboardCacheScope) {
  return `brick-erp-offline-summary:${fingerprint}:${scope.branchId ?? "all"}:${scope.from}:${scope.to}`;
}

export function dashboardSummaryMatchesScope(
  summary: { from?: unknown; to?: unknown; branchId?: unknown } | null | undefined,
  scope: DashboardCacheScope,
) {
  return Boolean(summary)
    && summary!.from === scope.from
    && summary!.to === scope.to
    && summary!.branchId === scope.branchId;
}

export function readDashboardBranchScope(
  value: { fingerprint?: unknown; branchId?: unknown; savedAt?: unknown } | null,
  fingerprint: string,
  now: number,
  maxAge: number,
): { branchId: string | null; savedAt: string } | null {
  if (!value || value.fingerprint !== fingerprint || typeof value.savedAt !== "string") return null;
  if (!(value.branchId === null || typeof value.branchId === "string")) return null;
  const age = now - Date.parse(value.savedAt);
  if (!Number.isFinite(age) || age < 0 || age > maxAge) return null;
  return { branchId: value.branchId, savedAt: value.savedAt };
}
