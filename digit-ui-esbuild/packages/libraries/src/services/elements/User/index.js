import Urls from "../../atoms/urls";
import { Request, ServiceRequest } from "../../atoms/Utils/Request";
import { Storage } from "../../atoms/Utils/Storage";
import { getAuthSurface, isIdentityBffAuth } from "../../auth/authSurface";
import { identityBffLogout, identityBffLogoutRedirect } from "../../auth/identityBffLogin";
import { currentAppBasePath, tenantContext } from "../../tenant/tenantRoute";

export const UserService = {
  authenticate: async (details) => {
    const data = new URLSearchParams();
    Object.entries(details).forEach(([key, value]) => data.append(key, value));
    data.append("scope", "read");
    data.append("grant_type", "password");

    let authResponse = await ServiceRequest({
      serviceName: "authenticate",
      url: Urls.Authenticate,
      data,
      headers: {
        authorization: `Basic ${window?.globalConfigs?.getConfig("JWT_TOKEN") || "ZWdvdi11c2VyLWNsaWVudDo="}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    const invalidRoles = window?.globalConfigs?.getConfig("INVALIDROLES") || [];
    if (invalidRoles && invalidRoles.length > 0 && authResponse && authResponse?.UserRequest?.roles?.some((role) => invalidRoles.includes(role.code))) {
      throw new Error("ES_ERROR_USER_NOT_PERMITTED");
    }
    return authResponse;
  },
  logoutUser: () => {
    let user = UserService.getUser();
    if (!user || !user.info || !user.access_token) return false;
    const { type } = user.info;
    return ServiceRequest({
      serviceName: "logoutUser",
      url: Urls.UserLogout,
      data: { access_token: user?.access_token },
      auth: true,
      params: { tenantId: type === "CITIZEN" ? Digit.ULBService.getStateId() : Digit.ULBService.getCurrentTenantId() },
    });
  },
  getType: () => {
    return Storage.get("userType") || "citizen";
  },
  setType: (userType) => {
    Storage.set("userType", userType);
    Storage.set("user_type", userType);
  },
  getUser: () => {
    return Digit.SessionStorage.get("User");
  },
  logout: async (scope = "current") => {
    // Some buttons pass the click event directly.
    if (typeof scope !== "string") scope = "current";
    if (isIdentityBffAuth()) {
      // Sign out of the BFF session for this surface only, then land on the
      // same tenant's login page for that surface.
      const surface = tenantContext()?.surface || getAuthSurface();
      const appBasePath = tenantContext()?.appBasePath || window.contextPath || currentAppBasePath();
      const fetchImpl = window.fetch.bind(window);
      // "others" keeps this session, so a failure is reported and nothing local changes.
      if (scope === "others") {
        await identityBffLogout({ surface, scope, fetchImpl });
        return;
      }
      // Fail open: the DIGIT token lives in localStorage, so a BFF outage or an
      // UNTRUSTED_ORIGIN 403 must not leave a shared device signed in. Clear local
      // state first, then revoke the BFF session best-effort.
      window.localStorage.clear();
      window.sessionStorage.clear();
      try {
        await identityBffLogout({ surface, scope, fetchImpl });
      } catch (e) {
        // The BFF session cookie may outlive this; the local DIGIT session is gone.
      } finally {
        window.location.replace(
          `${window.location.origin}${identityBffLogoutRedirect(appBasePath, surface)}`,
        );
      }
      return;
    }

    // The session's own user decides where logout lands. `userType` is one
    // key shared by both apps, so a browser that had opened any employee
    // page sent a citizen logging out to the employee language screen.
    // It stays the fallback for a session that carries no user.
    const sessionUserType = UserService.getUser()?.info?.type;
    const userType = sessionUserType ? sessionUserType.toLowerCase() : UserService.getType();
    // Capture userType BEFORE we clear storage. The redirect URL has
    // to be the explicit `/citizen/login` (not `/citizen`) — landing
    // on the bare `/citizen` after a localStorage.clear leaves the
    // App router with no userType to resolve from, and it falls back
    // to the employee language-selection screen, which is the wrong
    // "you've been logged out" landing for a citizen session.
    const logoutRedirectURL = window?.globalConfigs?.getConfig("LOGOUT_REDIRECT_URL") || `/${window?.contextPath}/${userType === "citizen" ? "citizen/login" : "employee/user/language-selection"}`;
    try {
      await UserService.logoutUser();
    } catch (e) {
    }
    finally {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.location.replace(`${window.location.origin}${logoutRedirectURL}`);
    }
  },
  sendOtp: (details, stateCode) =>
    ServiceRequest({
      serviceName: "sendOtp",
      url: Urls.OTP_Send,
      data: details,
      auth: false,
      params: { tenantId: stateCode },
    }),
  setUser: (data) => {
    return Digit.SessionStorage.set("User", data);
  },
  setExtraRoleDetails: (data) => {
    const userDetails = Digit.SessionStorage.get("User");
    return Digit.SessionStorage.set("User", { ...userDetails, extraRoleInfo: data });
  },
  getExtraRoleDetails: () => {
    return Digit.SessionStorage.get("User")?.extraRoleInfo;
  },
  registerUser: (details, stateCode) =>
    ServiceRequest({
      serviceName: "registerUser",
      url: Urls.RegisterUser,
      data: {
        User: details,
      },
      params: { tenantId: stateCode },
    }),
  updateUser: async (details, stateCode) =>
    ServiceRequest({
      serviceName: "updateUser",
      url: Urls.UserProfileUpdate,
      auth: true,
      data: {
        user: details,
      },
      params: { tenantId: stateCode },
    }),
  hasAccess: (accessTo) => {
    const user = Digit.UserService.getUser();
    if (!user || !user.info) return false;
    const { roles } = user.info;
    return roles && Array.isArray(roles) && roles.filter((role) => accessTo.includes(role.code)).length;
  },

  changePassword: (details, stateCode) =>
    ServiceRequest({
      serviceName: "changePassword",
      url: Digit.SessionStorage.get("User")?.info ? Urls.ChangePassword1 : Urls.ChangePassword,
      data: {
        ...details,
      },
      auth: true,
      params: { tenantId: stateCode },
    }),

  employeeSearch: (tenantId, filters) => {
    return Request({
      url: Urls.EmployeeSearch,
      params: { tenantId, ...filters },
      auth: true,
    });
  },
  userSearch: async (tenantId, data, filters) => {

    return ServiceRequest({
      url: Urls.UserSearch,
      params: { ...filters },
      method: "POST",
      auth: true,
      useCache: true,
      userService: true,
      data: data.pageSize ? { tenantId, ...data } : { tenantId, ...data, pageSize: "100" },
    });
  },
};
