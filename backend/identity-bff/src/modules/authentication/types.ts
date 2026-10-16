export interface KeycloakClaims {
  sub: string;
  email: string;
  name?: string;
  preferred_username?: string;
  email_verified?: boolean;
  phone_number?: string;
  phone_number_verified?: boolean;
  realm_access?: {
    roles: string[];
  };
  groups?: string[];
  organization?: Record<string, KeycloakOrganizationClaim>;
  nonce?: string;
  azp?: string;
  /** Keycloak session id; stored as the session record's `kcSessionId` (§6, §10). */
  sid?: string;
  /** Keycloak's authentication time (epoch seconds); the `basic` client scope maps it into the access token. */
  auth_time?: number;
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
  labelKey: string;
  label?: string;
  type: "password" | "idp" | "magic_link" | "phone_otp" | "hosted";
  idpHint?: string;
  intents: IdentityAuthIntent[];
}

export type IdentityAuthIntent = "signin" | "signup";

export type IdentityAuthResultCode =
  | "ACTION_COMPLETE"
  | "ACTION_CANCELLED"
  | "ACTION_FAILED"
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
  message?: string;
  actions: Array<"TRY_AGAIN" | "TRY_EXISTING_METHOD" | "SETUP_PASSWORD">;
}
