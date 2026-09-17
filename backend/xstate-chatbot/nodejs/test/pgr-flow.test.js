const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { Machine, interpret } = require("xstate");

const projectRoot = path.resolve(__dirname, "..");
const envPath = path.join(projectRoot, "src/env-variables.js");
const pgrPath = path.join(projectRoot, "src/machine/pgr.js");
const serviceLoaderPath = path.join(
  projectRoot,
  "src/machine/service/service-loader.js"
);
const localisationServicePath = path.join(
  projectRoot,
  "src/machine/util/localisation-service.js"
);

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function settle(turns = 8) {
  for (let index = 0; index < turns; index += 1) {
    await flush();
  }
}

function freshRequire(modulePath) {
  delete require.cache[modulePath];
  return require(modulePath);
}

function loadPgrWithStubs({
  serviceStub,
  localisationStub = { getMessageBundleForCode: () => ({ en_IN: undefined }) },
  geoSearch = true,
}) {
  delete require.cache[pgrPath];
  require.cache[envPath] = {
    id: envPath,
    filename: envPath,
    loaded: true,
    exports: {
      pgrUseCase: {
        geoSearch,
        informationImageFilestoreId: "test-image-id",
      },
      supportedLocales: "en_IN",
      rootTenantId: "pg",
      timeZone: "Asia/Kolkata",
      dateFormat: "DD/MM/YYYY",
      egovServices: {},
      kafka: { kafkaConsumerEnabled: false },
      instituteNameMaxLength: 300,
      descriptionMinLength: 20,
      caseRelatedTo: "IGE",
    },
  };
  require.cache[serviceLoaderPath] = {
    id: serviceLoaderPath,
    filename: serviceLoaderPath,
    loaded: true,
    exports: { pgrService: serviceStub },
  };
  require.cache[localisationServicePath] = {
    id: localisationServicePath,
    filename: localisationServicePath,
    loaded: true,
    exports: localisationStub,
  };

  return freshRequire(pgrPath);
}

function createHarness({ serviceStub, geoSearch = true }) {
  const outputs = [];
  const pgr = loadPgrWithStubs({ serviceStub, geoSearch });
  const machine = Machine({
    id: "root",
    initial: "pgr",
    context: {
      user: {
        locale: "en_IN",
        userId: "user-1",
        name: "Citizen",
      },
      extraInfo: {
        tenantId: "pg",
        whatsAppBusinessNumber: "9999999999",
      },
      slots: {
        pgr: {},
      },
      chatInterface: {
        toUser(user, messages) {
          outputs.push(...messages);
        },
      },
    },
    states: {
      pgr,
      endstate: {
        id: "endstate",
        type: "final",
      },
      system_error: {
        id: "system_error",
        entry: (context) => {
          context.chatInterface.toUser(context.user, ["SYSTEM_ERROR"]);
        },
      },
    },
  });

  return { outputs, service: interpret(machine) };
}

function textMessage(input) {
  return {
    type: "USER_MESSAGE",
    message: {
      type: "text",
      input,
    },
  };
}

function locationMessage(input) {
  return {
    type: "USER_MESSAGE",
    message: {
      type: "location",
      input,
    },
  };
}

