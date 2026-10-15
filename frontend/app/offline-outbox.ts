"use client";
import { clearTransactionIdempotency } from "./idempotency";

export type OfflineExpense = {
  id: string;
  userId: string;
  key: string;
  idempotencyStorageKey?: string;
  payload: Record<string, unknown>;
  createdAt: string;
  state: "queued" | "syncing" | "needs_attention";
  message?: string;
};

export type LoadingPhotoDraft = {
  id: string;
  userId: string;
  loadingId: string;
  photoType: "before" | "during" | "after";
  contentType: "image/jpeg";
  imageBase64: string;
  idempotencyKey: string;
  createdAt: string;
};

const DB_NAME = "brick-erp-offline";
const STORE = "expense-drafts";
const REFERENCE_STORE = "reference-data";
const LOADING_PHOTO_STORE = "loading-photo-drafts";
const KEY_STORE = "encryption-keys";
type StoredRecord = { id: string; userId: string; encrypted: true; iv: ArrayBuffer; ciphertext: ArrayBuffer; cleanupKey?: string; idempotencyStorageKey?: string };
type LegacyRecord = { id: string; userId: string; value?: unknown; cleanupKey?: string; idempotencyStorageKey?: string };

export class OfflineStorageSecurityError extends Error {
  constructor() { super("OFFLINE_STORAGE_SECURITY"); this.name = "OfflineStorageSecurityError"; }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 4);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" });
      if (!request.result.objectStoreNames.contains(REFERENCE_STORE)) request.result.createObjectStore(REFERENCE_STORE, { keyPath: "id" });
      if (!request.result.objectStoreNames.contains(LOADING_PHOTO_STORE)) request.result.createObjectStore(LOADING_PHOTO_STORE, { keyPath: "id" });
      if (!request.result.objectStoreNames.contains(KEY_STORE)) request.result.createObjectStore(KEY_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function encryptionKey(userId: string, createIfMissing = true): Promise<CryptoKey> {
  if (!globalThis.crypto?.subtle) throw new OfflineStorageSecurityError();
  const stored = await transaction<{ id: string; key: CryptoKey } | undefined>(KEY_STORE, "readonly", store => store.get(userId));
  if (stored?.key) return stored.key;
  if (!createIfMissing) throw new OfflineStorageSecurityError();
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  try {
    await transaction(KEY_STORE, "readwrite", store => store.add({ id: userId, key }));
    return key;
  } catch {
    // Another tab may have initialized this user's device key at the same time.
    const raced = await transaction<{ id: string; key: CryptoKey } | undefined>(KEY_STORE, "readonly", store => store.get(userId)).catch(() => undefined);
    if (raced?.key) return raced.key;
    throw new OfflineStorageSecurityError();
  }
}

async function encryptRecord<T extends { id: string; userId: string }>(value: T, storeName: string, cleanupKey?: string): Promise<StoredRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const additionalData = new TextEncoder().encode(`${storeName}:${value.userId}:${value.id}`);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  let ciphertext: ArrayBuffer;
  try { ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, await encryptionKey(value.userId), plaintext); }
  catch { throw new OfflineStorageSecurityError(); }
  return { id: value.id, userId: value.userId, encrypted: true, iv: iv.buffer, ciphertext, ...(cleanupKey ? { cleanupKey } : {}) };
}

async function decryptRecord<T extends { id: string; userId: string }>(record: StoredRecord | LegacyRecord, storeName: string): Promise<T> {
  if ("encrypted" in record && record.encrypted === true) {
    const additionalData = new TextEncoder().encode(`${storeName}:${record.userId}:${record.id}`);
    let plaintext: ArrayBuffer;
    try { plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(record.iv), additionalData }, await encryptionKey(record.userId, false), record.ciphertext); }
    catch { throw new OfflineStorageSecurityError(); }
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  }
  // Existing unencrypted drafts are encrypted in place the first time a user opens them.
  const legacy = record as T;
  const cleanupKey = typeof record.idempotencyStorageKey === "string" ? record.idempotencyStorageKey : undefined;
  const encrypted = await encryptRecord(legacy, storeName, cleanupKey);
  await transaction(storeName, "readwrite", store => store.put(encrypted));
  return legacy;
}

