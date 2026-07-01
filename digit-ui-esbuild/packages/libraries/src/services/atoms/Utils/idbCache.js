// idbCache.js
//
// Tiny promise wrapper over IndexedDB for LARGE, asynchronously-read cache
// payloads — chiefly the transformed MDMS responses (the ComplaintHierarchy tree
// can be several MB). These used to be written to localStorage via
// PersistantStorage and blew the ~5 MB quota (QuotaExceededError crashed the
// inbox). IndexedDB has GB-scale capacity.
//
// Scope is deliberately narrow: only data already fetched/read through an async
// path (MdmsService.getDataByCriteria) moves here. Small, synchronously-read keys
// (auth, locale, selected city, initData) stay in localStorage via Storage.js —
// so there is NO sync-tier / boot-hydration machinery to maintain.
//
// Key→{value,expiry} with a per-entry TTL (seconds); expired entries are dropped
// on read. Every method fails soft (null / false) so a missing or blocked
// IndexedDB never breaks a caller — it just looks like a cache miss → refetch.
// No external dependency.

const DB_NAME = "digit-ui";
const STORE_NAME = "mdms_cache";
const DEFAULT_TTL_SECS = 86400;

let dbPromise = null;

const openDB = () => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((e) => {
    dbPromise = null; // let a later call retry the open
    throw e;
  });
  return dbPromise;
};

const awaitTx = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

export const idbCache = {
  async get(key) {
    try {
      const db = await openDB();
      const entry = await new Promise((resolve, reject) => {
        const req = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      if (!entry) return null;
      if (entry.expiry && Date.now() > entry.expiry) {
        idbCache.remove(key); // fire-and-forget
        return null;
      }
      return entry.value;
    } catch {
      return null;
    }
  },

  async set(key, value, ttlSecs = DEFAULT_TTL_SECS) {
    try {
      // ttl <= 0 means "do not cache" — mirrors the multi-root-tenant path which
      // passed 0 to force a fresh fetch each time.
      if (ttlSecs != null && ttlSecs <= 0) {
        idbCache.remove(key);
        return false;
      }
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({ value, expiry: Date.now() + ttlSecs * 1000 }, key);
      await awaitTx(tx);
      return true;
    } catch {
      return false;
    }
  },

  async remove(key) {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(key);
      await awaitTx(tx);
    } catch {
      /* best-effort */
    }
  },

  async clear() {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      await awaitTx(tx);
    } catch {
      /* best-effort */
    }
  },
};

// One-time migration: the MDMS cache used to live in localStorage as
// "Digit.MDMS.*". Now that getDataByCriteria reads/writes IndexedDB, those
// entries are orphaned dead weight (this is what tipped localStorage over the
// quota). Remove them once on first load to reclaim the space. Idempotent —
// gated by a flag — and order-safe: it frees space *before* writing the flag.
const cleanupLegacyLocalStorageMdmsCache = () => {
  try {
    if (typeof localStorage === "undefined") return;
    if (localStorage.getItem("Digit.idbCache.migrated")) return;
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("Digit.MDMS.")) toRemove.push(key);
    }
    toRemove.forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    });
    try {
      localStorage.setItem("Digit.idbCache.migrated", String(Date.now()));
    } catch {
      /* flag is best-effort; worst case we sweep again next load */
    }
  } catch {
    /* best-effort */
  }
};

cleanupLegacyLocalStorageMdmsCache();

export default idbCache;