function createHappyPathServiceStub(overrides = {}) {
  return {
    fetchOpenComplaints: async () => [
      {
        complaintType: "Streetlight not working",
        complaintNumber: "PGR-1",
        filedDate: "15/04/2024",
        complaintStatus: "Pending assignment",
        complaintLink: "https://example.test/complaints/PGR-1",
      },
    ],
    fetchFrequentComplaints: async () => ({
      complaintTypes: [
        "StreetLightNotWorking",
        "BlockOrOverflowingSewage",
        "GarbageNeedsTobeCleared",
        "BrokenWaterPipeOrLeakage",
      ],
      messageBundle: {
        StreetLightNotWorking: { en_IN: "Streetlight not working" },
        BlockOrOverflowingSewage: { en_IN: "Sewage overflow / blocked" },
        GarbageNeedsTobeCleared: { en_IN: "Garbage not cleared" },
        BrokenWaterPipeOrLeakage: { en_IN: "Pipe broken / leaking" },
      },
    }),
    fetchComplaintHierarchyStep: async (tenantId, hierarchyPath = []) =>
      hierarchyPath.length === 0
        ? {
            options: ["StreetLights"],
            messageBundle: { StreetLights: { en_IN: "Street lights" } },
            trailBundle: {},
            levelLabel: "Category",
            isLeafLevel: false,
          }
        : {
            options: ["StreetLightNotWorking"],
            messageBundle: { StreetLightNotWorking: { en_IN: "Streetlight not working" } },
            trailBundle: { StreetLights: { en_IN: "Street lights" } },
            levelLabel: "Sub-Type",
            isLeafLevel: true,
          },
    fetchComplaintCategories: async () => ({
      complaintCategories: ["StreetLights"],
      messageBundle: {
        StreetLights: { en_IN: "Street lights" },
      },
    }),
    fetchComplaintItemsForCategory: async () => ({
      complaintItems: ["StreetLightNotWorking"],
      messageBundle: {
        StreetLightNotWorking: { en_IN: "Streetlight not working" },
      },
    }),
    getCityAndLocalityForGeocode: async () => ({
      city: "pg.citya",
      locality: "loc-1",
      matchedCityMessageBundle: { en_IN: "CityA" },
      matchedLocalityMessageBundle: { en_IN: "LocalityA" },
    }),
    getCity: async () => ({
      predictedCityCode: "pg.citya",
      predictedCity: "CityA",
      isCityDataMatch: true,
    }),
    getLocality: async () => ({
      predictedLocalityCode: "loc-1",
      predictedLocality: "LocalityA",
      isLocalityDataMatch: true,
    }),
    fetchCitiesAndWebpageLink: async () => ({
      cities: ["pg.citya"],
      messageBundle: {
        "pg.citya": { en_IN: "CityA" },
      },
      link: "https://example.test/cities",
    }),
    fetchLocalitiesAndWebpageLink: async () => ({
      localities: ["loc-1"],
      messageBundle: {
        "loc-1": { en_IN: "LocalityA" },
      },
      link: "https://example.test/localities",
    }),
    fetchBoundaryStep: async (tenantId, boundaryPath = []) =>
      boundaryPath.length === 0
        ? {
            options: ["pg.citya"],
            messageBundle: { "pg.citya": { en_IN: "CityA" } },
            levelLabel: "City",
            isLeafLevel: false,
          }
        : {
            options: ["loc-1"],
            messageBundle: { "loc-1": { en_IN: "LocalityA" } },
            levelLabel: "Ward",
            isLeafLevel: true,
          },
    persistComplaint: async () => ({
      complaintNumber: "PGR-1",
      complaintLink: "https://example.test/complaints/PGR-1",
    }),
    ...overrides,
  };
}

function mediaMessage(type = "image", input = "https://files.test/x.jpg") {
  return { type: "USER_MESSAGE", message: { type, input } };
}

/**
 * Drives a harness through a table of turns.
 *   send  — text to send (string), or a full event object
 *   expect— regex(es) the LAST outbound message must match
 *   saw   — regex(es) that some message in the transcript must match
 *   at    — state value the machine must be in (service.state.matches)
 *   slots — subset of context.slots.pgr to deep-equal
 *   done  — assert the machine reached a final state
 */
async function runRows({ service, outputs }, rows) {
  service.start();
  await settle();
  for (const [index, row] of rows.entries()) {
    const where = `row ${index}${row.send === undefined ? "" : ` (send ${JSON.stringify(row.send)})`}`;
    if (row.send !== undefined) {
      service.send(typeof row.send === "string" ? textMessage(row.send) : row.send);
      await settle();
    }
    for (const pattern of [].concat(row.expect || [])) {
      assert.match(String(outputs.at(-1)), pattern, where);
    }
    for (const pattern of [].concat(row.saw || [])) {
      assert.ok(outputs.some((message) => pattern.test(String(message))), `${where}: never saw ${pattern}`);
    }
    if (row.at) assert.equal(service.state.matches(row.at), true, `${where}: not at ${JSON.stringify(row.at)}`);
    if (row.slots) {
      const actual = {};
      for (const key of Object.keys(row.slots)) actual[key] = service.state.context.slots.pgr[key];
      assert.deepEqual(actual, row.slots, where);
    }
    if (row.done) assert.equal(service.state.done, true, `${where}: expected a final state`);
  }
  return { service, outputs };
}

// ---------------------------------------------------------------------------
// Live filing flow
// ---------------------------------------------------------------------------

