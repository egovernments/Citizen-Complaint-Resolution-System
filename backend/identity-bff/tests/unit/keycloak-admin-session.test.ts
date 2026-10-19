import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createKcAdminMock,
  getLastAdminGrantType,
  resetState,
} from "../../mocks/kc-admin.js";
import { config } from "../../src/infrastructure/config.js";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Import the module under test — keycloak-admin.ts (NOT kc-admin.ts)
import {
  getAdminToken,
  resetAdminToken,
} from "../../src/integrations/keycloak/admin-session.js";

let server: Server;
let port: number;
let originalAdminUrl: string;
let originalAdminClientSecret: string;

beforeAll(async () => {
  const { app } = createKcAdminMock();
  server = app.listen(0);
  port = (server.address() as AddressInfo).port;

  // Save and override config to point at our local mock
  originalAdminUrl = config.keycloakAdminUrl;
  originalAdminClientSecret = config.keycloakAdminClientSecret;
  config.keycloakAdminUrl = `http://localhost:${port}`;
  config.keycloakAdminClientSecret = "test-admin-client-secret";
});

afterAll(() => {
  config.keycloakAdminUrl = originalAdminUrl;
  config.keycloakAdminClientSecret = originalAdminClientSecret;
  server?.close();
});

beforeEach(() => {
  resetState();
  resetAdminToken();
});

describe("getAdminToken", () => {
  it("returns a token string", async () => {
    const token = await getAdminToken();
    expect(typeof token).toBe("string");
    expect(token).toBe("mock-kc-admin-token");
    expect(getLastAdminGrantType()).toBe("client_credentials");
  });

  it("caches token (second call doesn't re-fetch)", async () => {
    const token1 = await getAdminToken();
    const token2 = await getAdminToken();
    expect(token1).toBe(token2);
  });
});
