"use client";

export async function transactionIdempotency(path: string, body: string) {
  const input = new TextEncoder().encode(`${path}\n${body}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const storageKey = `brick-erp-idempotency:${fingerprint}`;
  let key = sessionStorage.getItem(storageKey);
  if (!key) {
    key = crypto.randomUUID();
    sessionStorage.setItem(storageKey, key);
  }
  return { key, storageKey };
}

export function clearTransactionIdempotency(storageKey: string | undefined) {
  if (storageKey) sessionStorage.removeItem(storageKey);
}
