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
    persistComplaint: async () => ({
      complaintNumber: "PGR-1",
      complaintLink: "https://example.test/complaints/PGR-1",
    }),
    ...overrides,
  };
}

test("happy path files a complaint through fuzzy city and locality search", async () => {
  const { service, outputs } = createHarness({
    serviceStub: createHappyPathServiceStub(),
    geoSearch: true,
  });

  service.start();
  await settle();
  assert.match(String(outputs.at(-1)), /File a new complaint/);

  service.send(textMessage("1"));
  await settle();
  assert.match(String(outputs.at(-1)), /What is the complaint about/);

  service.send(textMessage("1"));
  await settle();
  assert.deepEqual(outputs.at(-2), { type: "image", output: "test-image-id" });
  assert.match(String(outputs.at(-1)), /Please share your location/);

  service.send(textMessage("1"));
  await settle();
  assert.match(String(outputs.at(-1)), /Enter the name of your city/);

  service.send(textMessage("CityA"));
  await settle();
  assert.match(String(outputs.at(-1)), /Enter the name of your locality/);

  service.send(textMessage("LocalityA"));
  await settle();
  assert.match(String(outputs.at(-1)), /PGR-1/);
  assert.match(String(outputs.at(-1)), /https:\/\/example\.test\/complaints\/PGR-1/);
  assert.equal(service.state.done, true);
});

test("invalid complaint choice retries and returns to the frequent complaints question", async () => {
  const { service, outputs } = createHarness({
    serviceStub: createHappyPathServiceStub(),
  });

  service.start();
  await settle();
  const promptCountBefore = outputs.length;

  service.send(textMessage("1"));
  await settle();

  service.send(textMessage("9"));
  await settle();

  assert.ok(
    outputs.slice(promptCountBefore).some((message) =>
      /Selected option seems to be invalid/.test(String(message))
    )
  );
  assert.match(String(outputs.at(-1)), /What is the complaint about/);
  assert.equal(
    service.state.matches({
      pgr: { fileComplaint: { type: { complaintType: "question" } } },
    }),
    true
  );
});

test("see more path reaches complaint item selection", async () => {
  const { service, outputs } = createHarness({
    serviceStub: createHappyPathServiceStub(),
  });

  service.start();
  await settle();
  service.send(textMessage("1"));
  await settle();

  service.send(textMessage("5"));
  await settle();
  assert.match(
    String(outputs.at(-1)),
    /select a complaint type from the list below/
  );

  service.send(textMessage("1"));
  await settle();
  assert.match(String(outputs.at(-1)), /What is the problem you are facing/);

  service.send(textMessage("1"));
  await settle();
  assert.match(String(outputs.at(-1)), /attach a photo of your grievance/);
});

test("rejecting fuzzy city confirmation loops back to city entry", async () => {
  const serviceStub = createHappyPathServiceStub({
    getCity: async () => ({
      predictedCityCode: "pg.citya",
      predictedCity: "CityA",
      isCityDataMatch: false,
    }),
  });
  const { service, outputs } = createHarness({ serviceStub });

  service.start();
  await settle();
  service.send(textMessage("1"));
  await settle();
  service.send(textMessage("1"));
  await settle();
  service.send(textMessage("1"));
  await settle();

  service.send(textMessage("ctya"));
  await settle();
  assert.match(String(outputs.at(-1)), /Did you mean \*“CityA”\*/);

  service.send(textMessage("2"));
  await settle();
  assert.match(String(outputs.at(-1)), /Enter the name of your city/);
});

test("shared geolocation with confirmed locality persists immediately", async () => {
  const { service, outputs } = createHarness({
    serviceStub: createHappyPathServiceStub(),
  });

  service.start();
  await settle();
  service.send(textMessage("1"));
  await settle();
  service.send(textMessage("1"));
  await settle();

  service.send(locationMessage("{12.34,56.78}"));
  await settle();
  assert.match(String(outputs.at(-1)), /Is this the correct location of the complaint/);
  assert.match(String(outputs.at(-1)), /City: CityA/);
  assert.match(String(outputs.at(-1)), /Locality: LocalityA/);

  service.send(textMessage("2"));
  await settle();
  assert.match(String(outputs.at(-1)), /PGR-1/);
  assert.equal(service.state.done, true);
});

test("persist complaint degrades gracefully when the backend omits complaint data", async () => {
  const { service, outputs } = createHarness({
    serviceStub: createHappyPathServiceStub({
      persistComplaint: async () => ({}),
    }),
  });

  service.start();
  await settle();
  service.send(textMessage("1"));
  await settle();
  service.send(textMessage("1"));
  await settle();
  service.send(textMessage("1"));
  await settle();
  service.send(textMessage("CityA"));
  await settle();
  service.send(textMessage("LocalityA"));
  await settle();

  assert.match(String(outputs.at(-1)), /N\/A/);
  assert.match(String(outputs.at(-1)), /#\n/);
});

test("service failure on startup routes to system error", async () => {
  const { service, outputs } = createHarness({
    serviceStub: createHappyPathServiceStub({
      fetchFrequentComplaints: async () => {
        throw new Error("backend failed");
      },
    }),
  });

  service.start();
  await settle();
  service.send(textMessage("1"));
  await settle();
  assert.equal(outputs.at(-1), "SYSTEM_ERROR");
});

test("track complaint lists recent complaints and exits cleanly", async () => {
  const { service, outputs } = createHarness({
    serviceStub: createHappyPathServiceStub({
      fetchOpenComplaints: async () => [
        {
          complaintType: "Streetlight not working",
          complaintNumber: "PGR-1",
          filedDate: "15/04/2024",
          complaintStatus: "Pending assignment",
          complaintLink: "https://example.test/complaints/PGR-1",
        },
        {
          complaintType: "Garbage not cleared",
          complaintNumber: "PGR-2",
          filedDate: "18/04/2024",
          complaintStatus: "Under review",
          complaintLink: "https://example.test/complaints/PGR-2",
        },
      ],
    }),
  });

  service.start();
  await settle();
  service.send(textMessage("2"));
  await settle();

  assert.match(String(outputs.at(-1)), /Here are your recent complaints/);
  assert.match(String(outputs.at(-1)), /Streetlight not working/);
  assert.match(String(outputs.at(-1)), /Garbage not cleared/);
  assert.match(String(outputs.at(-1)), /Pending assignment/);
  assert.match(String(outputs.at(-1)), /Under review/);
  assert.equal(service.state.done, true);
});

test("track complaint handles no-records case", async () => {
  const { service, outputs } = createHarness({
    serviceStub: createHappyPathServiceStub({
      fetchOpenComplaints: async () => [],
    }),
  });

  service.start();
  await settle();
  service.send(textMessage("2"));
  await settle();

  assert.match(String(outputs.at(-1)), /No complaint records were found/);
  assert.equal(service.state.done, true);
});