test("filing happy path walks hierarchy, details, boundary, consent and files", async () => {
  await runRows(createHarness({ serviceStub: createHappyPathServiceStub() }), [
    { expect: /type and send the number for your option/ },
    { send: "1", expect: /select a Category/ },
    { send: "1", expect: /select a Sub-Type/, saw: /Street lights/ },
    { send: "1", expect: /Which institution is your grievance about/, slots: { complaint: "StreetLightNotWorking" } },
    { send: "  Ministry of Water  ", expect: /describe your grievance in one message/, slots: { instituteName: "Ministry of Water" } },
    { send: "The street light has been out for three weeks", expect: /attach a photo or document/ },
    { send: "1", expect: /select the City for your grievance/ },
    { send: "1", expect: /select the Ward for your grievance/ },
    { send: "1", expect: /please confirm the following/, slots: { locality: "loc-1", city: "pg" } },
    { send: "1", expect: /Keep details confidential/ },
    {
      send: "1",
      expect: /registered successfully/,
      slots: { isConfidential: true },
      done: true,
    },
  ]);
});

test("filing happy path records a declined confidentiality choice", async () => {
  await runRows(createHarness({ serviceStub: createHappyPathServiceStub() }), [
    { send: "1" },
    { send: "1" },
    { send: "1" },
    { send: "Ministry of Water" },
    { send: "The street light has been out for three weeks" },
    { send: "1" },
    { send: "1" },
    { send: "1" },
    { send: "1", expect: /Keep details confidential/ },
    { send: "2", expect: /registered successfully/, slots: { isConfidential: false }, done: true },
  ]);
});

test("invalid complaint choice retries and returns to the hierarchy question", async () => {
  await runRows(createHarness({ serviceStub: createHappyPathServiceStub() }), [
    { send: "1", expect: /select a Category/ },
    {
      send: "9",
      saw: /Selected option seems to be invalid/,
      expect: /select a Category/,
      // The one structural assertion in this file: proof that the generated
      // walk still lives at the same path the hand-written one did.
      at: { pgr: { fileComplaint: { type: { complaintType2Step: "question" } } } },
    },
  ]);
});

test("go back from a hierarchy sub-level returns to the level above", async () => {
  await runRows(createHarness({ serviceStub: createHappyPathServiceStub() }), [
    { send: "1", expect: /select a Category/ },
    { send: "1", expect: /select a Sub-Type/ },
    { send: "2", expect: /select a Category/, at: { pgr: { fileComplaint: { type: { complaintType2Step: "question" } } } } },
  ]);
});

test("an over-long institution name is rejected with its own message", async () => {
  await runRows(createHarness({ serviceStub: createHappyPathServiceStub() }), [
    { send: "1" },
    { send: "1" },
    { send: "1", expect: /Which institution is your grievance about/ },
    { send: "x".repeat(301), saw: /That name is too long/, expect: /Which institution is your grievance about/ },
    { send: "Ministry of Water", expect: /describe your grievance/, slots: { instituteName: "Ministry of Water" } },
  ]);
});

test("a too-short description is rejected with its own message", async () => {
  await runRows(createHarness({ serviceStub: createHappyPathServiceStub() }), [
    { send: "1" },
    { send: "1" },
    { send: "1" },
    { send: "Ministry of Water", expect: /describe your grievance/ },
    { send: "too short", saw: /That description is too short/, expect: /describe your grievance/ },
    { send: "a description that is comfortably long enough", expect: /attach a photo or document/ },
  ]);
});

test("an attachment is stored, and junk at the attachment prompt retries", async () => {
  await runRows(createHarness({ serviceStub: createHappyPathServiceStub() }), [
    { send: "1" },
    { send: "1" },
    { send: "1" },
    { send: "Ministry of Water" },
    { send: "a description that is comfortably long enough", expect: /attach a photo or document/ },
    { send: "nope", saw: /Selected option seems to be invalid/, expect: /attach a photo or document/ },
    {
      send: mediaMessage("image"),
      expect: /select the City for your grievance/,
      slots: { image: "https://files.test/x.jpg" },
    },
  ]);
});

test("declining consent sends the declined notice and ends the session", async () => {
  await runRows(createHarness({ serviceStub: createHappyPathServiceStub() }), [
    { send: "1" },
    { send: "1" },
    { send: "1" },
    { send: "Ministry of Water" },
    { send: "a description that is comfortably long enough" },
    { send: "1" },
    { send: "1" },
    { send: "1", expect: /please confirm the following/ },
    { send: "2", expect: /has not been filed/, done: true },
  ]);
});

