/**
 * Keycloak ROPC (Resource Owner Password Credentials) auth utility.
 *
 * Acquires tokens via the KC token endpoint for API-level validation.
 * Used by tests that verify the auth infrastructure works, independent
 * of whether the SPA login form renders correctly.
 */

interface KcTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  digit_user_type?: string;
  digit_roles?: Array<{ code: string }>;
}

export interface AuthConfig {
  baseURL: string;
  realm?: string;
  clientId?: string;
  tenant: string;
  username: string;
  password: string;
}

/**
 * Acquire a KC access token via ROPC grant.
 * Works without a browser — pure HTTP call.
 */
export async function getKcToken(config: AuthConfig): Promise<KcTokenResponse> {
  const realm = config.realm ?? 'digit-sandbox';
  const clientId = config.clientId ?? 'digit-sandbox-ui';

  const tokenUrl = `${config.baseURL}/realms/${realm}/protocol/openid-connect/token`;

  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: clientId,
    username: config.username,
    password: config.password,
    scope: 'openid',
  });

  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`KC ROPC failed (${resp.status}): ${text}`);
  }

  return resp.json() as Promise<KcTokenResponse>;
}
