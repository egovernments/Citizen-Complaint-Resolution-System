// The language a person picks stays with the device, not the tab: changeLanguage
// writes it here, the next visit starts in it, and signing out keeps it (it says
// nothing about who they are). The citizen and employee screens each read their
// own key, as the dashboard and the test harnesses already do; changeLanguage
// writes both.
const CITIZEN_KEY = "Citizen.locale";
const EMPLOYEE_KEY = "Employee.locale";
const KEYS = [CITIZEN_KEY, EMPLOYEE_KEY];

// Login code has written the literal "undefined" here before initData existed.
const LOCALE = /^[a-z]{2,3}_[A-Z]{2}$/;

const localStore = () => {
  try {
    return window.localStorage;
  } catch (e) {
    return null;
  }
};

export const rememberedLanguage = (storage = localStore(), pathname = window.location.pathname) => {
  if (!storage) return null;
  const key = pathname.split("/").includes("employee") ? EMPLOYEE_KEY : CITIZEN_KEY;
  const locale = storage.getItem(key);
  return LOCALE.test(locale || "") ? locale : null;
};

export const rememberLanguage = (locale, storage = localStore()) => {
  if (!storage || !LOCALE.test(locale || "")) return;
  KEYS.forEach((key) => storage.setItem(key, locale));
};

// The remembered language if this workspace offers it, else the workspace's first.
export const pickLanguage = (languages = [], wanted) =>
  languages.some((language) => language?.value === wanted) ? wanted : languages[0]?.value;

// Runs a storage wipe (sign-out, expired session) without losing the language.
export const keepRememberedLanguage = (clear, storage = localStore()) => {
  const kept = storage ? KEYS.map((key) => [key, storage.getItem(key)]) : [];
  clear();
  kept.forEach(([key, locale]) => {
    if (LOCALE.test(locale || "")) storage.setItem(key, locale);
  });
};
