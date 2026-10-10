import "dotenv/config";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, mkdir, open, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Pool, type PoolClient } from "pg";
import { getPrivateObject, privateObjectStorageEnabled, putPrivateObject } from "../src/object-storage";

const MAGIC = Buffer.from("BCERPDB1", "ascii");
const PACKAGE_MAGIC = Buffer.from("BCERPPK1", "ascii");
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = MAGIC.length + IV_LENGTH;
const BACKUP_TABLES = ["companies", "branches", "users", "audit_logs", "schema_migrations", "expenses", "journal_entries"] as const;

function encryptionKey(): Buffer {
  const encoded = process.env.BACKUP_ENCRYPTION_KEY ?? "";
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new Error("BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

function connectionParts(value: string) {
  const url = new URL(value);
  if (!url.protocol.startsWith("postgres")) throw new Error("Database URL must use PostgreSQL.");
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) throw new Error("Database URL must include a database name.");
  return {
    host: url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    sslmode: url.searchParams.get("sslmode") ?? undefined,
  };
}

function pgArgs(parts: ReturnType<typeof connectionParts>, database = parts.database): string[] {
  return [
    ...(parts.host ? ["--host", parts.host] : []),
    "--port", parts.port,
    ...(parts.user ? ["--username", parts.user] : []),
    "--dbname", database,
  ];
}

function pgEnvironment(parts: ReturnType<typeof connectionParts>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(parts.password ? { PGPASSWORD: parts.password } : {}),
    ...(parts.sslmode ? { PGSSLMODE: parts.sslmode } : {}),
  };
}

function executable(name: string, variable: string): string {
  return process.env[variable] || (process.platform === "win32" ? `${name}.exe` : name);
}

async function startDump(filePath: string, parts: ReturnType<typeof connectionParts>, snapshot?: string): Promise<void> {
  const child = spawn(executable("pg_dump", "PG_DUMP_PATH"), [
    "--format=custom", "--no-owner", "--no-privileges", ...(snapshot ? [`--snapshot=${snapshot}`] : []), ...pgArgs(parts),
  ], { env: pgEnvironment(parts), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-8000); });
  const closed = new Promise<void>((resolveClose, rejectClose) => {
    child.once("error", rejectClose);
    child.once("close", (code, signal) => code === 0
      ? resolveClose()
      : rejectClose(new Error(`pg_dump failed${signal ? ` (${signal})` : ` with exit ${code}`}: ${stderr.trim()}`)));
  });
  try {
    await Promise.all([pipeline(child.stdout, createWriteStream(filePath, { flags: "wx", mode: 0o600 })), closed]);
  } catch (error) {
    child.kill();
    throw error;
  }
}

async function encryptFile(sourcePath: string, outputPath: string, key: Buffer): Promise<void> {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  await writeFile(outputPath, Buffer.concat([MAGIC, iv]), { flag: "wx", mode: 0o600 });
  await pipeline(createReadStream(sourcePath), cipher, createWriteStream(outputPath, { flags: "a" }));
  await appendFile(outputPath, cipher.getAuthTag());
}

async function decryptFile(sourcePath: string, outputPath: string, key: Buffer): Promise<void> {
  const handle = await open(sourcePath, "r");
  try {
    const info = await handle.stat();
    if (info.size <= HEADER_LENGTH + TAG_LENGTH) throw new Error("Encrypted backup is truncated.");
    const prefix = Buffer.alloc(HEADER_LENGTH);
    await handle.read(prefix, 0, HEADER_LENGTH, 0);
    if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Backup format is not supported.");
    const iv = prefix.subarray(MAGIC.length, MAGIC.length + IV_LENGTH);
    const tag = Buffer.alloc(TAG_LENGTH);
    await handle.read(tag, 0, TAG_LENGTH, info.size - TAG_LENGTH);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    await pipeline(
      createReadStream(sourcePath, { start: HEADER_LENGTH, end: info.size - TAG_LENGTH - 1 }),
      decipher,
      createWriteStream(outputPath, { flags: "wx", mode: 0o600 }),
    );
  } catch (error) {
    await rm(outputPath, { force: true });
    if (error instanceof Error && /authenticate|bad decrypt/i.test(error.message)) {
      throw new Error("Backup authentication failed; the file or encryption key is incorrect.");
    }
    throw error;
  } finally {
    await handle.close();
  }
}

