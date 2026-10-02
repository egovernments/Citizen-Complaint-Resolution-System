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
  intents: IdentityAuthIntent[];
}

export type IdentityAuthIntent = "signin" | "signup";

export type IdentityAuthResultCode =
  | "AUTH_CANCELLED"
  | "AUTH_ATTEMPT_EXPIRED"
  | "IDENTITY_PROVIDER_UNAVAILABLE"
  | "ACCOUNT_LINK_REQUIRED"
  | "ACCOUNT_LINK_FAILED"
  | "IDENTITY_ALREADY_LINKED"
  | "EMAIL_VERIFICATION_REQUIRED"
  | "SIGN_IN_FAILED"
  | "PASSWORD_SETUP_FAILED"
  | "PASSWORD_SETUP_COMPLETE";

export interface IdentityAuthResult {
  status: "failed" | "complete";
  code: IdentityAuthResultCode;
  message: string;
  actions: Array<"TRY_AGAIN" | "TRY_EXISTING_METHOD" | "SETUP_PASSWORD">;
}
