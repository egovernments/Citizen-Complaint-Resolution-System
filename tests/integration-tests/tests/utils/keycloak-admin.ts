/** Operator token is supplied by the isolated fixture; there is no admin/admin fallback. */
export function keycloakAdmin() {
  const base = process.env.IDENTITY_TEST_KEYCLOAK_ADMIN_URL;
  const token = process.env.IDENTITY_TEST_KEYCLOAK_ADMIN_TOKEN;
  if (!base || !token) throw new Error('Set IDENTITY_TEST_KEYCLOAK_ADMIN_URL and IDENTITY_TEST_KEYCLOAK_ADMIN_TOKEN for the isolated realm fixture');
  return { base: base.replace(/\/$/, ''), token };
}

/**
 * A fresh admin token for long-running tools (scripts/seed-personas.ts): the
 * fixture token when one is set, else a master-realm `admin-cli` password grant
 * from IDENTITY_TEST_KEYCLOAK_ADMIN_USER/_PASSWORD. Still no default credentials.
 */
export async function keycloakAdminFresh(): Promise<{ base: string; token: string }> {
  if (process.env.IDENTITY_TEST_KEYCLOAK_ADMIN_TOKEN) return keycloakAdmin();
  const base = process.env.IDENTITY_TEST_KEYCLOAK_ADMIN_URL?.replace(/\/$/, '');
  const username = process.env.IDENTITY_TEST_KEYCLOAK_ADMIN_USER;
  const password = process.env.IDENTITY_TEST_KEYCLOAK_ADMIN_PASSWORD;
  if (!base || !username || !password) {
    throw new Error('Set IDENTITY_TEST_KEYCLOAK_ADMIN_URL and either IDENTITY_TEST_KEYCLOAK_ADMIN_TOKEN or IDENTITY_TEST_KEYCLOAK_ADMIN_USER/_PASSWORD');
  }
  const response = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username, password }),
  });
  if (!response.ok) throw new Error(`Keycloak admin sign-in failed: HTTP ${response.status}`);
  return { base, token: ((await response.json()) as { access_token: string }).access_token };
}
