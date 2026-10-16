/** Operator token is supplied by the isolated fixture; there is no admin/admin fallback. */
export function keycloakAdmin() {
  const base = process.env.IDENTITY_TEST_KEYCLOAK_ADMIN_URL;
  const token = process.env.IDENTITY_TEST_KEYCLOAK_ADMIN_TOKEN;
  if (!base || !token) throw new Error('Set IDENTITY_TEST_KEYCLOAK_ADMIN_URL and IDENTITY_TEST_KEYCLOAK_ADMIN_TOKEN for the isolated realm fixture');
  return { base: base.replace(/\/$/, ''), token };
}
