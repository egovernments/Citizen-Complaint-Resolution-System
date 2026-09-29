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
