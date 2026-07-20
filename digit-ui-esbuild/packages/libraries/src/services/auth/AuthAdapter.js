/**
 * AuthAdapter interface.
 * All implementations must provide these methods.
 * The active adapter is selected per surface by getAuthProvider() in
 * ./authSurface.js (CITIZEN_AUTH_PROVIDER / EMPLOYEE_AUTH_PROVIDER, with the
 * legacy AUTH_PROVIDER honoured for the citizen surface only).
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
