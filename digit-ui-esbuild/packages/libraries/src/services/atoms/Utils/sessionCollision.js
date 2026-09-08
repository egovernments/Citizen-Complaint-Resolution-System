// Detects when ANOTHER browser tab has signed in as a DIFFERENT user of the
// same type, so the UI can say so instead of letting identities cross over
// silently.
//
// Why this can happen at all: the platform keeps the active session per TAB
// (sessionStorage) but writes the shared keys `Employee.token` /
// `Citizen.token` (+ user-info) under FIXED names in localStorage, which every
// tab shares. Two employees in one browser therefore leave the shared keys
// holding whoever logged in last; a tab keeps its own identity across reloads
// (per-tab session), but adopts the newer one whenever its own session is
// missing or expired — a new tab, or a stale one past the session TTL.
// Employee + citizen never collide (different key prefixes), and the same
// person in two tabs never collides (same uuid).
//
// Detection only — nothing here logs anyone out or mutates a session. The
// user decides what to do, so an in-progress complaint is never destroyed.

const KEYS = {
  EMPLOYEE: { token: "Employee.token", info: "Employee.user-info" },
  CITIZEN: { token: "Citizen.token", info: "Citizen.user-info" },
};

const parse = (raw) => {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
};

const surfaceOf = (user, pathname = window.location.pathname) => {
  const type = String(user?.info?.type || "").toUpperCase();
  if (type === "EMPLOYEE" || type === "CITIZEN") return type;
  return pathname.split("/").includes("employee") ? "EMPLOYEE" : "CITIZEN";
};

/**
 * @returns {{uuid: string, name: string} | null} the OTHER user now owning the
 * shared keys, or null when there is no collision (no session, no shared keys,
 * same user, or a different surface). The uuid lets callers remember that this
 * particular collision was already acknowledged.
 */
export const detectSessionCollision = () => {
  try {
    const mine = window.Digit?.UserService?.getUser?.();
    const myUuid = mine?.info?.uuid;
    if (!mine || !myUuid) return null; // not signed in here: nothing to cross over

    const keys = KEYS[surfaceOf(mine)];
    if (!keys) return null;

    const sharedInfo = parse(window.localStorage.getItem(keys.info));
    const sharedUuid = sharedInfo?.uuid;
    // No shared record, or it is still ours → no collision. An unknown uuid is
    // treated as no collision: better silent than a popup we cannot justify.
    if (!sharedUuid || sharedUuid === myUuid) return null;

    return {
      uuid: sharedUuid,
      name: sharedInfo?.name || sharedInfo?.userName || sharedInfo?.mobileNumber || "another user",
    };
  } catch (e) {
    return null; // detection must never break the app
  }
};

/**
 * Calls back when another tab signs in as a different user of the same type.
 * Uses the browser's own cross-tab `storage` event — no polling, and it only
 * fires in the OTHER tabs, which is exactly the audience for this message.
 *
 * @returns {() => void} unsubscribe
 */
export const onSessionCollision = (callback) => {
  const handler = (event) => {
    if (event?.key && !event.key.startsWith("Employee.") && !event.key.startsWith("Citizen.")) return;
    const other = detectSessionCollision();
    if (other) callback(other);
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
};
