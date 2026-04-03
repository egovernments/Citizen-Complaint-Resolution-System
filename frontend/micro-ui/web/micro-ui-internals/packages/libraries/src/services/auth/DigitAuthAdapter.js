import { AuthAdapter } from "./AuthAdapter";

/**
 * DigitAuthAdapter wraps the existing DIGIT auth system.
 * When AUTH_PROVIDER=digit (default), this adapter is used.
 * It delegates to the existing UserService and localStorage session recovery.
 */
export class DigitAuthAdapter extends AuthAdapter {
  async init() {
    // No-op: existing session recovery in index.js handles this
  }

  isAuthenticated() {
    const user = Digit.UserService.getUser();
    return !!(user && user.access_token);
  }

  getToken() {
    const user = Digit.UserService.getUser();
    return user?.access_token || null;
  }

  getUser() {
    const user = Digit.UserService.getUser();
    if (!user?.info) return null;
    return {
      uuid: user.info.uuid,
      email: user.info.emailId || user.info.userName,
      name: user.info.name,
      roles: user.info.roles || [],
      tenantId: user.info.tenantId,
      type: user.info.type,
    };
  }

  async login({ email, password, tenantId }) {
    const requestData = {
      username: email,
      password,
      tenantId: tenantId || Digit.ULBService.getStateId(),
      userType: "CITIZEN",
    };
    const { UserRequest: info, ...tokens } = await Digit.UserService.authenticate(requestData);
    const user = { info, ...tokens };
    Digit.UserService.setUser(user);
    return { success: true, user: info, token: tokens.access_token };
  }

  async signup() {
    throw new Error("Signup not supported in DIGIT adapter. Use OTP flow.");
  }

  async logout() {
    return Digit.UserService.logout();
  }

  async refreshToken() {
    return this.getToken();
  }

  async checkEmailExists() {
    return false;
  }

  async loginWithProvider() {
    throw new Error("SSO not supported in DIGIT adapter");
  }

  getSupportedProviders() {
    return [];
  }
}
