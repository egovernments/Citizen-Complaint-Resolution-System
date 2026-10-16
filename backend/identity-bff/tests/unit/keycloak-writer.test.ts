import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateKeycloakUser, isMirrorOnlyAdminEvent, KeycloakConflictError } from "../../src/modules/sync/keycloak-writer.js";
import { config } from "../../src/infrastructure/config.js";

const mocks = vi.hoisted(() => ({ request: vi.fn(), current: vi.fn(), assertHeld: vi.fn() }));
vi.mock("../../src/modules/organizations/organization-service.js", () => ({ request: mocks.request }));
vi.mock("../../src/modules/accounts/person-lease.js", () => ({ currentPersonLease: mocks.current }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.current.mockReturnValue({ subject: "person/1", assertHeld: mocks.assertHeld });
  mocks.request.mockResolvedValueOnce(new Response(JSON.stringify({
    id: "person/1", username: "original", email: "verified@example.test", emailVerified: true,
    enabled: true, firstName: "Before", lastName: "Name", requiredActions: ["UPDATE_PASSWORD"],
    attributes: { unrelated: ["keep"] },
  }))).mockResolvedValue(new Response(null, { status: 204 }));
});

describe("Keycloak safe writer", () => {
  it("allows an explicit email change only as unverified and keeps username/enabled protected", async () => {
    await updateKeycloakUser("person/1", user => ({ ...user, email: "new@example.test", emailVerified: false,
      username: "other", enabled: true }), { allowEmailChange: true });
    const body = JSON.parse(mocks.request.mock.calls[1][1].body);
    expect(body).toMatchObject({ email: "new@example.test", emailVerified: false, username: "original" });
    expect(body).not.toHaveProperty("enabled");
  });
  it.each([{ email: "", emailVerified: false }, { email: "new@example.test", emailVerified: true }])(
    "rejects clearing or trusting the email in the opt-in writer", async change => {
      await expect(updateKeycloakUser("person/1", user => ({ ...user, ...change }), { allowEmailChange: true }))
        .rejects.toThrow("emailVerified=false");
      expect(mocks.request).toHaveBeenCalledTimes(1);
    });
  it("surfaces an email conflict as a typed error", async () => {
    mocks.request.mockReset().mockResolvedValueOnce(new Response('{"username":"original"}'))
      .mockRejectedValueOnce(Object.assign(new Error("conflict"), { status: 409 }));
    await expect(updateKeycloakUser("person/1", user => ({ ...user, email: "held@example.test", emailVerified: false }),
      { allowEmailChange: true })).rejects.toBeInstanceOf(KeycloakConflictError);
  });
  it("suppresses only BFF service-client user mirror reruns, not other admins", async () => {
    const priorSecret = config.keycloakAdminClientSecret;
    try {
      Object.assign(config, { keycloakAdminClientSecret: "fixture-only" });
      const event = { resourceType: "USER", operationType: "UPDATE", resourcePath: "users/person",
        authDetails: { clientId: config.keycloakAdminClientId } };
      expect(await isMirrorOnlyAdminEvent(event)).toBe(true);
      expect(await isMirrorOnlyAdminEvent({ ...event, authDetails: { clientId: "admin-console" } })).toBe(false);
      expect(await isMirrorOnlyAdminEvent({ ...event, operationType: "DELETE" })).toBe(false);
      expect(await isMirrorOnlyAdminEvent({ ...event, resourcePath: "users/person/credentials" })).toBe(false);
    } finally { Object.assign(config, { keycloakAdminClientSecret: priorSecret }); }
  });
  it("preserves fresh identity/profile fields even when the callback mutates them", async () => {
    await updateKeycloakUser("person/1", user => {
      user.email = "unverified@example.test";
      user.emailVerified = false;
      user.username = "other";
      user.requiredActions = [];
      user.enabled = true;
      user.firstName = "Whole DIGIT Name";
      user.lastName = "";
      user.attributes!["digit.accounts"] = ['{"v":1,"entries":[]}'];
      return user;
    });
    expect(mocks.request.mock.calls[0]).toEqual(["/users/person%2F1"]);
    const body = JSON.parse(mocks.request.mock.calls[1][1].body);
    expect(body).toMatchObject({ username: "original", email: "verified@example.test", emailVerified: true,
      firstName: "Whole DIGIT Name", lastName: "", requiredActions: ["UPDATE_PASSWORD"],
      attributes: { unrelated: ["keep"], "digit.accounts": ['{"v":1,"entries":[]}'] } });
    expect(body).not.toHaveProperty("enabled");
    expect(mocks.assertHeld).toHaveBeenCalledTimes(3);
  });

  it("does not PUT when the callback returns null", async () => {
    await updateKeycloakUser("person/1", () => null);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it.each([null, { subject: "someone-else" }])("refuses a missing or different person's lease", async lease => {
    mocks.current.mockReturnValue(lease);
    await expect(updateKeycloakUser("person/1", user => user)).rejects.toThrow(/lease/);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("does not write after losing the lease during GET", async () => {
    mocks.assertHeld.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("lease lost"));
    await expect(updateKeycloakUser("person/1", user => user)).rejects.toThrow("lease lost");
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it("propagates a failed PUT and does not retry a stale representation", async () => {
    mocks.request.mockReset().mockResolvedValueOnce(new Response('{"attributes":{}}'))
      .mockRejectedValueOnce(new Error("admin write failed"));
    await expect(updateKeycloakUser("person/1", user => user)).rejects.toThrow("admin write failed");
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });
});
