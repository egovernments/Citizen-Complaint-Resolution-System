import Urls from "../../atoms/urls";
import { PersistantStorage } from "../../atoms/Utils/Storage";
import i18next from "i18next";
import { Request } from "../../atoms/Utils/Request";
import { ApiCacheService } from "../../atoms/ApiCacheService";

const LOCALE_LIST = (locale) => `Locale.${locale}.List`;
const LOCALE_ALL_LIST = () => `Locale.List`;
const LOCALE_MODULE = (locale, module) => `Locale.${locale}.${module}`;

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
    // City overlay: modules are loaded at the STATE tenant, but data
    // onboarding seeds label keys at the LOGGED-IN city tenant
    // (COMPLAINT_HIERARCHY.*, COMMON_MASTERS_DEPARTMENT_*, boundary level
    // headings, …) — those never loaded, so employee screens rendered raw
    // codes. Fetch the same modules at the current tenant and let the city
    // copy win per code (a city can override a state label, and the state
    // set — often newer — fills everything the city copy lacks).
    // Best-effort: a city fetch failure must never break the load.
    const cityTenant = (() => {
      try { return Digit.ULBService.getCurrentTenantId(); } catch (e) { return null; }
    })();
    const wantCityOverlay = !!cityTenant && cityTenant !== tenantId && String(cityTenant).includes(".");
    const CITY_MARK = (module) => `Locale.${locale}.${module}.__city`;

    const [newModules, messages] = LocalizationStore.get(locale, modules);

    // Back-fill: modules cached BEFORE a city tenant was known (the bootstrap
    // set — rainmaker-common etc. — loads on the LOGIN page, where no city
    // exists yet) never got the overlay, so city-seeded keys like the
    // department names stayed unresolved. Re-fetch just the CITY copy for any
    // cached module whose overlay marker doesn't match the current city.
    const overlayPending = wantCityOverlay
      ? modules.filter((m) => !newModules.includes(m) && LocalizationStore.getCaheData(CITY_MARK(m)) !== cityTenant)
      : [];

    if (newModules.length > 0) {
      const [data, cityData] = await Promise.all([
        Request({ url: Urls.localization, params: { module: newModules.join(","), locale, tenantId }, useCache: false }),
        wantCityOverlay
          ? Request({ url: Urls.localization, params: { module: newModules.join(","), locale, tenantId: cityTenant }, useCache: false }).catch(() => null)
          : Promise.resolve(null),
      ]);
      let merged = data.messages;
      if (cityData?.messages?.length) {
        const cityCodes = new Set(cityData.messages.map((m) => m.code));
        merged = [...merged.filter((m) => !cityCodes.has(m.code)), ...cityData.messages];
      }
      messages.push(...merged);
      setTimeout(() => {
        LocalizationStore.store(locale, newModules, merged);
        if (wantCityOverlay) newModules.forEach((m) => LocalizationStore.setCacheData(CITY_MARK(m), cityTenant));
      }, 100);
    }

    if (overlayPending.length > 0) {
      const cityData = await Request({
        url: Urls.localization,
        params: { module: overlayPending.join(","), locale, tenantId: cityTenant },
        useCache: false,
      }).catch(() => null);
      if (cityData?.messages?.length) {
        // Later entries win in updateResources' reduce — pushing the city copy
        // after the cached state copy overrides per code.
        messages.push(...cityData.messages);
        // Persist the merge so future cache hits include the city keys.
        setTimeout(() => {
          overlayPending.forEach((m) => {
            const cityForModule = cityData.messages.filter((msg) => msg.module === m);
            if (cityForModule.length === 0) return;
            const cached = LocalizationStore.getCaheData(LOCALE_MODULE(locale, m)) || [];
            const cityCodes = new Set(cityForModule.map((msg) => msg.code));
            LocalizationStore.setCacheData(LOCALE_MODULE(locale, m), [
              ...cached.filter((msg) => !cityCodes.has(msg.code)),
              ...cityForModule,
            ]);
          });
        }, 100);
      }
      // Mark even on empty results so a city without extra keys isn't re-queried
      // on every call.
      setTimeout(() => overlayPending.forEach((m) => LocalizationStore.setCacheData(CITY_MARK(m), cityTenant)), 100);
    }

    LocalizationStore.updateResources(locale, messages);
    return messages;
  },
  getUpdatedMessages: async ({ modules = [], locale = Digit.Utils.getDefaultLanguage(), tenantId }) => {
    const [module, messages] = LocalizationStore.get(locale, modules);
    const data = await Request({ url: Urls.localization, params: { module: modules.join(","), locale, tenantId }, useCache: false });
    const uniques = getUniqueData(messages,data.messages);
    messages.push(...uniques);
    setTimeout(() => LocalizationStore.store(locale, modules, uniques), 100);
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
