import type { KeycloakClaims } from "../authentication/types.js";

export interface SelectedIdentityContext {
  organizationId: string;
  organizationAlias: string;
  tenantId: string;
  name: string;
}

export interface IdentitySession {
  claims: KeycloakClaims;
  /** OIDC client that created this session; absent on older sessions. */
  oidcClientId?: string;
  accessToken: string;
  refreshToken?: string;
  accessExpiresAt: number;
  refreshExpiresAt?: number;
  /** Absolute lifetime of the opaque browser session. */
  sessionExpiresAt: number;
}
