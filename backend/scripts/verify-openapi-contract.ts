import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const contract = readFileSync(resolve(root, "docs/openapi.yaml"), "utf8");
const sources = [
  readFileSync(resolve(root, "backend/src/server.ts"), "utf8"),
  readFileSync(resolve(root, "backend/src/admin-roles.ts"), "utf8"),
  readFileSync(resolve(root, "backend/src/company-profile.ts"), "utf8"),
].join("\n");
const mounts = [
  readFileSync(resolve(root, "backend/src/server.ts"), "utf8"),
  readFileSync(resolve(root, "backend/src/admin-roles.ts"), "utf8"),
  readFileSync(resolve(root, "backend/src/company-profile.ts"), "utf8"),
].join("\n");
const prefixes: Record<string, string> = {};
for (const routerName of ["adminRolesRouter", "companyProfileRouter"]) {
  const escaped = routerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mount = mounts.match(new RegExp(`app\\.use\\(\\s*[\"']([^\"']+)[\"']\\s*,\\s*${escaped}\\s*\\)`));
  if (mount) prefixes[routerName] = mount[1];
}

const operations: Array<{ path: string; method: string; operationId: string }> = [];
let currentPath: string | null = null;
let currentOperation: { path: string; method: string; operationId?: string } | null = null;
for (const line of contract.split(/\r?\n/)) {
  const pathMatch = line.match(/^  (\/[^:]+):\s*$/);
  if (pathMatch) {
    currentPath = pathMatch[1];
    currentOperation = null;
    continue;
  }
  const methodMatch = line.match(/^    (get|post|put|patch|delete):\s*$/);
  if (methodMatch && currentPath) {
    currentOperation = { path: currentPath, method: methodMatch[1] };
    continue;
  }
  const idMatch = line.match(/^      operationId:\s*([A-Za-z][A-Za-z0-9]+)\s*$/);
  if (idMatch && currentOperation) {
    operations.push({ ...currentOperation, operationId: idMatch[1] });
  }
}

const failures: string[] = [];
if (!contract.startsWith("openapi: 3.1.0\n")) failures.push("Contract must declare OpenAPI 3.1.0.");
if (!contract.includes("paths:\n") || !contract.includes("components:\n")) failures.push("Contract must define top-level paths and components sections.");
if (/(^|\s)(TODO|TBD)(\s|$)/i.test(contract)) failures.push("Contract must not contain unresolved TODO/TBD placeholders.");
const ids = operations.map((operation) => operation.operationId);
if (new Set(ids).size !== ids.length) failures.push("operationId values must be unique.");
if (operations.length < 20) failures.push(`Expected at least 20 scoped operations; found ${operations.length}.`);

for (const operation of operations) {
  const relativePaths = [operation.path];
  for (const prefix of Object.values(prefixes)) {
    if (operation.path.startsWith(`${prefix}/`)) relativePaths.push(operation.path.slice(prefix.length));
    if (operation.path === prefix) relativePaths.push("/");
  }
  const found = relativePaths.some((path) => {
    const sourcePath = path.replace(/\{[^}]+\}/g, "[^/]+");
    const routePattern = sourcePath.split("/").map((segment) => segment.startsWith(":") ? "[^/]+" : segment).join("/");
    const sourcePattern = new RegExp(`\\.${operation.method}\\(\\s*[\"']${routePattern.replaceAll("/", "\\/")}[\"']`);
    return sourcePattern.test(sources);
  });
  if (!found) failures.push(`No source route found for ${operation.method.toUpperCase()} ${operation.path}.`);
}

if (failures.length) {
  console.error(failures.map((failure) => `FAIL ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`OpenAPI route contract passed: ${operations.length} unique operations match source routes.`);
}
