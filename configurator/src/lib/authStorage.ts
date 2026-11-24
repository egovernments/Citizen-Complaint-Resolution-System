/**
 * Where the configurator keeps its login (token, user, tenant, onboarding
 * phase): THIS browser tab only (sessionStorage), like digit-ui's employee and
 * citizen logins (#224, VAPT "Insecure Session Management").
 *
 * Older builds kept it in localStorage, which every tab shares and which
 * survives closing the browser, so an admin's token outlived the session and
 * any script on the site could read it. On start-up such a copy is moved into
 * this tab once and deleted, so an operator working when the update lands is
 * not thrown out, and no copy outlives the first page load after it. Closing
 * the tab then ends the login; a new tab asks for it again.
 */
export const AUTH_STORAGE_KEY = 'crs-auth-state';

/** Reads this tab's saved login (raw JSON), adopting an older build's copy once. */
export function readSavedAuth(): string | null {
  try {
    const legacy = localStorage.getItem(AUTH_STORAGE_KEY);
    if (legacy !== null) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      if (sessionStorage.getItem(AUTH_STORAGE_KEY) === null) sessionStorage.setItem(AUTH_STORAGE_KEY, legacy);
    }
  } catch {
    /* storage blocked: nothing to move */
  }
  try {
    return sessionStorage.getItem(AUTH_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Saves this tab's login. Never throws: a full or blocked store must not break the app. */
export function saveAuth(json: string): void {
  try {
    sessionStorage.setItem(AUTH_STORAGE_KEY, json);
  } catch {
    /* storage blocked: the login lasts until reload */
  }
}

/** Removes the login from this tab, and any copy an older build left behind. */
export function clearSavedAuth(): void {
  for (const store of [sessionStorage, localStorage]) {
    try {
      store.removeItem(AUTH_STORAGE_KEY);
    } catch {
      /* storage blocked: nothing to remove */
    }
  }
}
