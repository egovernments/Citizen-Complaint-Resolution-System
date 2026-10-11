import Urls from "../../atoms/urls";
import { PersistantStorage } from "../../atoms/Utils/Storage";
import i18next from "i18next";
import { Request } from "../../atoms/Utils/Request";
import { ApiCacheService } from "../../atoms/ApiCacheService";

// #941 node labels: labels are asked for at the tenant the user works at (an employee's tenant, a citizen's home city),
// when it lies below the tenant the caller passed (the state code); ccrs-compat merges that tenant's chain per key,
// nearest first. The browser cache is kept per label tenant (`scope`), so another tenant never reads this one's bundle.
let scope = "";
const scoped = () => (scope ? `${scope}.` : "");
const LOCALE_LIST = (locale) => `Locale.${scoped()}${locale}.List`;
const LOCALE_ALL_LIST = () => `Locale.${scoped()}List`;
const LOCALE_MODULE = (locale, module) => `Locale.${scoped()}${locale}.${module}`;

const labelTenant = (stateTenant) => {
  try {
    const user = Digit.UserService?.getUser?.();
    const own =
      user?.info?.type === "EMPLOYEE"
        ? Digit.SessionStorage.get("Employee.tenantId") || user?.info?.tenantId
        : Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code;
    if (own && stateTenant && String(own).startsWith(`${stateTenant}.`)) return String(own);
  } catch (e) {
    // no user / storage yet: the tenant asked for
  }
  return stateTenant || "";
};

// Run `fn` with the cache keys of `sc` (a write scheduled under one scope lands in that scope's keys).
const inScope = (sc, fn) => {
  const prev = scope;
  scope = sc;
  try {
    return fn();
  } finally {
    scope = prev;
  }
};

// Every module this page asked for, and the (scope, locale) pairs already revalidated on this page load.
const asked = new Set();
const revalidated = new Set();

const TransformArrayToObj = (traslationList) => {
  return traslationList.reduce(
    // eslint-disable-next-line
    (obj, item) => ((obj[item.code] = item.message), obj),
    {}
  );
  // return trasformedTraslation;
};

const getUnique = (arr) => {
  return arr.filter((value, index, self) => self.indexOf(value) === index);
};

const LocalizationStore = {
  getCaheData: (key) => PersistantStorage.get(key),
  setCacheData: (key, value) => {
    const cacheSetting = ApiCacheService.getSettingByServiceUrl(Urls.localization);
    PersistantStorage.set(key, value, cacheSetting.cacheTimeInSecs);
  },
  getList: (locale) => LocalizationStore.getCaheData(LOCALE_LIST(locale)) || [],
  setList: (locale, namespaces) => LocalizationStore.setCacheData(LOCALE_LIST(locale), namespaces),
  getAllList: () => LocalizationStore.getCaheData(LOCALE_ALL_LIST()) || [],
  setAllList: (namespaces) => LocalizationStore.setCacheData(LOCALE_ALL_LIST(), namespaces),
  store: (locale, modules, messages) => {
    const AllNamespaces = LocalizationStore.getAllList();
    const Namespaces = LocalizationStore.getList(locale);
    modules.forEach((module) => {
      if (!Namespaces.includes(module)) {
        Namespaces.push(module);
        const moduleMessages = messages.filter((message) => message.module === module);
        LocalizationStore.setCacheData(LOCALE_MODULE(locale, module), moduleMessages);
      }
    });
    LocalizationStore.setCacheData(LOCALE_LIST(locale), Namespaces);
    LocalizationStore.setAllList(getUnique([...AllNamespaces, ...Namespaces]));
  },
  get: (locale, modules) => {
    const storedModules = LocalizationStore.getList(locale);
    // Partition stored modules by whether their per-module cache is still alive.
    // The LOCALE_LIST and per-LOCALE_MODULE entries share the same cacheTimeInSecs
    // but are stored separately, so on slow-expiry boundaries the list can outlive
    // the data — reading a dead entry used to spread null (=> TypeError) and took
    // down digitInitData entirely. Treat an expired entry as a cache miss and
    // rebuild the list without it so the next fetch re-populates.
    const liveStored = [];
    const expiredStored = [];
    const messages = [];
    storedModules.forEach((module) => {
      const cached = LocalizationStore.getCaheData(LOCALE_MODULE(locale, module));
      if (cached) {
        liveStored.push(module);
        messages.push(...cached);
      } else {
        expiredStored.push(module);
      }
    });
    if (expiredStored.length > 0) {
      LocalizationStore.setList(locale, liveStored);
    }
    const newModules = modules.filter((module) => !liveStored.includes(module));
    if (Digit.Utils.getMultiRootTenant() && !liveStored.includes("digit-tenants") && !newModules.includes("digit-tenants")) {
      newModules.push("digit-tenants");
    }
    return [newModules, messages];
  },

  updateResources: (locale, messages) => {
    let locales = TransformArrayToObj(messages);
    i18next.addResources(locale, "translations", locales);
  },
};

