/**
 * AuthAdapter interface.
 * All implementations must provide these methods.
 * Active adapter is selected via globalConfigs.getConfig("AUTH_PROVIDER").
 */

export class AuthAdapter {
  async init() { throw new Error("Not implemented"); }
  isAuthenticated() { throw new Error("Not implemented"); }
  getToken() { throw new Error("Not implemented"); }
  getUser() { throw new Error("Not implemented"); }
  async login({ email, password }) { throw new Error("Not implemented"); }
  async signup({ email, password, name }) { throw new Error("Not implemented"); }
  async logout() { throw new Error("Not implemented"); }
  async refreshToken() { throw new Error("Not implemented"); }
  async checkEmailExists(email) { throw new Error("Not implemented"); }
  async loginWithProvider(provider) { throw new Error("Not implemented"); }
  getSupportedProviders() { return []; }
}
