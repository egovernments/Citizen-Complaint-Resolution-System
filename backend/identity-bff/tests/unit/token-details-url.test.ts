import { afterEach, describe, expect, it } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { tokenDetailsUrl } from "../../src/modules/revocation/inventory.js";

// 8c gate 2: `/_details` through Kong answered 401 for valid tokens, so the
// BFF forgot live tokens and logout-others revoked the current session.
describe("token details URL", () => {
  const saved = { logout: config.digitUserLogoutUrl, service: config.digitUserServiceUrl };
  afterEach(() => {
    (config as { digitUserLogoutUrl: string }).digitUserLogoutUrl = saved.logout;
    (config as { digitUserServiceUrl: string }).digitUserServiceUrl = saved.service;
  });

  it("uses the direct egov-user path that logout uses", () => {
    (config as { digitUserServiceUrl: string }).digitUserServiceUrl = "http://kong:8000/user";
    (config as { digitUserLogoutUrl: string }).digitUserLogoutUrl = "http://egov-user-proxy:8107/user/_logout";
    expect(tokenDetailsUrl()).toBe("http://egov-user-proxy:8107/user/_details");
  });

  it("falls back to the user service URL when no direct logout URL is set", () => {
    (config as { digitUserServiceUrl: string }).digitUserServiceUrl = "http://kong:8000/user/";
    (config as { digitUserLogoutUrl: string }).digitUserLogoutUrl = "";
    expect(tokenDetailsUrl()).toBe("http://kong:8000/user/_details");
  });
});
