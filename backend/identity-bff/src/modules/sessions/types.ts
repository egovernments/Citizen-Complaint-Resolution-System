import type { KeycloakClaims } from "../authentication/types.js";
import type { BoundTenant, IdentitySurface } from "../authentication/surfaces.js";

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
  /** Surface that created the session; absent means `configurator`. */
  surface?: IdentitySurface;
  /** Route-resolved tenant of an employee/citizen session. */
  boundTenant?: BoundTenant;
}

/** Surface binding persisted with a session and preserved across refresh. */
export interface SessionBinding {
  surface?: IdentitySurface;
  boundTenant?: BoundTenant;
}
