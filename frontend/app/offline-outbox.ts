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

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 3);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" });
      if (!request.result.objectStoreNames.contains(REFERENCE_STORE)) request.result.createObjectStore(REFERENCE_STORE, { keyPath: "id" });
      if (!request.result.objectStoreNames.contains(LOADING_PHOTO_STORE)) request.result.createObjectStore(LOADING_PHOTO_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
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
  const drafts = await transaction(STORE, "readonly", store => store.getAll()) as OfflineExpense[];
  return drafts.filter(draft => draft.userId === userId);
}

export async function saveOfflineExpense(draft: OfflineExpense): Promise<void> {
  await transaction(STORE, "readwrite", store => store.put(draft));
}

export async function deleteOfflineExpense(id: string): Promise<void> {
  const draft = await transaction<OfflineExpense | undefined>(STORE, "readonly", store => store.get(id));
  if (draft) clearTransactionIdempotency(draft.idempotencyStorageKey);
  await transaction(STORE, "readwrite", store => store.delete(id));
}

export async function discardOfflineExpense(draft: OfflineExpense): Promise<void> {
  clearTransactionIdempotency(draft.idempotencyStorageKey);
  await deleteOfflineExpense(draft.id);
}

export async function clearOfflineExpenseData(userId: string): Promise<void> {
  const drafts = await listOfflineExpenses(userId);
  await Promise.all(drafts.map(draft => deleteOfflineExpense(draft.id)));
  await transaction(REFERENCE_STORE, "readwrite", store => store.delete(`expense-categories:${userId}`));
  await clearLoadingPhotoDrafts(userId);
}

export async function listLoadingPhotoDrafts(userId: string): Promise<LoadingPhotoDraft[]> {
  const drafts = await transaction(LOADING_PHOTO_STORE, "readonly", store => store.getAll()) as LoadingPhotoDraft[];
  return drafts.filter(draft => draft.userId === userId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function saveLoadingPhotoDraft(draft: LoadingPhotoDraft): Promise<void> {
  await transaction(LOADING_PHOTO_STORE, "readwrite", store => store.put(draft));
}

export async function deleteLoadingPhotoDraft(id: string): Promise<void> {
  await transaction(LOADING_PHOTO_STORE, "readwrite", store => store.delete(id));
}

export async function clearLoadingPhotoDrafts(userId: string): Promise<void> {
  const drafts = await listLoadingPhotoDrafts(userId);
  await Promise.all(drafts.map(draft => deleteLoadingPhotoDraft(draft.id)));
}

export async function saveOfflineExpenseCategories<T>(userId: string, categories: T[]): Promise<void> {
  await transaction(REFERENCE_STORE, "readwrite", store => store.put({ id: `expense-categories:${userId}`, value: categories }));
}

export async function loadOfflineExpenseCategories<T>(userId: string): Promise<T[]> {
  const record = await transaction<{ id: string; value: T[] } | undefined>(REFERENCE_STORE, "readonly", store => store.get(`expense-categories:${userId}`));
  return record?.value ?? [];
}
