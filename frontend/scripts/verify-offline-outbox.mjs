import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../app");
const testDir = await mkdtemp(path.join(tmpdir(), "brick-erp-offline-"));
const stores = new Map();
let databaseVersion = 0;

globalThis.crypto ??= webcrypto;
const sessionValues = new Map();
globalThis.sessionStorage = {
  getItem: key => sessionValues.get(key) ?? null,
  setItem: (key, value) => sessionValues.set(key, String(value)),
  removeItem: key => sessionValues.delete(key),
};

function requestFor(operation, transaction) {
  const request = { result: undefined, error: null, onsuccess: null, onerror: null };
  queueMicrotask(() => {
    try {
      request.result = operation();
      request.onsuccess?.();
      queueMicrotask(() => transaction.oncomplete?.());
    } catch (error) {
      request.error = error;
      request.onerror?.();
    }
  });
  return request;
}

function openTestDatabase() {
  const database = {
    objectStoreNames: { contains: name => stores.has(name) },
    createObjectStore(name) { stores.set(name, new Map()); },
    close() {},
    transaction(name) {
      const transaction = { oncomplete: null, onerror: null, onabort: null };
      const data = stores.get(name);
      if (!data) throw new Error(`Unknown IndexedDB store: ${name}`);
      transaction.objectStore = () => ({
        getAll: () => requestFor(() => [...data.values()], transaction),
        get: key => requestFor(() => data.get(key), transaction),
        put: value => requestFor(() => { data.set(value.id, structuredClone(value)); return value.id; }, transaction),
        delete: key => requestFor(() => data.delete(key), transaction),
      });
      return transaction;
    },
  };
  return database;
}

globalThis.indexedDB = {
  open(_name, version) {
    const request = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      request.result = openTestDatabase();
      if (databaseVersion < version) {
        databaseVersion = version;
        request.onupgradeneeded?.();
      }
      request.onsuccess?.();
    });
    return request;
  },
};

function compile(source, filename) {
  const result = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  const errors = result.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error) ?? [];
  if (errors.length) throw new Error(ts.formatDiagnostics(errors, {
    getCurrentDirectory: () => process.cwd(),
    getCanonicalFileName: file => file,
    getNewLine: () => "\n",
  }));
  return result.outputText;
}

