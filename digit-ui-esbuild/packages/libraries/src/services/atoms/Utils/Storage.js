const localStoreSupport = () => {
  try {
    return "sessionStorage" in window && window["sessionStorage"] !== null;
  } catch (e) {
    return false;
  }
};

const k = (key) => `Digit.${key}`;
const getStorage = (storageClass) => ({
  get: (key) => {
    if (localStoreSupport() && key) {
      let valueInStorage = storageClass.getItem(k(key));
      if (!valueInStorage || valueInStorage === "undefined") {
        return null;
      }
      const item = JSON.parse(valueInStorage);
      if (Date.now() > item.expiry) {
        storageClass.removeItem(k(key));
        return null;
      }
      return item.value;
    } else if (typeof window !== "undefined") {
      return window?.eGov?.Storage && window.eGov.Storage[k(key)] ? window.eGov.Storage[k(key)].value : null;
    } else {
      return null;
    }
  },
  set: (key, value, ttl = 86400) => {
    const item = {
      value,
      ttl,
      expiry: Date.now() + ttl * 1000,
    };
    if (localStoreSupport()) {
      try {
        storageClass.setItem(k(key), JSON.stringify(item));
      } catch (e) {
        // Never crash on a full/blocked store. Large async-read payloads (MDMS /
        // ComplaintHierarchy) live in IndexedDB now (idbCache); this guards any
        // other oversize sync write — skip persisting (the value re-derives on
        // next load) instead of throwing QuotaExceededError.
        if (typeof console !== "undefined") {
          console.warn(`Digit.Storage: "${key}" not persisted (${e && e.name ? e.name : "write failed"}).`);
        }
      }
    } else if (typeof window !== "undefined") {
      window.eGov = window.eGov || {};
      window.eGov.Storage = window.eGov.Storage || {};
      window.eGov.Storage[k(key)] = item;
    }
  },
  del: (key) => {
    if (localStoreSupport()) {
      storageClass.removeItem(k(key));
    } else if (typeof window !== "undefined") {
      window.eGov = window.eGov || {};
      window.eGov.Storage = window.eGov.Storage || {};
      delete window.eGov.Storage[k(key)];
    }
  },
});

export const Storage = getStorage(window.sessionStorage);
export const PersistantStorage = getStorage(window.localStorage);
