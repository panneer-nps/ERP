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
let failNextWrite = false;

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
        add: value => requestFor(() => { if (failNextWrite) { failNextWrite = false; throw Object.assign(new Error("Browser storage is full."), { name: "QuotaExceededError" }); } if (data.has(value.id)) throw new Error("ConstraintError"); data.set(value.id, structuredClone(value)); return value.id; }, transaction),
        put: value => requestFor(() => { if (failNextWrite) { failNextWrite = false; throw Object.assign(new Error("Browser storage is full."), { name: "QuotaExceededError" }); } data.set(value.id, structuredClone(value)); return value.id; }, transaction),
        delete: key => requestFor(() => data.delete(key), transaction),
        openCursor: () => {
          const request = { result: undefined, error: null, onsuccess: null, onerror: null };
          const rows = [...data.entries()];
          let index = 0;
          const advance = () => queueMicrotask(() => {
            if (index >= rows.length) {
              request.result = null;
              request.onsuccess?.();
              queueMicrotask(() => transaction.oncomplete?.());
              return;
            }
            const [key, value] = rows[index++];
            request.result = { value, delete: () => data.delete(key), continue: advance };
            request.onsuccess?.();
          });
          advance();
          return request;
        },
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
  const offlineSessionSource = await readFile(path.join(appDir, "offline-session.ts"), "utf8");
  const offlineErrorsSource = await readFile(path.join(appDir, "offline-errors.ts"), "utf8")
    .then(source => source.replace('from "./offline-outbox"', 'from "./offline-outbox.mjs"'));
  await Promise.all([
    writeFile(path.join(testDir, "idempotency.mjs"), compile(idempotencySource, "idempotency.mts")),
    writeFile(path.join(testDir, "offline-outbox.mjs"), compile(outboxSource, "offline-outbox.mts")),
    writeFile(path.join(testDir, "offline-outbox-reload.mjs"), compile(outboxSource, "offline-outbox-reload.mts")),
    writeFile(path.join(testDir, "offline-session.mjs"), compile(offlineSessionSource, "offline-session.mts")),
    writeFile(path.join(testDir, "offline-errors.mjs"), compile(offlineErrorsSource, "offline-errors.mts")),
  ]);
  const { clearTransactionIdempotency, transactionIdempotency } = await import(pathToFileURL(path.join(testDir, "idempotency.mjs")));
  const {
    OfflineStorageSecurityError,
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
  const { bindOfflineUserToSession, offlineUserForSession } = await import(pathToFileURL(path.join(testDir, "offline-session.mjs")));
  const { offlineApiErrorMessage, offlineStorageErrorMessage } = await import(pathToFileURL(path.join(testDir, "offline-errors.mjs")));

  const sessionA = `offline-session-a-${crypto.randomUUID()}`;
  const sessionB = `offline-session-b-${crypto.randomUUID()}`;
  bindOfflineUserToSession(sessionA, "offline-user-a");
  assert.equal(offlineUserForSession(sessionA), "offline-user-a", "current session could not recover its cached user ID");
  assert.equal(offlineUserForSession(sessionB), "", "a different session could read another user's offline queue identity");
  assert.equal(JSON.stringify([...sessionValues.entries()]).includes(sessionA), false, "raw session token was copied into offline identity storage");
  assert.match(offlineStorageErrorMessage(Object.assign(new Error("storage full"), { name: "QuotaExceededError" }), "en", "fallback"), /local storage is full/i);
  assert.match(offlineStorageErrorMessage(new OfflineStorageSecurityError(), "ta", "fallback"), /பாதுகாப்பான ஆஃப்லைன் தரவைத் திறக்க முடியவில்லை/);
  assert.equal(offlineStorageErrorMessage(new Error("Unexpected English storage detail"), "ta", "உள்ளூர் சேமிப்பைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்."), "உள்ளூர் சேமிப்பைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.");
  assert.equal(offlineStorageErrorMessage(new Error("Unexpected English storage detail"), "en", "fallback"), "Unexpected English storage detail");
  assert.match(offlineApiErrorMessage({ code: "VALIDATION_ERROR", message: "Check the category and amount.", status: 400 }, "ta", "fallback"), /வகை, தேதி, தொகை/);
  assert.doesNotMatch(offlineApiErrorMessage({ code: "BRANCH_ACCESS_DENIED", message: "English server detail", status: 403 }, "ta", "fallback"), /English server detail/);
  assert.match(offlineApiErrorMessage({ code: "INTERNAL_ERROR", message: "Internal error", requestId: "req-test-123", status: 500 }, "ta", "fallback"), /req-test-123/);
  assert.equal(offlineApiErrorMessage({ code: "VALIDATION_ERROR", message: "Check the category and amount.", status: 400 }, "en", "fallback"), "Check the category and amount.");

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
  const storedExpense = [...stores.get("expense-drafts").values()][0];
  assert.equal(storedExpense.encrypted, true, "expense draft was not marked encrypted");
  assert.equal(JSON.stringify(storedExpense).includes(payload.description), false, "expense description was persisted in plaintext");
  assert.equal(stores.get("encryption-keys").get(userA).key.extractable, false, "device encryption key can be exported");
  failNextWrite = true;
  await assert.rejects(() => saveOfflineExpense({ ...draft, id: crypto.randomUUID() }), error => error?.name === "QuotaExceededError", "a browser storage quota failure was reported as a successful save");
  const missingKeyUser = `offline-missing-key-${crypto.randomUUID()}`;
  await saveOfflineExpense({ ...draft, id: crypto.randomUUID(), userId: missingKeyUser, idempotencyStorageKey: undefined });
  stores.get("encryption-keys").delete(missingKeyUser);
  await assert.rejects(() => listOfflineExpenses(missingKeyUser), OfflineStorageSecurityError, "encrypted draft silently created a replacement key instead of failing closed");
  assert.equal(stores.get("encryption-keys").has(missingKeyUser), false, "reading a draft recreated a missing key");
  await clearOfflineExpenseData(missingKeyUser);
  assert.equal((await listOfflineExpenses(userA)).length, 1, "queued draft was not persisted");
  const afterReload = await import(pathToFileURL(path.join(testDir, "offline-outbox-reload.mjs")));
  assert.equal((await afterReload.listOfflineExpenses(userA))[0]?.payload.description, payload.description, "offline expense draft did not survive a fresh module/page reload");
  assert.equal((await listOfflineExpenses(userB)).length, 0, "draft leaked across user partitions");
  const legacyDraft = { ...draft, id: crypto.randomUUID(), userId: userB, payload: { ...payload, description: "legacy plaintext draft" } };
  stores.get("expense-drafts").set(legacyDraft.id, structuredClone(legacyDraft));
  const migratedLegacy = await listOfflineExpenses(userB);
  assert.equal(migratedLegacy[0]?.payload.description, "legacy plaintext draft", "existing plaintext draft could not be read during migration");
  assert.equal(stores.get("expense-drafts").get(legacyDraft.id).encrypted, true, "existing plaintext draft was not encrypted in place");
  assert.equal(JSON.stringify(stores.get("expense-drafts").get(legacyDraft.id)).includes("legacy plaintext draft"), false, "legacy plaintext draft remained readable in storage");
  const legacyCategoryId = `expense-categories:${userB}`;
  stores.get("reference-data").set(legacyCategoryId, structuredClone({ id: legacyCategoryId, userId: userB, value: [{ id: "legacy-category", name: "Legacy" }] }));
  assert.equal((await loadOfflineExpenseCategories(userB))[0]?.id, "legacy-category", "existing plaintext category cache could not be read during migration");
  assert.equal(stores.get("reference-data").get(legacyCategoryId).encrypted, true, "existing plaintext category cache was not encrypted in place");
  const legacyPhoto = { id: crypto.randomUUID(), userId: userB, loadingId: crypto.randomUUID(), photoType: "before", contentType: "image/jpeg", imageBase64: "legacy-photo-payload", idempotencyKey: crypto.randomUUID(), createdAt: new Date().toISOString() };
  stores.get("loading-photo-drafts").set(legacyPhoto.id, structuredClone(legacyPhoto));
  assert.equal((await listLoadingPhotoDrafts(userB))[0]?.imageBase64, legacyPhoto.imageBase64, "existing plaintext photo could not be read during migration");
  assert.equal(stores.get("loading-photo-drafts").get(legacyPhoto.id).encrypted, true, "existing plaintext photo was not encrypted in place");
  assert.equal(JSON.stringify(stores.get("loading-photo-drafts").get(legacyPhoto.id)).includes(legacyPhoto.imageBase64), false, "legacy photo remained readable in storage");
  await deleteLoadingPhotoDraft(legacyPhoto.id);
  await saveOfflineExpenseCategories(userA, [{ id: payload.categoryId, name: "Fuel" }]);
  assert.equal(JSON.stringify([...stores.get("reference-data").values()][0]).includes("Fuel"), false, "cached category was persisted in plaintext");
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
  assert.equal(JSON.stringify([...stores.get("loading-photo-drafts").values()][0]).includes(photoDraft.imageBase64), false, "loading photo was persisted in plaintext");
  await saveLoadingPhotoDraft({ ...photoDraft, id: crypto.randomUUID(), userId: userB });
  const recoveredPhoto = (await listLoadingPhotoDrafts(userA))[0];
  assert.equal(recoveredPhoto?.imageBase64, photoDraft.imageBase64, "loading photo draft did not survive storage reload");
  assert.equal(recoveredPhoto?.idempotencyKey, photoDraft.idempotencyKey, "loading photo retry key was not persisted");
  const recoveredAfterReload = (await afterReload.listLoadingPhotoDrafts(userA))[0];
  assert.equal(recoveredAfterReload?.imageBase64, photoDraft.imageBase64, "encrypted loading photo could not be recovered after a fresh module/page reload");
  assert.equal(recoveredAfterReload?.idempotencyKey, photoDraft.idempotencyKey, "loading photo retry key changed after a fresh module/page reload");
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
      "encrypted expense and photo recovery after a fresh module/page reload",
      "user data isolation",
      "category cache isolation",
      "stable idempotency key across retry",
      "queued/syncing/needs-attention states",
      "corrected draft edits replace payload and idempotency key without duplicating the record",
      "loading photo drafts persist their idempotency keys and remain user-isolated",
      "successful photo cleanup and session revocation remove only that user's drafts",
      "completed draft and key cleanup",
      "per-user data cleanup",
      "AES-GCM encrypted expense, reference and loading-photo records",
      "plaintext payloads are absent from IndexedDB records",
      "existing plaintext expense drafts migrate in place",
      "existing plaintext category and photo records migrate in place",
      "persisted per-user Web Crypto keys are non-exportable",
      "missing encryption keys fail closed without replacing the lost key",
      "offline draft recovery identity is bound to the current session token",
      "raw session token is not persisted in the offline identity binding",
      "quota and lost-key failures have localized, actionable messages",
      "unknown offline-storage errors use the selected language's safe fallback",
      "offline API rejection guidance is localized and keeps support reference IDs",
      "storage quota errors remain visible to callers instead of reporting a queued save",
    ],
  }));
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
} finally {
  await rm(testDir, { recursive: true, force: true });
}
