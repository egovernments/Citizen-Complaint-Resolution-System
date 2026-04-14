import { AuthAdapter } from "./AuthAdapter";

// keycloak-js is loaded from CDN via <script> tag in index.html
// Available as window.Keycloak
function getKeycloakConstructor() {
  if (typeof window !== "undefined" && window.Keycloak) return window.Keycloak;
  throw new Error("keycloak-js not loaded. Ensure the CDN script is in index.html.");
}

export class KeycloakAuthAdapter extends AuthAdapter {
  constructor() {
    super();
    this._kc = null;
    this._user = null;
    this._tokenExchangeUrl = null;
  }

  async init() {
    const kcUrl = window?.globalConfigs?.getConfig("KEYCLOAK_URL");
    const realm = window?.globalConfigs?.getConfig("KEYCLOAK_REALM");
    const clientId = window?.globalConfigs?.getConfig("KEYCLOAK_CLIENT_ID");
    this._tokenExchangeUrl = window?.globalConfigs?.getConfig("TOKEN_EXCHANGE_URL");

    const Keycloak = getKeycloakConstructor();
    this._kc = new Keycloak({ url: kcUrl, realm, clientId });

    try {
      const authenticated = await this._kc.init({
        onLoad: "check-sso",
        pkceMethod: "S256",
        silentCheckSsoRedirectUri: window.location.origin + "/digit-ui/silent-check-sso.html",
      });

      if (authenticated) {
        await this._loadUserFromToken();
      }
    } catch (err) {
      console.warn("[KeycloakAuthAdapter] SSO check failed, continuing without SSO:", err);
    }

    this._kc.onTokenExpired = () => {
      this._kc.updateToken(30).then(() => {
        window.localStorage.setItem("token", this._kc.token);
        window.localStorage.setItem("Citizen.token", this._kc.token);
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

  async login({ email, password }) {
    const kcUrl = window?.globalConfigs?.getConfig("KEYCLOAK_URL");
    const realm = window?.globalConfigs?.getConfig("KEYCLOAK_REALM");
    const clientId = window?.globalConfigs?.getConfig("KEYCLOAK_CLIENT_ID");

    const tokenUrl = `${kcUrl}/realms/${realm}/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      grant_type: "password",
      client_id: clientId,
      username: email,
      password: password,
      scope: "openid",
    });

    const resp = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error_description || "Login failed");
    }

    const tokens = await resp.json();

    await this._kc.init({
      token: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
      pkceMethod: "S256",
    });

    await this._loadUserFromToken();

    return { success: true, user: this._user, token: tokens.access_token };
  }

  async signup({ email, password, name }) {
    const resp = await fetch(`${this._tokenExchangeUrl}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.message || err.error || "Registration failed");
    }

    return this.login({ email, password });
  }

  async logout() {
    this._user = null;
    window.localStorage.clear();
    window.sessionStorage.clear();

    if (this._kc?.authenticated) {
      const contextPath = window?.contextPath || "digit-ui";
      this._kc.logout({
        redirectUri: `${window.location.origin}/${contextPath}/user/login`,
      });
    } else {
      const contextPath = window?.contextPath || "digit-ui";
      window.location.replace(`${window.location.origin}/${contextPath}/user/login`);
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
    this._kc.login({ idpHint: provider });
  }

  getSupportedProviders() {
    return ["google"];
  }

  async _loadUserFromToken() {
    if (!this._kc?.tokenParsed) return;

    const parsed = this._kc.tokenParsed;
    const stateCode = window?.globalConfigs?.getConfig("STATE_LEVEL_TENANT_ID") || "pg";

    this._user = {
      uuid: parsed.sub,
      email: parsed.email,
      name: parsed.name || parsed.preferred_username || parsed.email,
      roles: (parsed.realm_access?.roles || []).map((code) => ({
        code,
        name: code,
        tenantId: stateCode,
      })),
      tenantId: stateCode,
      type: "CITIZEN",
    };

    const sessionUser = {
      access_token: this._kc.token,
      token: this._kc.token,
      info: {
        uuid: this._user.uuid,
        userName: this._user.email,
        name: this._user.name,
        emailId: this._user.email,
        tenantId: this._user.tenantId,
        type: this._user.type,
        roles: this._user.roles,
      },
    };

    Digit.SessionStorage.set("User", sessionUser);
    Digit.SessionStorage.set("userType", "citizen");
    Digit.SessionStorage.set("Citizen.tenantId", stateCode);
    window.localStorage.setItem("token", this._kc.token);
    window.localStorage.setItem("Citizen.token", this._kc.token);
    window.localStorage.setItem("Citizen.user-info", JSON.stringify(sessionUser.info));
    window.localStorage.setItem("Citizen.tenant-id", stateCode);
  }
}
