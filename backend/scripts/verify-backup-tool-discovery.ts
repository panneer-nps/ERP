import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePgExecutable } from "./backup-database";

async function main() {
  const root = await mkdtemp(join(tmpdir(), "brick-erp-pg-tool-discovery-"));
  try {
    const pathToolDir = join(root, "path-tools");
    const installRoot = join(root, "PostgreSQL");
    const olderTool = join(installRoot, "16", "bin", "pg_dump.exe");
    const newerTool = join(installRoot, "18", "bin", "pg_dump.exe");
    await mkdir(pathToolDir, { recursive: true });
    await mkdir(join(installRoot, "16", "bin"), { recursive: true });
    await mkdir(join(installRoot, "18", "bin"), { recursive: true });
    await writeFile(join(pathToolDir, "pg_restore.exe"), "test tool");
    await writeFile(olderTool, "test tool");
    await writeFile(newerTool, "test tool");

    assert.equal(resolvePgExecutable("pg_dump", "D:\\tools\\custom-dump.exe", "win32", "", [installRoot]), "D:\\tools\\custom-dump.exe");
    assert.equal(resolvePgExecutable("pg_restore", undefined, "win32", `${pathToolDir};C:\\Windows\\System32`, [installRoot]), join(pathToolDir, "pg_restore.exe"));
    assert.equal(resolvePgExecutable("pg_dump", undefined, "win32", "", [installRoot]), newerTool);
    assert.equal(resolvePgExecutable("pg_dump", undefined, "linux", "/usr/bin:/bin"), "pg_dump");

    console.log(JSON.stringify({ status: "passed", checks: ["explicit override", "PATH lookup", "highest installed PostgreSQL version", "Unix fallback"] }));
  } finally {
    const resolvedRoot = join(tmpdir(), root.slice(root.lastIndexOf("brick-erp-pg-tool-discovery-")));
    if (resolvedRoot === root && root.startsWith(join(tmpdir(), "brick-erp-pg-tool-discovery-"))) {
      await rm(root, { recursive: true, force: true });
    }
  }
}

void main();
