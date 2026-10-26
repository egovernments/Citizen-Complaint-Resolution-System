/* set employee details to enable backward compatiable */
// The remembered language (Employee.locale / Citizen.locale) is left alone here:
// only a language the person picks is remembered, and the language at sign-in can
// be the fallback of a workspace that does not offer the remembered one.
export const setEmployeeDetail = (userObject, token) => {
  if (Digit.Utils.getMultiRootTenant() && process.env.NODE_ENV !== "development") return;
  const locale = Digit.StoreData.getCurrentLanguage();
  localStorage.setItem("Employee.tenant-id", userObject?.tenantId);
  localStorage.setItem("tenant-id", userObject?.tenantId);
  localStorage.setItem("citizen.userRequestObject", JSON.stringify(userObject));
  localStorage.setItem("locale", locale);
  localStorage.setItem("token", token);
  localStorage.setItem("Employee.token", token);
  localStorage.setItem("user-info", JSON.stringify(userObject));
  localStorage.setItem("Employee.user-info", JSON.stringify(userObject));
};