function getUniqueData(data1, data2) {
  const data1Codes = new Set(data1.map(item => item.code));
  return data2.filter(item => !data1Codes.has(item.code));
}

export const LocalizationService = {
  getLocale: async ({ modules = [], locale = Digit.Utils.getDefaultLanguage(), tenantId }) => {
    // Earlier code appended `globalConfigs.LOCALE_REGION` (default "IN")
    // whenever the given locale didn't already contain it. On Nai Pepea
    // (region still "IN", locales en_IN + sw_KE) this turned "sw_KE" into
    // "sw_KEIN" — the fetch then returned 0 messages and i18next silently
    // fell back to en_IN, so picking Swahili in the UI did nothing.
    // Locale codes already carry their region (xx_YY), so the append is
    // never correct. Drop it.
    const tenant = labelTenant(tenantId);
    if (tenant !== scope) {
      // the user's label tenant changed (signed in at a node, picked a home city): reload what the page already has
      if (scope) modules = getUnique([...modules, ...asked]);
      scope = tenant;
    }
    modules.forEach((m) => asked.add(m));
    const sc = scope;
    const [newModules, messages] = LocalizationStore.get(locale, modules);
    if (newModules.length > 0) {
      const data = await Request({ url: Urls.localization, params: { module: newModules.join(","), locale, tenantId: tenant }, useCache: false });
      messages.push(...data.messages);
      setTimeout(() => inScope(sc, () => LocalizationStore.store(locale, newModules, data.messages)), 100);
    }
    // a bundle served from the browser cache (kept for a day) is revalidated once per page load: a label changed since
    // is shown as soon as it arrives (i18next bindI18nStore "added" re-renders), not a day later
    const cachedModules = modules.filter((m) => !newModules.includes(m));
    const key = `${sc}|${locale}`;
    if (cachedModules.length && !revalidated.has(key)) {
      revalidated.add(key);
      Request({ url: Urls.localization, params: { module: cachedModules.join(","), locale, tenantId: tenant }, useCache: false })
        .then((data) => {
          const fresh = data?.messages || [];
          inScope(sc, () =>
            cachedModules.forEach((m) => LocalizationStore.setCacheData(LOCALE_MODULE(locale, m), fresh.filter((x) => x.module === m)))
          );
          if (sc === scope) LocalizationStore.updateResources(locale, fresh);
        })
        .catch(() => {});
    }
    LocalizationStore.updateResources(locale, messages);
    return messages;
  },
  getUpdatedMessages: async ({ modules = [], locale = Digit.Utils.getDefaultLanguage(), tenantId }) => {
    const [module, messages] = LocalizationStore.get(locale, modules);
    const sc = scope;
    const data = await Request({ url: Urls.localization, params: { module: modules.join(","), locale, tenantId: labelTenant(tenantId) }, useCache: false });
    const uniques = getUniqueData(messages,data.messages);
    messages.push(...uniques);
    setTimeout(() => inScope(sc, () => LocalizationStore.store(locale, modules, uniques)), 100);
    LocalizationStore.updateResources(locale, messages);
    return messages;
  },
  changeLanguage: (locale, tenantId) => {
    const modules = LocalizationStore.getList(locale);
    const allModules = LocalizationStore.getAllList();
    const uniqueModules = allModules.filter((module) => !modules.includes(module));
    LocalizationService.getLocale({ modules: uniqueModules, locale, tenantId });
    localStorage.setItem("Employee.locale", locale);
    localStorage.setItem("Citizen.locale", locale);
    Digit.SessionStorage.set("locale", locale);
    i18next.changeLanguage(locale);
  },
  updateResources: (locale = Digit.Utils.getDefaultLanguage(), messages) => {
    // Mirrors getLocale — see note there.
    LocalizationStore.updateResources(locale, messages);
  },
};
