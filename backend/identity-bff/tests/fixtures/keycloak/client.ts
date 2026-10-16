/** Real Admin REST fixture. Response bodies and credentials never enter errors. */
export async function keycloakTestClient() {
  const base = process.env.KEYCLOAK_TEST_URL;
  const password = process.env.KEYCLOAK_TEST_ADMIN_PASSWORD;
  if (!base || !password) throw new Error("Real Keycloak tests need the fixture URL and generated admin password");
  const response = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
    method: "POST", body: new URLSearchParams({ grant_type: "password", client_id: "admin-cli",
      username: "test-admin", password }),
  });
  if (!response.ok) throw new Error(`Test admin authentication failed (${response.status})`);
  const { access_token: token } = await response.json() as { access_token: string };
  const request = async (path: string, method = "GET", body?: unknown) => {
    const result = await fetch(`${base}/admin/realms/identity-test${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!result.ok) throw new Error(`Test Admin ${method} failed (${result.status})`);
    return result;
  };
  return { base, request };
}
