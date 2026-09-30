const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const envPath = path.join(projectRoot, "src/env-variables.js");
const svcPath = path.join(projectRoot, "src/machine/service/egov-pgr.js");
const locPath = path.join(projectRoot, "src/machine/util/localisation-service.js");
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
  await svc.persistComplaint(user, { complaint: "StreetLight", city: "ke.bomet", locality: "W1_ADMIN_WARD" });

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
  require(locPath).getMessagesForCodesAndTenantId = async () => ({});
  const { localities } = await svc.fetchLocalities("pg.citya");
  // persistComplaint used to add this prefix for every source; now only this one needs it.
  assert.deepEqual(localities, ["ADMIN_SUN04", "ADMIN_SUN05"]);
});

test("REGRESSION (review): a code saved without its prefix is matched back to the list when filing", async () => {
  // A session saved before the deploy holds SUN04 (the old code stripped ADMIN_), and the
  // NLP fuzzy search returns bare codes too. Both must still file as ADMIN_SUN04.
  const { svc, calls } = load((url) => {
    if (url.includes("boundary-relationships/_search")) {
      return { body: { TenantBoundary: [{ boundary: [{ code: "ADMIN_SUN04" }] }] } };
    }
    if (url.includes("request/_create")) return { status: 400, body: {} };
    return { body: { messages: [] } };
  });
  const user = { authToken: "t", userId: "u", userInfo: {}, locale: "en_IN" };
  await svc.persistComplaint(user, { complaint: "StreetLight", city: "pg.citya", locality: "SUN04", localityName: "Sun 04" });
  const sent = JSON.parse(calls.find((c) => c.url.includes("request/_create")).options.body);
  assert.equal(sent.service.address.locality.code, "ADMIN_SUN04");
});

test("a code already in the list, or unknown to it, is filed unchanged", async () => {
  const { svc } = load(boundaryAndLocalisation(["W1_ADMIN_WARD"]));
  assert.equal(await svc.resolveLocalityCode("ke.bomet", "W1_ADMIN_WARD"), "W1_ADMIN_WARD");
  assert.equal(await svc.resolveLocalityCode("ke.bomet", "NOT_IN_LIST"), "NOT_IN_LIST");
});
