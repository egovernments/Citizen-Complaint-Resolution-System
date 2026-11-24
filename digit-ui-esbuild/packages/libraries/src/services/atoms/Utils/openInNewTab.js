// "Open in new tab" for screens an employee works through in parallel, such as
// the inbox (#224 follow-up).
//
// Since #224 the employee login lives in the tab (sessionStorage), so a tab the
// user opens by themselves (Ctrl+click, a typed address) starts signed out. A
// tab opened by the app with window.open() is different: browsers give it a
// copy of the opening tab's sessionStorage, the same as "Duplicate tab". The
// login is carried only by this explicit action from a tab that is already
// signed in; every other new tab still asks for login.
//
// The opener link is cut straight after opening, so the new tab cannot reach
// back into this one. The copy of sessionStorage has already been made by then.

/**
 * Opens `path` (an address inside this app) in a new tab that starts with this
 * tab's login. Returns false when the browser blocked the new tab.
 */
export const openInNewTabSignedIn = (path, { win = typeof window !== "undefined" ? window : null } = {}) => {
  if (!win || typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return false;
  const opened = win.open(`${win.location.origin}${path}`, "_blank");
  if (!opened) return false;
  try {
    opened.opener = null;
  } catch (e) {
    /* some browsers make it read-only: the new tab is same-site, so this is hardening only */
  }
  return true;
};
