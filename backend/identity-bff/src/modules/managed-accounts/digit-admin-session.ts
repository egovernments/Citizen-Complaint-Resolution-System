import { config } from "../../infrastructure/config.js";
import {
  DigitUnauthorizedError,
  DigitUnavailableError,
  passwordLogin,
} from "./digit-user-client.js";

interface Credential {
  label: string;
  username: string;
  password: string;
  tenantId: string;
  userType: string;
}

/**
 * Cached DIGIT token for one environment-configured service credential,
 * re-obtained before expiry or once after DIGIT rejects it.
 */
function credentialTokenCache(credential: () => Credential) {
  let cached: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;

  async function token(): Promise<string> {
    const skewMs = config.digitTokenRefreshSkewSeconds * 1000;
    if (cached && cached.expiresAt - skewMs > Date.now()) return cached.token;
    if (pending) return pending;
    const { label, username, password, tenantId, userType } = credential();
    if (!username || !password || !tenantId) {
      throw new DigitUnavailableError(`DIGIT ${label} credentials are not configured`);
    }
    pending = passwordLogin({ username, password, tenantId, userType }).then((login) => {
      cached = { token: login.accessToken, expiresAt: login.expiresAt };
      return login.accessToken;
    }, (error: Error) => {
      // A rejected service credential is an operator problem, never a caller conflict.
      throw new DigitUnavailableError(`DIGIT ${label} login failed: ${error.message}`);
    }).finally(() => {
      pending = null;
    });
    return pending;
  }

  return {
    async run<T>(operation: (token: string) => Promise<T>): Promise<T> {
      const current = await token();
      try {
        return await operation(current);
      } catch (error) {
        if (!(error instanceof DigitUnauthorizedError)) throw error;
        if (cached?.token === current) cached = null;
        return operation(await token());
      }
    },
    reset() {
      cached = null;
      pending = null;
    },
  };
}

const admin = credentialTokenCache(() => ({
  label: "admin",
  username: config.digitAdminUsername,
  password: config.digitAdminPassword,
  tenantId: config.digitAdminTenantId,
  userType: config.digitAdminUserType,
}));

const provisioner = credentialTokenCache(() => ({
  label: "tenant provisioner",
  username: config.digitProvisionerUsername,
  password: config.digitProvisionerPassword,
  tenantId: config.digitProvisionerTenantId,
  userType: config.digitAdminUserType,
}));

/** Managed-account lifecycle only (ACCOUNT_ADMIN). Never for business calls. */
export function withDigitAdmin<T>(operation: (token: string) => Promise<T>): Promise<T> {
  return admin.run(operation);
}

/** Onboarding tenant-foundation writes only (MDMS_ADMIN). */
export function withDigitProvisioner<T>(operation: (token: string) => Promise<T>): Promise<T> {
  return provisioner.run(operation);
}

export function digitProvisionerConfigured(): boolean {
  return Boolean(config.digitProvisionerUsername && config.digitProvisionerPassword &&
    config.digitProvisionerTenantId && config.digitMdmsCreateUrl);
}

export function resetDigitAdminToken(): void {
  admin.reset();
  provisioner.reset();
}
