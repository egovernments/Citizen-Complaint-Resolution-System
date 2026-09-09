import type { AuthProvider } from 'ra-core';
import type { DigitApiClient } from '../client/DigitApiClient.js';
import { loadMastersCapability, type MastersCapability } from './accessPolicy.js';

/** Shape returned by `getPermissions()` — role codes plus the masters
 *  visibility/edit capability computed from existing accesscontrol MDMS data.
 *  See docs/design/masters-configurator-access-policy-design.md §3.3. */
export interface DigitPermissions {
  roles: string[];
  masters: MastersCapability;
}

export function createDigitAuthProvider(client: DigitApiClient): AuthProvider {
  return {
    login: async () => {
      // No-op: login handled externally (LoginPage calls client.login() directly)
    },

    checkAuth: async () => {
      if (!client.isAuthenticated()) {
        throw new Error('Not authenticated');
      }
    },

    checkError: async (error: { status?: number }) => {
      if (error?.status === 401 || error?.status === 403) {
        client.clearAuth();
        throw new Error('Authentication error');
      }
    },

    logout: async () => {
      client.clearAuth();
      return '/login';
    },

    getIdentity: async () => {
      const { user } = client.getAuthInfo();
      if (!user) throw new Error('No user identity available');
      return {
        id: user.uuid ?? user.userName,
        fullName: user.name,
      };
    },

    getPermissions: async (): Promise<DigitPermissions> => {
      const { user, stateTenantId } = client.getAuthInfo();
      const roles = user?.roles?.map((role) => role.code).filter(Boolean) ?? [];
      const masters = await loadMastersCapability(client, user?.tenantId || stateTenantId, roles);
      return { roles, masters };
    },
  };
}