async function runPgRestore(backupPath: string, target: ReturnType<typeof connectionParts>, database: string): Promise<void> {
  const child = spawn(executable("pg_restore", "PG_RESTORE_PATH"), [
    "--exit-on-error", "--no-owner", "--no-privileges", ...pgArgs(target, database), backupPath,
  ], { env: pgEnvironment(target), windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-8000); });
  await new Promise<void>((resolveClose, rejectClose) => {
    child.once("error", rejectClose);
    child.once("close", (code, signal) => code === 0
      ? resolveClose()
      : rejectClose(new Error(`pg_restore failed${signal ? ` (${signal})` : ` with exit ${code}`}: ${stderr.trim()}`)));
  });
}

async function counts(query: (sql: string) => Promise<{ rows: Array<{ count: string }> }>) {
  const result: Record<string, number> = {};
  for (const table of BACKUP_TABLES) {
    const row = await query(`SELECT count(*)::text AS count FROM public."${table}"`);
    result[table] = Number(row.rows[0].count);
  }
  return result;
}

async function latestMigration(query: (sql: string) => Promise<{ rows: Array<{ filename: string | null }> }>) {
  const result = await query("SELECT max(filename) AS filename FROM schema_migrations");
  return result.rows[0]?.filename ?? null;
}

async function packageDump(dumpPath: string, packagePath: string, manifest: { tableCounts: Record<string, number>; latestMigration: string | null; createdAt: string }): Promise<void> {
  const metadata = Buffer.from(JSON.stringify(manifest));
  if (metadata.length > 1024 * 1024) throw new Error("Backup manifest is unexpectedly large.");
  const header = Buffer.alloc(12);
  PACKAGE_MAGIC.copy(header, 0);
  header.writeUInt32BE(metadata.length, PACKAGE_MAGIC.length);
  await writeFile(packagePath, Buffer.concat([header, metadata]), { flag: "wx", mode: 0o600 });
  await pipeline(createReadStream(dumpPath), createWriteStream(packagePath, { flags: "a" }));
}

async function unpackageDump(packagePath: string, dumpPath: string): Promise<{ tableCounts: Record<string, number>; latestMigration: string | null; createdAt: string }> {
  const handle = await open(packagePath, "r");
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== header.length || !header.subarray(0, PACKAGE_MAGIC.length).equals(PACKAGE_MAGIC)) {
      throw new Error("Backup payload or manifest is invalid.");
    }
    const metadataLength = header.readUInt32BE(PACKAGE_MAGIC.length);
    if (!metadataLength || metadataLength > 1024 * 1024) throw new Error("Backup manifest length is invalid.");
    const metadata = Buffer.alloc(metadataLength);
    const result = await handle.read(metadata, 0, metadataLength, header.length);
    if (result.bytesRead !== metadataLength) throw new Error("Backup manifest is truncated.");
    const manifest = JSON.parse(metadata.toString("utf8")) as { tableCounts?: unknown; latestMigration?: unknown; createdAt?: unknown };
    if (!manifest.tableCounts || typeof manifest.tableCounts !== "object" || typeof manifest.createdAt !== "string"
      || !(typeof manifest.latestMigration === "string" || manifest.latestMigration === null)) {
      throw new Error("Backup manifest has an unsupported shape.");
    }
    const info = await handle.stat();
    const dumpOffset = header.length + metadataLength;
    if (info.size <= dumpOffset) throw new Error("Backup database archive is missing.");
    await pipeline(createReadStream(packagePath, { start: dumpOffset }), createWriteStream(dumpPath, { flags: "wx", mode: 0o600 }));
    return manifest as { tableCounts: Record<string, number>; latestMigration: string | null; createdAt: string };
  } finally {
    await handle.close();
  }
}

