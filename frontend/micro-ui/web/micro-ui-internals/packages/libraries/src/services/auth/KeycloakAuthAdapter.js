import { AuthAdapter } from "./AuthAdapter";

// keycloak-js is loaded from CDN via <script> tag in index.html
// Available as window.Keycloak
function getKeycloakConstructor() {
  if (typeof window !== "undefined" && window.Keycloak) return window.Keycloak;
  throw new Error("keycloak-js not loaded. Ensure the CDN script is in index.html.");
}

// Decode JWT payload without keycloak-js re-init
function b64decode(str) {
  let b = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  return JSON.parse(atob(b));
}

export class KeycloakAuthAdapter extends AuthAdapter {
  constructor() {
    super();
    this._kc = null;
    this._user = null;
    this._tokenExchangeUrl = null;
    this._tenantId = null;
    this._digitUserType = null;
    this._digitRoles = null;
  }

  async init() {
    const kcUrl = window?.globalConfigs?.getConfig("KEYCLOAK_URL");
    const realm = window?.globalConfigs?.getConfig("KEYCLOAK_REALM");
    const clientId = window?.globalConfigs?.getConfig("KEYCLOAK_CLIENT_ID");
    this._tokenExchangeUrl = window?.globalConfigs?.getConfig("TOKEN_EXCHANGE_URL");

    const Keycloak = getKeycloakConstructor();
    this._kc = new Keycloak({ url: kcUrl, realm, clientId });

    try {
      const contextPath = window?.contextPath || "digit-ui";
      const authenticated = await this._kc.init({
        onLoad: "check-sso",
        pkceMethod: "S256",
        silentCheckSsoRedirectUri: window.location.origin + "/" + contextPath + "/silent-check-sso.html",
      });

      console.log("[KC-AUTH] init: authenticated=" + authenticated + " pathname=" + window.location.pathname);
      if (authenticated) {
        await this._loadUserFromToken();
        console.log("[KC-AUTH] init: user=" + JSON.stringify(this._user?.type) + " roles=" + JSON.stringify(this._user?.roles?.map(r=>r.code)));
        if (window.location.pathname.includes("/user/login")) {
          const user = this._user;
          const targetType = (user && user.type === "EMPLOYEE") ? "employee" : "citizen";
          console.log("[KC-AUTH] init: redirecting to /" + targetType + " (user.type=" + user?.type + ")");
          Digit.SessionStorage.set("userType", targetType);
          Digit.SessionStorage.set("user_type", targetType);
          window.location.replace(window.location.origin + "/" + contextPath + "/" + targetType);
        } else {
          console.log("[KC-AUTH] init: NOT on login page, no redirect. pathname=" + window.location.pathname);
        }
      }
    } catch (err) {
      console.warn("[KeycloakAuthAdapter] SSO check failed, continuing without SSO:", err);
    }

    this._kc.onTokenExpired = () => {
      this._kc.updateToken(30).then(() => {
        window.localStorage.setItem("token", this._kc.token);
        const sessionType = this._digitUserType === "EMPLOYEE" ? "Employee" : "Citizen";
        window.localStorage.setItem(sessionType + ".token", this._kc.token);
      }).catch(() => {
        this._user = null;
      });
    };
  }

  isAuthenticated() {
    return !!this._kc?.authenticated && !!this._user;
  }

  getToken() {
    return this._kc?.token || null;
  }

  getUser() {
    return this._user;
  }

  // Manually set tokens on the keycloak instance by decoding JWTs directly.
  // Required because kc.init() with raw tokens from a password grant triggers
  // a full OIDC flow or fails silently in some keycloak-js versions.
  _setTokens(access, refresh, id) {
    this._kc.token = access;
    this._kc.refreshToken = refresh || null;
    this._kc.idToken = id || null;
    this._kc.authenticated = true;

    try {
      this._kc.tokenParsed = b64decode(access.split(".")[1]);
      this._kc.subject = this._kc.tokenParsed.sub;
      this._kc.realmAccess = this._kc.tokenParsed.realm_access;
      this._kc.resourceAccess = this._kc.tokenParsed.resource_access;
    } catch (e) {
      console.warn("[KeycloakAuthAdapter] Failed to decode access token:", e);
    }

    if (refresh) {
      try {
        this._kc.refreshTokenParsed = b64decode(refresh.split(".")[1]);
      } catch (e) { /* refresh token may not be a JWT */ }
    }

    if (id) {
      try {
        this._kc.idTokenParsed = b64decode(id.split(".")[1]);
      } catch (e) { /* id token decode failure is non-fatal */ }
    }
  }