try {
  const idempotencySource = await readFile(path.join(appDir, "idempotency.ts"), "utf8");
  const outboxSource = await readFile(path.join(appDir, "offline-outbox.ts"), "utf8")
    .then(source => source.replace('from "./idempotency"', 'from "./idempotency.mjs"'));
  await Promise.all([
    writeFile(path.join(testDir, "idempotency.mjs"), compile(idempotencySource, "idempotency.mts")),
    writeFile(path.join(testDir, "offline-outbox.mjs"), compile(outboxSource, "offline-outbox.mts")),
  ]);
  const { clearTransactionIdempotency, transactionIdempotency } = await import(pathToFileURL(path.join(testDir, "idempotency.mjs")));
  const {
    clearLoadingPhotoDrafts,
    clearOfflineExpenseData,
    deleteLoadingPhotoDraft,
    discardOfflineExpense,
    listLoadingPhotoDrafts,
    listOfflineExpenses,
    loadOfflineExpenseCategories,
    saveLoadingPhotoDraft,
    saveOfflineExpense,
    saveOfflineExpenseCategories,
  } = await import(pathToFileURL(path.join(testDir, "offline-outbox.mjs")));

  const userA = `offline-test-a-${crypto.randomUUID()}`;
  const userB = `offline-test-b-${crypto.randomUUID()}`;
  const payload = { categoryId: crypto.randomUUID(), expenseDate: "2026-10-10", amount: 125, description: "offline retry verification" };
  const body = JSON.stringify(payload);
  const first = await transactionIdempotency("/api/expenses", body);
  const retry = await transactionIdempotency("/api/expenses", body);
  assert.equal(first.key, retry.key, "same payload generated a different idempotency key");

  const draft = {
    id: crypto.randomUUID(), userId: userA, key: first.key, idempotencyStorageKey: first.storageKey,
    payload, createdAt: new Date().toISOString(), state: "queued",
  };
  await saveOfflineExpense(draft);
  assert.equal((await listOfflineExpenses(userA)).length, 1, "queued draft was not persisted");
  assert.equal((await listOfflineExpenses(userB)).length, 0, "draft leaked across user partitions");
  await saveOfflineExpenseCategories(userA, [{ id: payload.categoryId, name: "Fuel" }]);
  await saveOfflineExpenseCategories(userB, [{ id: "other-user-category", name: "Other" }]);
  assert.equal((await loadOfflineExpenseCategories(userA))[0]?.id, payload.categoryId, "cached categories were not user-partitioned");
  await saveOfflineExpense({ ...draft, state: "syncing" });
  await saveOfflineExpense({ ...draft, state: "queued" });
  assert.equal((await transactionIdempotency("/api/expenses", body)).key, draft.key, "retry after interruption changed its key");
  await saveOfflineExpense({ ...draft, state: "needs_attention", message: "Server validation requires review." });
  assert.equal((await listOfflineExpenses(userA))[0]?.state, "needs_attention", "needs-attention state was not persisted");
  const correctedPayload = { ...payload, description: "corrected offline expense" };
  const corrected = await transactionIdempotency("/api/expenses", JSON.stringify(correctedPayload));
  assert.notEqual(corrected.key, draft.key, "edited payload reused its prior idempotency key");
  await saveOfflineExpense({ ...draft, key: corrected.key, idempotencyStorageKey: corrected.storageKey, payload: correctedPayload, state: "queued", message: undefined });
  clearTransactionIdempotency(draft.idempotencyStorageKey);
  const edited = (await listOfflineExpenses(userA))[0];
  assert.equal(edited.id, draft.id, "editing replaced the draft with a different record");
  assert.equal(edited.payload.description, correctedPayload.description, "edited payload was not persisted");
  assert.equal(edited.key, corrected.key, "edited draft did not keep its new retry key");
  await discardOfflineExpense(edited);
  assert.equal((await listOfflineExpenses(userA)).length, 0, "completed draft remained in the outbox");
  assert.equal(sessionStorage.getItem(corrected.storageKey), null, "completed draft kept its idempotency key");
  const photoDraft = { id: crypto.randomUUID(), userId: userA, loadingId: crypto.randomUUID(), photoType: "during", contentType: "image/jpeg", imageBase64: "compressed-photo-payload", idempotencyKey: crypto.randomUUID(), createdAt: new Date().toISOString() };
  await saveLoadingPhotoDraft(photoDraft);
  await saveLoadingPhotoDraft({ ...photoDraft, id: crypto.randomUUID(), userId: userB });
  const recoveredPhoto = (await listLoadingPhotoDrafts(userA))[0];
  assert.equal(recoveredPhoto?.imageBase64, photoDraft.imageBase64, "loading photo draft did not survive storage reload");
  assert.equal(recoveredPhoto?.idempotencyKey, photoDraft.idempotencyKey, "loading photo retry key was not persisted");
  assert.equal((await listLoadingPhotoDrafts(userB)).length, 1, "loading photo drafts were not isolated per user");
  await deleteLoadingPhotoDraft(photoDraft.id);
  assert.equal((await listLoadingPhotoDrafts(userA)).length, 0, "uploaded loading photo draft was not removed");
  await saveLoadingPhotoDraft(photoDraft);
  await clearOfflineExpenseData(userA);
  assert.equal((await listLoadingPhotoDrafts(userA)).length, 0, "session cleanup left loading photo drafts behind");
  assert.equal((await listLoadingPhotoDrafts(userB)).length, 1, "session cleanup deleted another user's loading photos");
  await clearLoadingPhotoDrafts(userB);
  assert.equal((await loadOfflineExpenseCategories(userA)).length, 0, "user cleanup left cached reference data");
  assert.equal((await loadOfflineExpenseCategories(userB)).length, 1, "cleanup removed another user's reference data");
  await clearOfflineExpenseData(userB);

  console.log(JSON.stringify({
    status: "passed",
    checks: [
      "IndexedDB draft persistence via deterministic test adapter",
      "user data isolation",
      "category cache isolation",
      "stable idempotency key across retry",
      "queued/syncing/needs-attention states",
      "corrected draft edits replace payload and idempotency key without duplicating the record",
      "loading photo drafts persist their idempotency keys and remain user-isolated",
      "successful photo cleanup and session revocation remove only that user's drafts",
      "completed draft and key cleanup",
      "per-user data cleanup",
    ],
  }));
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
} finally {
  await rm(testDir, { recursive: true, force: true });
}
