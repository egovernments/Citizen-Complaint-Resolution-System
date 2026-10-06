const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const envPath = path.join(projectRoot, "src/env-variables.js");
const svcPath = path.join(projectRoot, "src/machine/service/egov-pgr.js");
const locPath = path.join(projectRoot, "src/machine/util/localisation-service.js");
const userServicePath = path.join(projectRoot, "src/session/user-service.js");
const fetchPath = require.resolve("node-fetch", { paths: [projectRoot] });

/**
 * Load egov-pgr with node-fetch replaced by `handler(url, options)`, which returns
 * `{ status, body }`. Every call is recorded so a test can inspect what was sent.
 */
function load(handler) {
  const calls = [];
  delete require.cache[svcPath];
  require.cache[envPath] = {
    id: envPath, filename: envPath, loaded: true,
    exports: {
      rootTenantId: "ke",
      boundaryHierarchyType: "ADMIN",
      supportedLocales: "en_IN",
      referenceCacheTtlMs: 60000,
      timeouts: { request: 20000 },
      mobileValidation: { defaultCountryCode: "+254", defaultRegex: "^0?[17][0-9]{8}$", cacheTtlMs: 1000 },
      egovServices: {
        egovServicesHost: "http://localhost/",
        pgrCreateEndpoint: "pgr-services/v2/request/_create",
      },
    },
  };
  require.cache[locPath] = {
    id: locPath, filename: locPath, loaded: true,
    exports: { getMessageBundleForCode: () => ({ en_IN: undefined }) },
  };
  // Complaints are filed as the service account, which would otherwise log in first.
  require.cache[userServicePath] = {
    id: userServicePath, filename: userServicePath, loaded: true,
    exports: { getServiceAccount: async () => ({ authToken: "svc", userInfo: { uuid: "svc" } }) },
  };
  require.cache[fetchPath] = {
    id: fetchPath, filename: fetchPath, loaded: true,
    exports: async (url, options) => {
      calls.push({ url, options });
      const { status = 200, body = {} } = handler(url, options) || {};
      return {
        status,
        ok: status === 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    },
  };
  const svc = require(svcPath);
  svc.fetchMdmsV2Data = async () => ({});
  return { svc, calls };
}

function boundaryAndLocalisation(codes) {
  return (url) => {
    if (url.includes("boundary-relationships/_search")) {
      return { body: { TenantBoundary: [{ boundary: codes.map((code) => ({ code })) }] } };
    }
    if (url.includes("localization/messages")) {
      return { body: { messages: [{ code: "W1_ADMIN_WARD", message: "Ward One" }] } };
    }
    // A failed create now throws, so the create call succeeds here.
    if (url.includes("request/_create")) return { body: { ServiceWrappers: [{ service: { serviceRequestId: "PGR-1" } }] } };
    return { status: 400, body: {} };
  };
}

test("REGRESSION: locality codes are offered exactly as boundary-service returns them", async () => {
  const { svc } = load(boundaryAndLocalisation(["W1_ADMIN_WARD", "ADMIN_SUN04"]));
  const { localities, messageBundle } = await svc.fetchLocalities("ke.bomet");
  assert.deepEqual(localities, ["W1_ADMIN_WARD", "ADMIN_SUN04"]);
  assert.equal(messageBundle["W1_ADMIN_WARD"].en_IN, "Ward One");
});

test("REGRESSION: the complaint carries the boundary code, not an ADMIN_-prefixed copy", async () => {
  const { svc, calls } = load(boundaryAndLocalisation(["W1_ADMIN_WARD"]));
  const user = { authToken: "t", userId: "u", userInfo: {}, locale: "en_IN" };
  await svc.persistComplaint(user, { complaint: "StreetLight", city: "ke.bomet", locality: "W1_ADMIN_WARD", localityIsBoundaryCode: true });

  const create = calls.find((c) => c.url.includes("request/_create"));
  const sent = JSON.parse(create.options.body);
  assert.equal(sent.service.address.locality.code, "W1_ADMIN_WARD");
  // With no localityName slot the name is looked up under the same code.
  assert.equal(sent.service.address.locality.name, "Ward One");
});

test("REGRESSION (review): a generated label drops the ADMIN_ prefix, the code keeps it", async () => {
  // No localisation and no boundary name, so the label is generated from the code.
  const { svc } = load((url) => {
    if (url.includes("boundary-relationships/_search")) {
      return { body: { TenantBoundary: [{ boundary: [{ code: "ADMIN_SUN04" }] }] } };
    }
    return { body: { messages: [] } };
  });
  const { localities, messageBundle } = await svc.fetchLocalities("pg.citya");
  assert.deepEqual(localities, ["ADMIN_SUN04"]);
  assert.equal(messageBundle["ADMIN_SUN04"].en_IN, "Sun 04");
});

test("REGRESSION (review): the MDMS fallback offers the ADMIN_ form PGR validates", async () => {
  const { svc } = load(() => ({ status: 500, body: {} })); // boundary-service down
  svc.fetchMdmsData = async () => [{ code: "SUN04" }, { code: "ADMIN_SUN05" }];
  let requestedKeys;
  require(locPath).getMessagesForCodesAndTenantId = async (codes) => {
    requestedKeys = codes;
    return { PG_CITYA_ADMIN_SUN04: { en_IN: "Sunshine 4" }, PG_CITYA_ADMIN_SUN05: {} };
  };
  const { localities, messageBundle } = await svc.fetchLocalities("pg.citya");
  // persistComplaint used to add this prefix for every source; now only this one needs it.
  assert.deepEqual(localities, ["ADMIN_SUN04", "ADMIN_SUN05"]);
  // A code that already has ADMIN_ is not prefixed a second time in the key either.
  assert.deepEqual(requestedKeys, ["PG_CITYA_ADMIN_SUN04", "PG_CITYA_ADMIN_SUN05"]);
  assert.equal(messageBundle["ADMIN_SUN04"].en_IN, "Sunshine 4");
  // A missing translation falls back to a generated label instead of undefined, which
  // made the pick-list throw.
  assert.equal(messageBundle["ADMIN_SUN05"].en_IN, "Sun 05");
});

function filingHarness() {
  const { svc, calls } = load((url) => (url.includes("request/_create") ? { body: { ServiceWrappers: [{ service: { serviceRequestId: "PGR-1" } }] } } : { body: { messages: [] } }));
  const file = async (slots) => {
    const before = calls.length;
    await svc.persistComplaint(
      { authToken: "t", userId: "u", userInfo: {}, locale: "en_IN" },
      { complaint: "StreetLight", city: "pg.citya", localityName: "Named", ...slots },
    );
    const made = calls.slice(before);
    return { made, sent: JSON.parse(made.find((c) => c.url.includes("request/_create")).options.body) };
  };
  return { file };
}

test("REGRESSION (review): filing makes no boundary or localisation lookup", async () => {
  const { file } = filingHarness();
  const { made } = await file({ locality: "W1_ADMIN_WARD", localityIsBoundaryCode: true });
  // Only the create call: no per-filing boundary search, and the name came from the slot.
  assert.deepEqual(made.map((c) => new URL(c.url).pathname), ["/pgr-services/v2/request/_create"]);
});

test("REGRESSION (review): a boundary code is sent unchanged", async () => {
  const { file } = filingHarness();
  const { sent } = await file({ locality: "W1_ADMIN_WARD", localityIsBoundaryCode: true });
  assert.equal(sent.service.address.locality.code, "W1_ADMIN_WARD");
  assert.equal(sent.service.address.locality.name, "Named");
});

test("a code is filed exactly as the walk picked it, with or without the flag", async () => {
  // The class-based boundary walk only ever offers real boundary codes, so no ADMIN_
  // prefix is added at filing time; that rule served the removed NLP and table paths.
  const { file } = filingHarness();
  assert.equal((await file({ locality: "SUN04" })).sent.service.address.locality.code, "SUN04");
  assert.equal((await file({ locality: "ADMIN_SUN05" })).sent.service.address.locality.code, "ADMIN_SUN05");
});
