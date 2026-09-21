export interface KeycloakClaims {
  sub: string;
  email: string;
  name?: string;
  preferred_username?: string;
  email_verified?: boolean;
  phone_number?: string;
  realm_access?: {
    roles: string[];
  };
  groups?: string[];
  organization?: Record<string, KeycloakOrganizationClaim>;
  nonce?: string;
  azp?: string;
  realm?: string;
}

export interface KeycloakOrganizationClaim {
  id?: string;
  groups?: string[];
  realm_access?: {
    roles?: string[];
  };
  resource_access?: Record<string, { roles?: string[] }>;
  [attribute: string]: unknown;
}

export interface IdentityTokenSet {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  accessExpiresIn: number;
  refreshExpiresIn?: number;
}

export interface IdentityAuthMethod {
  id: string;
  label: string;
  type: "password" | "oauth" | "magic_link";
  idpHint?: string;
}
