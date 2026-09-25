import { useTranslation } from "react-i18next";
import { insertModuleSections, isCitizenHome } from "./navSections";

const iconOf = (icon) => ({ icon, width: "1.5rem", height: "1.5rem" });

/**
 * The citizen's navigation rows, in the same shape the employee rail uses, so
 * the desktop rail and the phone drawer render them alike.
 *
 * Home, then each enabled module's section (the complaints module registers
 * `PGRCitizenSidebarSection`, the citizen twin of `PGRSidebarSection`), then
 * Helpline, and Login for a visitor who is not signed in. Edit Profile and
 * Logout are not rows here: on desktop they live in the top bar's account
 * menu, as they do for employees, and the phone drawer adds its own.
 */
export const useCitizenNavItems = () => {
  const { t } = useTranslation();
  const { data: initData } = Digit.Hooks.useStore.getInitData();
  const contextPath = window?.contextPath;
  const signedIn = !!Digit.UserService.getUser()?.access_token;

  // The tenant's own helpline. The old sidebar fell back to the first tenant
  // in the list when the citizen's had none, which on a tenant with test
  // cities meant a placeholder number, or a "Helpline" row that dialled
  // nothing. Only the citizen's tenant, or the state's, and no row without
  // a number.
  const tenants = initData?.tenants || [];
  const ownCodes = [Digit.ULBService.getCurrentTenantId?.(), Digit.ULBService.getStateId?.()];
  const helpline = ownCodes.map((code) => tenants.find((tenant) => tenant.code === code)?.contactNumber).find(Boolean);

  const base = [
    {
      key: "home",
      label: t("COMMON_BOTTOM_NAVIGATION_HOME"),
      icon: iconOf("Home"),
      navigationUrl: `/${contextPath}/citizen/all-services`,
    },
    // The number itself is part of the row, as it was on the old sidebar, so
    // the citizen can read it off as well as tap it.
    ...(helpline
      ? [{ key: "helpline", label: `${t("CS_COMMON_HELPLINE")} ${helpline}`, icon: iconOf("Call"), navigationUrl: `tel:${helpline}` }]
      : []),
    ...(signedIn
      ? []
      : [{ key: "login", label: t("CORE_COMMON_LOGIN"), icon: iconOf("Login"), navigationUrl: `/${contextPath}/citizen/login` }]),
  ];

  const sections = (initData?.modules || [])
    .map(({ code }) => Digit.ComponentRegistryService.getComponent(`${code}CitizenSidebarSection`))
    .filter((getSection) => typeof getSection === "function")
    .map((getSection) => getSection(t));

  return { items: insertModuleSections(base, sections, isCitizenHome) };
};
