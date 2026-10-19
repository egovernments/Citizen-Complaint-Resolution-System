import { REMEMBERED_LANGUAGE_KEYS, isLocale } from "../../elements/Localization/rememberedLanguage";

/** Set by the Configurator (same origin) when its own sign-out could not be confirmed. */
export const CONFIGURATOR_SIGN_OUT_INCOMPLETE_KEY = "crs-sign-out-incomplete";

// What a localStorage wipe keeps: facts about the device, not about who is signed
// in. The remembered language, and the Configurator's flag that stops its login
// page reusing a session whose sign-out was never confirmed.
const DEVICE_KEYS = [...REMEMBERED_LANGUAGE_KEYS, CONFIGURATOR_SIGN_OUT_INCOMPLETE_KEY];

const localStore = () => {
  try {
    return window.localStorage;
  } catch (e) {
    return null;
  }
};

const read = (storage, key) => {
  try {
    return storage.getItem(key);
  } catch (e) {
    return null;
  }
};

// Runs clear() and puts the given keys back as they were (those keep() accepts).
export const keepKeys = (keys, clear, storage = localStore(), keep = (key, value) => value !== null) => {
  const kept = storage ? keys.map((key) => [key, read(storage, key)]) : [];
  clear();
  kept.forEach(([key, value]) => {
    if (!keep(key, value)) return;
    try {
      storage.setItem(key, value);
    } catch (e) {
      // Storage refused the write; the wipe itself has happened.
    }
  });
};

// Every sign-out, expired-session and broken-link path wipes localStorage through
// this, so none of them loses the device's preferences.
// Junk in a language key (old login code wrote "undefined") is dropped, not kept.
export const clearLocalStorage = (storage = localStore()) => {
  if (!storage) return;
  keepKeys(DEVICE_KEYS, () => storage.clear(), storage, (key, value) =>
    value !== null && (!REMEMBERED_LANGUAGE_KEYS.includes(key) || isLocale(value)));
};
