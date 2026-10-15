import assert from "node:assert/strict";
import { internalErrorResponse, publicDatabaseError } from "../src/http-errors";

assert.equal(publicDatabaseError("28P01")?.code, "DATABASE_CONFIGURATION");
assert.equal(publicDatabaseError("3D000")?.code, "DATABASE_CONFIGURATION");
assert.equal(publicDatabaseError("42P01")?.code, "MIGRATIONS_REQUIRED");
assert.equal(publicDatabaseError("42703")?.code, "MIGRATIONS_REQUIRED");
assert.equal(publicDatabaseError("23505")?.status, 409);
assert.equal(publicDatabaseError("23503")?.code, "DATA_CONFLICT");
assert.equal(publicDatabaseError("ECONNREFUSED")?.code, "SERVICE_UNAVAILABLE");
assert.equal(publicDatabaseError("unknown"), null);

const internal = internalErrorResponse("a6d5b479-a4cd-4ed6-9f91-028b074e3711");
assert.equal(internal.status, 500);
assert.equal(internal.body.error.requestId, "a6d5b479-a4cd-4ed6-9f91-028b074e3711");
assert.equal(JSON.stringify(internal).includes("password"), false, "internal responses must not expose credentials");

console.log(JSON.stringify({ check: "api-error-responses", safeDatabaseMappings: true, migrationHint: true, correlationReference: true, credentialLeakage: false }));