async function deleteUserRecords(storeName: string, userId: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite"), store = tx.objectStore(storeName), request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const record = cursor.value as { userId?: string; cleanupKey?: string; idempotencyStorageKey?: string };
      if (record.userId === userId) {
        clearTransactionIdempotency(record.idempotencyStorageKey ?? record.cleanupKey);
        cursor.delete();
      }
      cursor.continue();
    };
    request.onerror = () => { db.close(); reject(request.error); };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Offline storage cleanup was aborted.")); };
  });
}

async function transaction<T>(name: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const request = run(tx.objectStore(name));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => { db.close(); reject(request.error); };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Offline storage transaction was aborted.")); };
  });
}

export async function listOfflineExpenses(userId: string): Promise<OfflineExpense[]> {
  const records = await transaction(STORE, "readonly", store => store.getAll()) as Array<StoredRecord | LegacyRecord>;
  return Promise.all(records.filter(record => record.userId === userId).map(record => decryptRecord<OfflineExpense>(record, STORE)));
}

export async function saveOfflineExpense(draft: OfflineExpense): Promise<void> {
  const record = await encryptRecord(draft, STORE, draft.idempotencyStorageKey);
  await transaction(STORE, "readwrite", store => store.put(record));
}

export async function deleteOfflineExpense(id: string): Promise<void> {
  const record = await transaction<StoredRecord | LegacyRecord | undefined>(STORE, "readonly", store => store.get(id));
  if (record) clearTransactionIdempotency(record.idempotencyStorageKey ?? record.cleanupKey);
  await transaction(STORE, "readwrite", store => store.delete(id));
}

export async function discardOfflineExpense(draft: OfflineExpense): Promise<void> {
  clearTransactionIdempotency(draft.idempotencyStorageKey);
  await deleteOfflineExpense(draft.id);
}

export async function clearOfflineExpenseData(userId: string): Promise<void> {
  await deleteUserRecords(STORE, userId);
  await transaction(REFERENCE_STORE, "readwrite", store => store.delete(`expense-categories:${userId}`));
  await deleteUserRecords(LOADING_PHOTO_STORE, userId);
  await transaction(KEY_STORE, "readwrite", store => store.delete(userId));
}

export async function listLoadingPhotoDrafts(userId: string): Promise<LoadingPhotoDraft[]> {
  const records = await transaction(LOADING_PHOTO_STORE, "readonly", store => store.getAll()) as Array<StoredRecord | LegacyRecord>;
  return (await Promise.all(records.filter(record => record.userId === userId).map(record => decryptRecord<LoadingPhotoDraft>(record, LOADING_PHOTO_STORE)))).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function saveLoadingPhotoDraft(draft: LoadingPhotoDraft): Promise<void> {
  const record = await encryptRecord(draft, LOADING_PHOTO_STORE);
  await transaction(LOADING_PHOTO_STORE, "readwrite", store => store.put(record));
}

export async function deleteLoadingPhotoDraft(id: string): Promise<void> {
  await transaction(LOADING_PHOTO_STORE, "readwrite", store => store.delete(id));
}

export async function clearLoadingPhotoDrafts(userId: string): Promise<void> {
  await deleteUserRecords(LOADING_PHOTO_STORE, userId);
}

export async function saveOfflineExpenseCategories<T>(userId: string, categories: T[]): Promise<void> {
  const id = `expense-categories:${userId}`;
  const record = await encryptRecord({ id, userId, categories }, REFERENCE_STORE);
  await transaction(REFERENCE_STORE, "readwrite", store => store.put(record));
}

export async function loadOfflineExpenseCategories<T>(userId: string): Promise<T[]> {
  const id = `expense-categories:${userId}`;
  const record = await transaction<StoredRecord | LegacyRecord | undefined>(REFERENCE_STORE, "readonly", store => store.get(id));
  if (!record) return [];
  if ("encrypted" in record && record.encrypted === true) {
    const decoded = await decryptRecord<{ id: string; userId: string; categories: T[] }>(record, REFERENCE_STORE);
    return decoded.categories;
  }
  const legacy = record as LegacyRecord & { value?: T[] };
  const categories = legacy.value ?? [];
  await saveOfflineExpenseCategories(userId, categories);
  return categories;
}
