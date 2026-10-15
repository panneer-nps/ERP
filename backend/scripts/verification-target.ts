const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Fail closed before a verifier can create fixtures in an unexpected database. */
export function assertDisposableVerificationTarget(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Set DATABASE_URL to the disposable verification database.");

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL for the disposable verification database.");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the PostgreSQL protocol.");
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  const expectedDatabase = process.env.ERP_VERIFY_EXPECTED_DATABASE;
  if (!expectedDatabase || expectedDatabase !== databaseName) {
    throw new Error("Set ERP_VERIFY_EXPECTED_DATABASE to exactly match the disposable database name in DATABASE_URL.");
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error("Database verifiers only run against a PostgreSQL server on this computer.");
  }
  if (process.env.ERP_VERIFY_ALLOW_MUTATION !== "1") {
    throw new Error("Database verifier stopped before connecting. Set ERP_VERIFY_ALLOW_MUTATION=1 only for a disposable test database.");
  }
}

/** Keep integration scripts from sending mutations to a remote/shared API. */
export function assertLocalVerificationApi(apiUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(apiUrl);
  } catch {
    throw new Error("ERP_VERIFY_API_URL must be a valid local API URL.");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error("Integration verifiers only send requests to an API running on this computer.");
  }
}