  async login({ email, password, tenantId }) {
    // If no tenantId passed by caller, read from KC tenant dropdown
    if (!tenantId) {
      const kcSel = document.getElementById("kc-tenant-select");
      if (kcSel && kcSel.value) tenantId = kcSel.value;
    }
    this._tenantId = tenantId || null;

    const tokenExchangeUrl = this._tokenExchangeUrl || window.location.origin;
    const resp = await fetch(`${tokenExchangeUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, tenantId }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || err.message || "Login failed");
    }

    const tokens = await resp.json();

    // BFF does not return refresh_token — pass null
    this._setTokens(tokens.access_token, null, tokens.id_token);
    this._digitUserType = tokens.digit_user_type || null;
    this._digitRoles = tokens.digit_roles || null;

    await this._loadUserFromToken();
    return { token: tokens.access_token, user: this._user };
  }

  async signup({ email, password, name, tenantId }) {
    this._tenantId = tenantId || null;

    const resp = await fetch(`${this._tokenExchangeUrl}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name, tenantId }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.message || err.error || "Registration failed");
    }

    return this.login({ email, password, tenantId });
  }

  async logout() {
    // Build the redirect URL before clearing anything
    const contextPath = window?.contextPath || "digit-ui";
    const redirectUri = `${window.location.origin}/${contextPath}/user/login`;

    // Build the KC logout URL directly from config.
    // We can't rely on this._kc.authenticated because password-grant logins
    // use _setTokens() on a previous page's adapter instance — after navigation,
    // the new adapter's init(check-sso) sees no KC session cookie, so
    // _kc.authenticated is false even though the user is logged in.
    const kcUrl = window?.globalConfigs?.getConfig("KEYCLOAK_URL");
    const realm = window?.globalConfigs?.getConfig("KEYCLOAK_REALM");
    const clientId = window?.globalConfigs?.getConfig("KEYCLOAK_CLIENT_ID");

    // Clear in-memory state
    this._user = null;
    this._tenantId = null;
    this._digitUserType = null;
    this._digitRoles = null;

    // Grab id_token_hint before clearing storage (needed for KC logout)
    const idTokenHint = this._kc?.idToken || null;

    // Clear all browser storage
    window.localStorage.clear();
    window.sessionStorage.clear();

    // Always redirect through KC's logout endpoint to clear any session cookies
    // (from SSO/Google login or future flows that create KC sessions).
    // For password-grant-only sessions there's no cookie, but the redirect is
    // harmless and ensures consistent behavior.
    if (kcUrl && realm) {
      const logoutUrl = new URL(`${kcUrl}/realms/${realm}/protocol/openid-connect/logout`);
      logoutUrl.searchParams.set("client_id", clientId);
      logoutUrl.searchParams.set("post_logout_redirect_uri", redirectUri);
      if (idTokenHint) {
        logoutUrl.searchParams.set("id_token_hint", idTokenHint);
      }
      window.location.replace(logoutUrl.toString());
    } else {
      window.location.replace(redirectUri);
    }
  }

  async refreshToken() {
    if (!this._kc) return null;
    await this._kc.updateToken(30);
    return this._kc.token;
  }

  async checkEmailExists(email) {
    const resp = await fetch(
      `${this._tokenExchangeUrl}/check-email?email=${encodeURIComponent(email)}`
    );
    if (!resp.ok) return false;
    const data = await resp.json();
    return data.exists === true;
  }

  async loginWithProvider(provider) {
    console.log("[KC-AUTH] loginWithProvider: " + provider + " redirectUri=" + window.location.href);
    this._kc.login({ idpHint: provider });
  }

  getSupportedProviders() {
    return ["google"];
  }

  async _loadUserFromToken() {
    if (!this._kc?.tokenParsed) {
      console.log("[KC-AUTH] _loadUserFromToken: no tokenParsed, skipping");
      return;
    }

    const parsed = this._kc.tokenParsed;
    console.log("[KC-AUTH] _loadUserFromToken: sub=" + parsed.sub + " email=" + parsed.email);
    console.log("[KC-AUTH] _digitUserType=" + this._digitUserType + " _digitRoles=" + JSON.stringify(this._digitRoles));
    console.log("[KC-AUTH] realm_access.roles=" + JSON.stringify(parsed.realm_access?.roles));
    const stateTenant = window?.globalConfigs?.getConfig("STATE_LEVEL_TENANT_ID") || "pg";
    const defaultCityTenant = stateTenant + ".citya"; // TODO: make configurable
    const tenantId = this._tenantId || defaultCityTenant;

    const isEmployee = this._digitUserType === "EMPLOYEE";
    const userType = isEmployee ? "EMPLOYEE" : "CITIZEN";
    const sessionType = isEmployee ? "employee" : "citizen";
    console.log("[KC-AUTH] isEmployee=" + isEmployee + " userType=" + userType + " sessionType=" + sessionType);

    // Use digit_roles from token response if available, else fall back to KC realm roles
    const roles = (this._digitRoles && this._digitRoles.length > 0)
      ? this._digitRoles.map(r => ({
          code: r.code,
          name: r.name || r.code,
          tenantId: isEmployee ? tenantId : (r.tenantId || tenantId),
        }))
      : (parsed.realm_access?.roles || []).map(code => ({
          code, name: code, tenantId,
        }));

    this._user = {
      uuid: parsed.sub,
      email: parsed.email,
      name: parsed.name || parsed.preferred_username || parsed.email,
      roles,
      tenantId,
      type: userType,
    };

    const sessionUser = {
      access_token: this._kc.token,
      token: this._kc.token,
      info: {
        uuid: this._user.uuid,
        userName: this._user.userName,
        name: this._user.name,
        emailId: this._user.email,
        tenantId,
        type: userType,
        roles,
      },
    };

    // Common storage
    Digit.SessionStorage.set("User", sessionUser);
    Digit.SessionStorage.set("userType", sessionType);
    Digit.SessionStorage.set("user_type", sessionType);
    window.localStorage.setItem("token", this._kc.token);

    if (isEmployee) {
      Digit.SessionStorage.set("Employee.tenantId", tenantId);
      window.localStorage.setItem("Employee.token", this._kc.token);
      window.localStorage.setItem("Employee.user-info", JSON.stringify(sessionUser.info));
      window.localStorage.setItem("Employee.tenant-id", tenantId);
    } else {
      Digit.SessionStorage.set("Citizen.tenantId", tenantId);
      window.localStorage.setItem("Citizen.token", this._kc.token);
      window.localStorage.setItem("Citizen.user-info", JSON.stringify(sessionUser.info));
      window.localStorage.setItem("Citizen.tenant-id", tenantId);
      if (!Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")) {
        Digit.SessionStorage.set("CITIZEN.COMMON.HOME.CITY", { code: tenantId });
      }
    }
  }
}
