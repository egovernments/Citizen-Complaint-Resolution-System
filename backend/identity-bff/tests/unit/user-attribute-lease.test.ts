import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { closeCache, getRedis, initCache } from "../../src/infrastructure/redis.js";
import { withPersonLease } from "../../src/modules/accounts/person-lease.js";
import { updateAccountLinkBlockValues, updateAccountLinkValues } from "../../src/modules/organizations/organization-service.js";
import { updateKeycloakUser, type UserRepresentation } from "../../src/modules/sync/keycloak-writer.js";

vi.mock("../../src/integrations/keycloak/admin-session.js", () => ({ getAdminToken: vi.fn(async () => "admin-token"), resetAdminToken: vi.fn() }));

const prefix = `user-attribute-lease-${process.pid}`;
const users = new Map<string, UserRepresentation>();
let pauseNextGet: { read: () => void; release: Promise<void> } | null = null;

beforeAll(() => {
  Object.assign(config, { cachePrefix: prefix });
  initCache(`redis://localhost:${process.env.REDIS_PORT || "16379"}`);
});
async function clear() {
  const keys = await getRedis().keys(`${prefix}:*`);
  if (keys.length) await getRedis().del(...keys);
}
beforeEach(async () => {
  vi.restoreAllMocks(); await clear(); users.clear(); pauseNextGet = null;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const id = decodeURIComponent(new URL(String(input)).pathname.split("/users/")[1]);
    if (init?.method === "PUT") {
      users.set(id, { ...users.get(id), ...JSON.parse(String(init.body)) });
      return new Response(null, { status: 204 });
    }
    const snapshot = structuredClone(users.get(id));
    const pause = pauseNextGet; pauseNextGet = null;
    if (pause) { pause.read(); await pause.release; }
    return Response.json(snapshot);
  });
});
afterAll(async () => { vi.restoreAllMocks(); await clear(); await closeCache(); });

describe("Keycloak user attribute writes", () => {
  it("an account-link block and a mirror write for the same person never erase each other", async () => {
    users.set("person", { id: "person", email: "person@example.invalid", attributes: { untouched: ["keep"] } });
    let read!: () => void; let release!: () => void;
    const mirrorRead = new Promise<void>(resolve => { read = resolve; });
    pauseNextGet = { read, release: new Promise<void>(resolve => { release = resolve; }) };
    // _select's mirror: GET happens before the block write, PUT after it.
    const mirror = withPersonLease("person", () => updateKeycloakUser("person", user =>
      ({ ...user, attributes: { ...user.attributes, "digit.accounts": ["mirrored"] } })));
    await mirrorRead;
    const block = updateAccountLinkBlockValues("person", values => [...values, "CITIZEN|pg|uuid"]);
    await new Promise(resolve => setTimeout(resolve, 300));
    release();
    await Promise.all([mirror, block]);
    expect(users.get("person")!.attributes).toEqual({
      untouched: ["keep"], "digit.accounts": ["mirrored"], "digit.accountLinkBlocks": ["CITIZEN|pg|uuid"],
    });
  });

  it("a caller already holding the person lease reuses it", async () => {
    users.set("holder", { id: "holder", attributes: {} });
    await withPersonLease("holder", async () => {
      await updateAccountLinkValues("holder", values => [...values, "EMPLOYEE|pg|uuid"]);
      await updateKeycloakUser("holder", user => ({ ...user, attributes: { ...user.attributes, phoneNumber: ["+254700000000"] } }));
    });
    expect(users.get("holder")!.attributes).toEqual({ "digit.accountLinks": ["EMPLOYEE|pg|uuid"], phoneNumber: ["+254700000000"] });
  });
});
