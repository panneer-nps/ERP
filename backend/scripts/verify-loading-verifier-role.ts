import { randomBytes } from "node:crypto";
import { assertDisposableVerificationTarget, assertLocalVerificationApi } from "./verification-target";

const api = process.env.ERP_VERIFY_API_URL ?? "http://127.0.0.1:44143";
const suffix = randomBytes(5).toString("hex");
const ownerEmail = `loading-owner-${suffix}@example.test`;
const ownerPassword = `Owner-${randomBytes(12).toString("base64url")}-9A`;
const verifierEmail = `loading-verifier-${suffix}@example.test`;
const verifierPassword = `Verifier-${randomBytes(12).toString("base64url")}-9A`;
const managerEmail = `loading-manager-${suffix}@example.test`;
const managerPassword = `Manager-${randomBytes(12).toString("base64url")}-9A`;
let requestNumber = 0;

async function request<T>(path: string, method = "GET", body?: unknown, token?: string) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method === "POST" ? { "Idempotency-Key": `loading-role-${suffix}-${++requestNumber}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  return { status: response.status, data };
}

async function main() {
  assertDisposableVerificationTarget();
  assertLocalVerificationApi(api);

  const setup = await request("/api/auth/setup", "POST", {
    companyName: `Loading role verification ${suffix}`,
    ownerName: "Loading Role Owner",
    email: ownerEmail,
    password: ownerPassword,
  });
  if (setup.status !== 201) throw new Error(`Fresh Owner setup expected 201, received ${setup.status}.`);

  const ownerLogin = await request<{ token: string }>("/api/auth/login", "POST", { email: ownerEmail, password: ownerPassword });
  const ownerToken = ownerLogin.data.token;
  if (!ownerToken) throw new Error("Owner sign-in did not return a session token.");

  const roleResult = await request<{ roles: Array<{ id: string; code: string; permissionCodes: string[] }> }>("/api/admin/access/roles", "GET", undefined, ownerToken);
  const verifierRole = roleResult.data.roles?.find((role) => role.code === "loading_verifier");
  if (!verifierRole) throw new Error("First-time setup did not create the Loading Verifier role.");
  const verifierPermissions = new Set(verifierRole.permissionCodes);
  if (!verifierPermissions.has("loading.view") || !verifierPermissions.has("loading.verify")
    || verifierPermissions.has("loading.edit") || verifierPermissions.has("loading.approve")
    || verifierPermissions.has("delivery.dispatch")) {
    throw new Error("Loading Verifier role must view and verify only; it must not complete, approve, or dispatch loading.");
  }

  const created = await request<{ id: string }>("/api/admin/access/users", "POST", {
    fullName: "Synthetic Loading Verifier",
    email: verifierEmail,
    password: verifierPassword,
    roleIds: [verifierRole.id],
    branchIds: [],
  }, ownerToken);
  if (created.status !== 201) throw new Error(`Loading Verifier account creation expected 201, received ${created.status}.`);

  const verifierLogin = await request<{ token: string }>("/api/auth/login", "POST", { email: verifierEmail, password: verifierPassword });
  const verifierToken = verifierLogin.data.token;
  if (!verifierToken) throw new Error("Loading Verifier sign-in did not return a session token.");
  const identity = await request<{ user: { roles: Array<{ code: string }>; permissions: string[] } }>("/api/auth/me", "GET", undefined, verifierToken);
  const assignedPermissions = new Set(identity.data.user?.permissions ?? []);
  if (!identity.data.user?.roles.some((role) => role.code === "loading_verifier")
    || !assignedPermissions.has("loading.verify") || assignedPermissions.has("loading.edit")) {
    throw new Error("Signed-in Loading Verifier did not receive the expected minimal permissions.");
  }

  const fakeLoadingId = "11111111-1111-4111-8111-111111111111";
  const completionAttempt = await request(`/api/loading/${fakeLoadingId}/complete`, "POST", { quantity: 100 }, verifierToken);
  const verificationAttempt = await request(`/api/loading/${fakeLoadingId}/verify`, "POST", { quantity: 100 }, verifierToken);
  if (completionAttempt.status !== 403 || verificationAttempt.status !== 404) {
    throw new Error(`Verifier API access expected complete=403 and verify=404 (authorized route reached), received ${completionAttempt.status} and ${verificationAttempt.status}.`);
  }

  const managerRole = roleResult.data.roles.find((role) => role.code === "manager");
  if (!managerRole) throw new Error("First-time setup did not create the Manager role.");
  if (!managerRole.permissionCodes.includes("loading.verify")) throw new Error("Manager role lost its pre-existing loading verification access.");
  const manager = await request<{ id: string }>("/api/admin/access/users", "POST", {
    fullName: "Synthetic Loading Manager",
    email: managerEmail,
    password: managerPassword,
    roleIds: [managerRole.id],
    branchIds: [],
  }, ownerToken);
  if (manager.status !== 201) throw new Error(`Manager account creation expected 201, received ${manager.status}.`);
  const managerLogin = await request<{ token: string }>("/api/auth/login", "POST", { email: managerEmail, password: managerPassword });
  if (!managerLogin.data.token) throw new Error("Manager sign-in did not return a session token.");
  const managerIdentity = await request<{ user: { permissions: string[] } }>("/api/auth/me", "GET", undefined, managerLogin.data.token);
  if (!managerIdentity.data.user?.permissions.includes("loading.verify")) throw new Error("Manager's signed-in permission list omitted verification.");

  console.log(JSON.stringify({
    setup: setup.status,
    verifierRole: verifierPermissions.has("loading.verify"),
    verifierLogin: identity.status,
    verifierCannotComplete: completionAttempt.status === 403,
    verifierCanReachVerification: verificationAttempt.status === 404,
    managerRetainsVerification: managerIdentity.data.user.permissions.includes("loading.verify"),
  }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Loading Verifier verification failed.");
  process.exitCode = 1;
});
