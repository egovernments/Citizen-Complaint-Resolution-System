import type { AuthProvider } from 'ra-core';
import type { DigitApiClient } from '../client/DigitApiClient.js';

/**
 * Optional KC logout handler. When provided AND a KC session is active, the
 * authProvider's `logout` delegates to it (so the host app can call Keycloak's
 * RP-initiated logout endpoint via id_token_hint instead of just clearing
 * local state). Returns void because the redirect away from the SPA is the
 * "result".
 */
export interface KeycloakAuthOptions {
  /** True when a KC access token is currently in storage. */
  isKeycloakActive: () => boolean;
  /** Performs the RP-initiated KC logout (typically window.location.assign
   *  to {realm}/protocol/openid-connect/logout). Should also clear any
   *  KC tokens from the host app's storage before redirecting. */
  performKeycloakLogout: () => void;
}

export function createDigitAuthProvider(
  client: DigitApiClient,
  kc?: KeycloakAuthOptions,
): AuthProvider {
  return {
    login: async () => {
      // No-op: login handled externally (LoginPage calls client.login() directly,
      // or — in KC mode — the OAuth2 Authorization Code flow runs out-of-band)
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
      // In Keycloak mode, hand off to the host app's RP-initiated logout —
      // it calls {realm}/protocol/openid-connect/logout?id_token_hint=...
      // which revokes the KC session before redirecting back to /login.
      // The browser navigates away; the `return '/login'` below is then a
      // no-op (ra-core never gets to redirect because we've already left).
      if (kc?.isKeycloakActive() && kc.performKeycloakLogout) {
        kc.performKeycloakLogout();
      }
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
