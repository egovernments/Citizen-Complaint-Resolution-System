import { Request } from "../atoms/Utils/Request";
import { Storage } from "../atoms/Utils/Storage";
import { LoginService } from "./Login";
import { getAuthAdapter } from "../auth/index";

export const UserService = {
  getUser() {
    return Storage.get("User");
  },

  getType() {
    return Storage.get("userType") || "citizen";
  },

  setType(userType) {
    Storage.set("userType", userType);
    Storage.set("user_type", userType);
  },

  hasAccess(roles = []) {
    if (typeof roles === "string") roles = [roles];
    if (!Array.isArray(roles)) return false;
    const user = this.getUser();
    if (!user?.info?.roles) return false;
    const userRoles = user.info.roles.map((r) => r.code);
    return roles.some((role) => userRoles.includes(role));
  },

  setUser(user) {
    Storage.set("User", user);
  },

  async authenticate(details, stateCode) {
    const authProvider = window?.globalConfigs?.getConfig("AUTH_PROVIDER");
    if (authProvider === "keycloak") {
      const adapter = getAuthAdapter();
      if (adapter) {
        const result = await adapter.login({
          email: details.username,
          password: details.password,
          tenantId: details.tenantId || stateCode,
        });
        // Transform to format expected by core module login page:
        // { UserRequest: {...}, access_token, token }
        return {
          UserRequest: {
            uuid: result.user?.uuid,
            userName: result.user?.email || details.username,
            name: result.user?.name,
            emailId: result.user?.email,
            tenantId: result.user?.tenantId,
            type: result.user?.type,
            roles: result.user?.roles || [],
          },
          access_token: result.token,
          token: result.token,
        };
      }
    }
    // Fall back to DIGIT native auth
    const response = await LoginService.authenticate(details, stateCode);
    return response.data;
  },

  async userSearch(tenantId, filters = {}, config = {}) {
    const response = await Request({
      url: Digit.Hooks?.getUrl?.("user-search") || "/user/_search",
      useCache: false,
      method: "POST",
      auth: true,
      userService: true,
      params: { tenantId },
      body: { ...filters },
    });
    return response;
  },

  async employeeSearch(tenantId, filters = {}) {
    const response = await Request({
      url: Digit.Hooks?.getUrl?.("employee-search") || "/egov-hrms/employees/_search",
      useCache: false,
      method: "POST",
      auth: true,
      userService: true,
      params: { tenantId, ...filters },
    });
    return response;
  },
};
