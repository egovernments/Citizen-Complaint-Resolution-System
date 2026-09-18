import { config } from "../../infrastructure/config.js";

let cachedAdminToken: string | null = null;
let tokenExpiry = 0;

export function resetAdminToken(): void {
  cachedAdminToken = null;
  tokenExpiry = 0;
}

export async function getAdminToken(): Promise<string> {
  if (cachedAdminToken && Date.now() < tokenExpiry) {
    return cachedAdminToken;
  }

  const credentials = new URLSearchParams({
    grant_type: config.keycloakAdminClientSecret
      ? "client_credentials"
      : "password",
    client_id: config.keycloakAdminClientId,
  });
  if (config.keycloakAdminClientSecret) {
    credentials.set("client_secret", config.keycloakAdminClientSecret);
  } else {
    credentials.set("username", config.keycloakAdminUsername);
    credentials.set("password", config.keycloakAdminPassword);
  }
  const resp = await fetch(
    `${config.keycloakAdminUrl}/realms/${encodeURIComponent(config.keycloakAdminRealm)}` +
      "/protocol/openid-connect/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: credentials.toString(),
    }
  );

  if (!resp.ok) {
    throw new Error(`Keycloak admin login failed: ${resp.status}`);
  }

  const data = (await resp.json()) as { access_token: string; expires_in: number };
  cachedAdminToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 10) * 1000;
  return cachedAdminToken;
}
