const USER_ID_KEY = "brick-erp-offline-user-id";
const SESSION_FINGERPRINT_KEY = "brick-erp-offline-session-fingerprint";

function fingerprint(token: string) {
  return `${token.length}:${token.slice(0, 12)}:${token.slice(-12)}`;
}

/** Bind encrypted offline records to the exact authenticated browser session. */
export function bindOfflineUserToSession(token: string, userId: string) {
  if (!token || !userId) return;
  try {
    sessionStorage.setItem(USER_ID_KEY, userId);
    sessionStorage.setItem(SESSION_FINGERPRINT_KEY, fingerprint(token));
  } catch {
    // Offline recovery is unavailable when this tab cannot persist session storage.
  }
}

/** Return a cached identity only when it belongs to the current signed-in session. */
export function offlineUserForSession(token: string | null) {
  if (!token) return "";
  try {
    const userId = sessionStorage.getItem(USER_ID_KEY) ?? "";
    const boundSession = sessionStorage.getItem(SESSION_FINGERPRINT_KEY);
    return userId && boundSession === fingerprint(token) ? userId : "";
  } catch {
    return "";
  }
}