async function createBackup(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const key = encryptionKey();
  const remoteEnabled = privateObjectStorageEnabled();
  if (process.env.NODE_ENV === "production" && !remoteEnabled) {
    throw new Error("Production database backups require configured private object storage.");
  }
  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error("BACKUP_RETENTION_DAYS must be an integer from 1 to 3650.");
  }
  const directory = resolve(process.env.BACKUP_DIR || join(process.cwd(), "backups"));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const filename = `brick-erp-${stamp}.bcerp`;
  const outputPath = join(directory, filename);
  const rawPath = join(tmpdir(), `.${filename}.pgdump`);
  const packagePath = join(tmpdir(), `.${filename}.package`);
  const sourcePool = new Pool({ connectionString: databaseUrl });
  let client: PoolClient | undefined;
  let transactionOpen = false;
  try {
    client = await sourcePool.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const snapshot = (await client.query<{ id: string }>("SELECT pg_export_snapshot() AS id")).rows[0].id;
    const tableCounts = await counts(sql => client!.query<{ count: string }>(sql));
    const migration = await latestMigration(sql => client!.query<{ filename: string | null }>(sql));
    await startDump(rawPath, connectionParts(databaseUrl), snapshot);
    const manifest = { tableCounts, latestMigration: migration, createdAt: new Date().toISOString() };
    await packageDump(rawPath, packagePath, manifest);
    await client.query("COMMIT");
    transactionOpen = false;
    client.release();
    client = undefined;
    await encryptFile(packagePath, outputPath, key);
    const bytes = await (await import("node:fs/promises")).readFile(outputPath);
    const digest = createHash("sha256").update(bytes).digest("hex");
    let remote = false;
    if (remoteEnabled) {
      const objectKey = `database-backups/${filename}`;
      await putPrivateObject(objectKey, bytes, "application/vnd.brick-erp.encrypted-backup");
      const stored = await getPrivateObject(objectKey);
      remote = stored !== null && createHash("sha256").update(stored).digest("hex") === digest;
      if (!remote) throw new Error("Remote backup verification failed after upload.");
    }
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const files = await readdir(directory, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() || !/^brick-erp-\d{8}T\d{6}Z\.bcerp$/.test(file.name) || file.name === filename) continue;
      const oldPath = join(directory, file.name);
      if ((await stat(oldPath)).mtimeMs < cutoff) await rm(oldPath, { force: true });
    }
    console.log(JSON.stringify({ status: "created", filename, bytes: bytes.length, sha256: digest, remoteVerified: remote, retentionDays }));
  } catch (error) {
    await rm(outputPath, { force: true });
    throw error;
  } finally {
    if (transactionOpen) await client?.query("ROLLBACK").catch(() => undefined);
    client?.release();
    await sourcePool.end();
    await rm(rawPath, { force: true });
    await rm(packagePath, { force: true });
  }
}

async function restoreCheck(backupPathArg: string | undefined): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const adminUrl = process.env.BACKUP_RESTORE_ADMIN_DATABASE_URL;
  if (!databaseUrl || !adminUrl) throw new Error("DATABASE_URL and BACKUP_RESTORE_ADMIN_DATABASE_URL are required for restore verification.");
  if (!backupPathArg) throw new Error("Provide the encrypted backup path to restore-check.");
  const backupPath = resolve(backupPathArg);
  const key = encryptionKey();
  connectionParts(databaseUrl);
  const admin = connectionParts(adminUrl);
  const targetName = `brick_erp_restore_check_${randomBytes(6).toString("hex")}`;
  const adminPool = new Pool({ connectionString: adminUrl });
  const rawPath = join(tmpdir(), `${targetName}.pgdump`);
  const packagePath = join(tmpdir(), `${targetName}.package`);
  let targetPool: Pool | undefined;
  let databaseCreated = false;
  try {
    await decryptFile(backupPath, packagePath, key);
    const manifest = await unpackageDump(packagePath, rawPath);
    await adminPool.query(`CREATE DATABASE "${targetName}"`);
    databaseCreated = true;
    await runPgRestore(rawPath, admin, targetName);
    const targetUrl = new URL(adminUrl);
    targetUrl.pathname = `/${targetName}`;
    targetPool = new Pool({ connectionString: targetUrl.toString() });
    const actualCounts = await counts(sql => targetPool!.query<{ count: string }>(sql));
    const actualMigration = await latestMigration(sql => targetPool!.query<{ filename: string | null }>(sql));
    const invalidConstraints = await targetPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated",
    );
    const passed = JSON.stringify(actualCounts) === JSON.stringify(manifest.tableCounts)
      && actualMigration === manifest.latestMigration
      && Number(invalidConstraints.rows[0]?.count) === 0;
    console.log(JSON.stringify({ status: passed ? "passed" : "failed", backupCreatedAt: manifest.createdAt, restoredDatabase: targetName, tableCounts: actualCounts, migration: actualMigration, unvalidatedConstraints: Number(invalidConstraints.rows[0]?.count) }));
    if (!passed) process.exitCode = 1;
  } finally {
    await targetPool?.end();
    if (databaseCreated) await adminPool.query(`DROP DATABASE "${targetName}"`);
    await adminPool.end();
    await rm(rawPath, { force: true });
    await rm(packagePath, { force: true });
  }
}

async function main() {
  const command = process.argv[2] || "create";
  if (command === "create") await createBackup();
  else if (command === "restore-check") await restoreCheck(process.argv[3]);
  else throw new Error("Usage: backup-database.ts [create | restore-check <backup-file>].");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Database backup operation failed.");
  process.exitCode = 1;
});
