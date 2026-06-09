import type { AuthProvider } from 'ra-core';
import type { DigitApiClient } from '../client/DigitApiClient.js';

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

    getPermissions: async () => {
      const { user } = client.getAuthInfo();
      if (!user?.roles) return [];
      return user.roles.map((role) => role.code);
    },
  };
}