test("unrecognised input at the consent prompt retries instead of proceeding", async () => {
  await runRows(createHarness({ serviceStub: createHappyPathServiceStub() }), [
    { send: "1" },
    { send: "1" },
    { send: "1" },
    { send: "Ministry of Water" },
    { send: "a description that is comfortably long enough" },
    { send: "1" },
    { send: "1" },
    { send: "1", expect: /please confirm the following/ },
    { send: "9", saw: /Selected option seems to be invalid/, expect: /please confirm the following/ },
    { send: "1", expect: /Keep details confidential/ },
  ]);
});

test("a location pin at the confidentiality prompt retries instead of throwing", async () => {
  await runRows(createHarness({ serviceStub: createHappyPathServiceStub() }), [
    { send: "1" },
    { send: "1" },
    { send: "1" },
    { send: "Ministry of Water" },
    { send: "a description that is comfortably long enough" },
    { send: "1" },
    { send: "1" },
    { send: "1" },
    { send: "1", expect: /Keep details confidential/ },
    { send: locationMessage({ latitude: 1, longitude: 2 }), saw: /Selected option seems to be invalid/, expect: /Keep details confidential/ },
  ]);
});

// ---------------------------------------------------------------------------
// Failure routing and complaint tracking
// ---------------------------------------------------------------------------

test("service failure on startup routes to system error", async () => {
  const { outputs } = await runRows(
    createHarness({
      serviceStub: createHappyPathServiceStub({
        fetchComplaintHierarchyStep: async () => {
          throw new Error("mdms down");
        },
      }),
    }),
    [{ send: "1" }]
  );
  assert.equal(outputs.at(-1), "SYSTEM_ERROR");
});

test("a persist failure routes to system error instead of wedging", async () => {
  const { outputs } = await runRows(
    createHarness({
      serviceStub: createHappyPathServiceStub({
        persistComplaint: async () => {
          throw new Error("pgr-services down");
        },
      }),
    }),
    [
      { send: "1" },
      { send: "1" },
      { send: "1" },
      { send: "Ministry of Water" },
      { send: "a description that is comfortably long enough" },
      { send: "1" },
      { send: "1" },
      { send: "1" },
      { send: "1" },
      { send: "1" },
    ]
  );
  assert.equal(outputs.at(-1), "SYSTEM_ERROR");
});

test("track complaint lists recent complaints and exits cleanly", async () => {
  await runRows(
    createHarness({
      serviceStub: createHappyPathServiceStub({
        fetchOpenComplaints: async () => [
          {
            complaintType: "Streetlight not working",
            complaintNumber: "PGR-1",
            filedDate: "15/04/2024",
            complaintStatus: "Pending assignment",
          },
          {
            complaintType: "Garbage not cleared",
            complaintNumber: "PGR-2",
            filedDate: "18/04/2024",
            complaintStatus: "Under review",
          },
        ],
      }),
    }),
    [
      {
        send: "2",
        expect: [
          /Here are your recent complaints/,
          /Streetlight not working/,
          /Garbage not cleared/,
          /Pending assignment/,
          /Under review/,
        ],
        done: true,
      },
    ]
  );
});

test("track complaint handles no-records case", async () => {
  await runRows(
    createHarness({
      serviceStub: createHappyPathServiceStub({ fetchOpenComplaints: async () => [] }),
    }),
    [{ send: "2", expect: /No complaint records were found/, done: true }]
  );
});

// ---------------------------------------------------------------------------
// Retained coverage for the unreachable geo/fuzzy-search location flow.
//
// These five drove src/machine/flow/legacy-location.js back when `location`
// entered geoLocationSharingInfo. The boundary walk replaced that entry point,
// so the states still exist (and still compile) but nothing routes into them.
// They are skipped rather than deleted so the dead flow keeps its description
// of intended behaviour; reviving it means restoring the entry point and these.
// ---------------------------------------------------------------------------

const GEO_SKIP = "unreachable: the boundary walk replaced the geo/fuzzy-search entry point";

test("happy path files a complaint through fuzzy city and locality search", { skip: GEO_SKIP }, () => {});
test("see more path reaches complaint item selection", { skip: "stale: the two-step picker with a See more option was replaced by the MDMS hierarchy walk" }, () => {});
test("rejecting fuzzy city confirmation loops back to city entry", { skip: GEO_SKIP }, () => {});
test("shared geolocation with confirmed locality persists immediately", { skip: GEO_SKIP }, () => {});
test("persist complaint degrades gracefully when the backend omits complaint data", { skip: GEO_SKIP }, () => {});
