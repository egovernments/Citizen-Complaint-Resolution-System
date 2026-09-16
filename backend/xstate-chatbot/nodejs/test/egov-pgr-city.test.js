const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const envPath = path.join(projectRoot, "src/env-variables.js");
const svcPath = path.join(projectRoot, "src/machine/service/egov-pgr.js");
const locPath = path.join(projectRoot, "src/machine/util/localisation-service.js");
const mobilePath = path.join(projectRoot, "src/machine/service/mobile-validation-service.js");

function load() {
  for (const p of [svcPath, mobilePath]) delete require.cache[p];
  require.cache[envPath] = {
    id: envPath, filename: envPath, loaded: true,
    exports: {
      rootTenantId: "ke",
      boundaryHierarchyType: "ADMIN",
      supportedLocales: "en_IN",
      mobileValidation: { defaultCountryCode: "+254", defaultRegex: "^0?[17][0-9]{8}$", cacheTtlMs: 1000 },
      pgrUseCase: { complaintSearchLimit: 3 },
      egovServices: {
        egovServicesHost: "http://localhost/",
        externalHost: "https://bomet.example.org/",
        mdmsSearchPath: "egov-mdms-service/v1/_search",
        mdmsV2SearchPath: "mdms-v2/v2/_search",
        cityExternalWebpagePath: "citizen/openlink/whatsapp/city",
        localityExternalWebpagePath: "citizen/openlink/whatsapp/locality",
        urlShortnerEndpoint: "egov-url-shortening/shortener",
      },
    },
  };
  require.cache[locPath] = {
    id: locPath, filename: locPath, loaded: true,
    exports: { getMessageBundleForCode: () => ({ en_IN: undefined }) },
  };
  return require(svcPath);
}

/** Stub fetchMdmsData so we control exactly what each master returns. */
function withMasters(svc, { citymodule = [], tenants = [] }) {
  svc.fetchMdmsData = async (tenantId, moduleName, masterName) => {
    if (masterName === "citymodule") return citymodule;
    if (masterName === "tenants") return tenants;
    throw new Error("unexpected master " + masterName);
  };
  return svc;
}

test("REGRESSION NEW2: cities come from tenant.tenants, not a static seed", async () => {
  const svc = withMasters(load(), {
    citymodule: [],
    tenants: [{ code: "ke" }, { code: "ke.mycity" }, { code: "ke.othercity" }],
  });
  const { cities } = await svc.fetchCities("ke");
  // The STATE root is excluded: filing there puts the complaint where no boundaries or
  // employees exist, so it lands in nobody's inbox.
  assert.deepEqual(cities, ["ke.mycity", "ke.othercity"]);
});

test("REGRESSION NEW2: a citymodule row listing only the state root is ignored", async () => {
  const svc = withMasters(load(), {
    citymodule: ["ke"],                                   // the mis-seeded shape
    tenants: [{ code: "ke" }, { code: "ke.mycity" }],
  });
  const { cities } = await svc.fetchCities("ke");
  assert.deepEqual(cities, ["ke.mycity"]);
});

test("NEW2: a real citymodule override still restricts the list", async () => {
  const svc = withMasters(load(), {
    citymodule: ["ke.mycity"],
    tenants: [{ code: "ke" }, { code: "ke.mycity" }, { code: "ke.othercity" }],
  });
  const { cities } = await svc.fetchCities("ke");
  assert.deepEqual(cities, ["ke.mycity"]);
});

test("NEW2: a single-tenant deployment falls back to the state root rather than an empty list", async () => {
  const svc = withMasters(load(), { citymodule: [], tenants: [{ code: "ke" }] });
  const { cities } = await svc.fetchCities("ke");
  // An empty list is a dead end the citizen cannot get past.
  assert.deepEqual(cities, ["ke"]);
});

test("NEW2: an MDMS failure degrades to the state root, not a crash", async () => {
  const svc = load();
  svc.fetchMdmsData = async () => { throw new Error("MDMS 503"); };
  const { cities } = await svc.fetchCities("ke");
  assert.deepEqual(cities, ["ke"]);
});

test("REGRESSION NEW3: a blank business number omits &phone= entirely", async () => {
  const svc = load();
  let captured = null;
  svc.getShortenedURL = async (u) => { captured = u; return "short"; };
  for (const blank of ["", null, undefined]) {
    await svc.getCityExternalWebpageLink("ke.mycity", blank);
    assert.ok(!/phone=/.test(captured), `phone= leaked for ${JSON.stringify(blank)}: ${captured}`);
    assert.ok(!/null/.test(captured), `literal null leaked: ${captured}`);
  }
});

test("REGRESSION NEW3: the business number is used as-is, not re-prefixed with the tenant code", async () => {
  const svc = load();
  let captured = null;
  svc.getShortenedURL = async (u) => { captured = u; return "short"; };
  // Kenyan tenant on the Twilio US sandbox sender. Normalising against the ke rule produced
  // phone=%2B25414155238886 -- a dead wa.me target.
  await svc.getCityExternalWebpageLink("ke.mycity", "14155238886");
  assert.match(captured, /phone=%2B14155238886/);
  assert.ok(!/25414155238886/.test(captured), captured);
});

test("REGRESSION NEW3: the locality deep link behaves identically", async () => {
  const svc = load();
  let captured = null;
  svc.getShortenedURL = async (u) => { captured = u; return "short"; };
  await svc.getLocalityExternalWebpageLink("ke.mycity", "14155238886");
  assert.match(captured, /phone=%2B14155238886/);
  await svc.getLocalityExternalWebpageLink("ke.mycity", "");
  assert.ok(!/phone=/.test(captured));
});
