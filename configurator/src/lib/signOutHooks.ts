/**
 * What else a sign-out on this device forgets: work held in this tab's memory
 * that the next person to sign in here mustn't be handed. Kept free of imports
 * so any module can register without pulling the session code in with it.
 */
const hooks = new Set<() => void>();

/** Runs `hook` on every sign-out from this device. Returns the unregister. */
export function onSignOut(hook: () => void): () => void {
  hooks.add(hook);
  return () => {
    hooks.delete(hook);
  };
}

/** Called by signOutThisDevice. One hook failing doesn't skip the rest. */
export function runSignOutHooks(): void {
  for (const hook of hooks) {
    try {
      hook();
    } catch {
      // In-memory teardown only; sign-out goes on.
    }
  }
}
