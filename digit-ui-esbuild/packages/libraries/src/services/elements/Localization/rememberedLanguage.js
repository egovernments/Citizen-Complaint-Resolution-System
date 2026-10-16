// The language a person picks stays with the device, not the tab: changeLanguage
// writes it here, the next visit starts in it, and signing out keeps it (it says
// nothing about who they are). The citizen and employee screens each read their
// own key, as the dashboard and the test harnesses already do; changeLanguage
// writes both, and nothing else does (signing in leaves them alone).
const CITIZEN_KEY = "Citizen.locale";
const EMPLOYEE_KEY = "Employee.locale";
export const REMEMBERED_LANGUAGE_KEYS = [CITIZEN_KEY, EMPLOYEE_KEY];

// Login code has written the literal "undefined" here before initData existed.
const LOCALE = /^[a-z]{2,3}_[A-Z]{2}$/;
export const isLocale = (value) => LOCALE.test(value || "");

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
  try {
    const locale = storage.getItem(key);
    return isLocale(locale) ? locale : null;
  } catch (e) {
    return null;
  }
};

export const rememberLanguage = (locale, storage = localStore()) => {
  if (!storage || !isLocale(locale)) return;
  try {
    REMEMBERED_LANGUAGE_KEYS.forEach((key) => storage.setItem(key, locale));
  } catch (e) {
    // Storage refused (private mode, quota): the pick still applies to this tab.
  }
};

// The first wanted language this workspace offers, else its first language, else
// the deployment default. Callers list the remembered language before the tab's
// session value: the session can hold the fallback from a workspace that did not
// offer the remembered one, and that must not stick for the rest of the tab.
export const pickLanguage = (languages, wanted = [], fallback) => {
  const offered = Array.isArray(languages) ? languages : [];
  const candidates = Array.isArray(wanted) ? wanted : [wanted];
  return candidates.find((locale) => locale && offered.some((language) => language?.value === locale)) || offered[0]?.value || fallback;
};

// The language a workspace opens in: the remembered one, then this tab's, then the
// workspace's first, then the deployment default.
export const openingLanguage = (languages, session, fallback, storage = localStore(), pathname = window.location.pathname) =>
  pickLanguage(languages, [rememberedLanguage(storage, pathname), session], fallback);
