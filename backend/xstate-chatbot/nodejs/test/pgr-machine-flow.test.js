const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { Machine, interpret } = require("xstate");

const projectRoot = path.resolve(__dirname, "..");
const p = (rel) => path.join(projectRoot, rel);

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}
async function settle(turns = 10) {
  for (let i = 0; i < turns; i += 1) await flush();
}

function stub(file, exports) {
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

// The live filing machine, with only its I/O collaborators replaced. Unlike the
// old pgr-flow.test.js -- which drove the table-generated pgr.js that nothing in
// the production require chain loads -- this is the machine citizens actually hit.
function loadLiveMachine({ service, localisation }) {
  for (const f of [p("src/machine/pgr-machine.js"), p("src/machine/flow/pgr-messages.js")]) delete require.cache[f];

  stub(p("src/env-variables.js"), {
    pgrUseCase: { geoSearch: false },
    supportedLocales: "pt_PT",
    defaultLocale: "pt_PT",
    rootTenantId: "mz",
    timeZone: "Africa/Maputo",
    dateFormat: "DD/MM/YYYY",
    egovServices: {},
    kafka: { kafkaConsumerEnabled: false },
    instituteNameMaxLength: 300,
    descriptionMinLength: 20,
    caseRelatedTo: "IGE",
    maxMediaSizeMb: 5,
  });
  stub(p("src/machine/service/service-loader.js"), { pgrService: service });
  stub(p("src/machine/util/localisation-service.js"), localisation);

  return require(p("src/machine/pgr-machine.js"));
}

function harness({ service, localisation = { getMessageBundleForCode: () => undefined, getLocales: () => [] } }) {
  const outputs = [];
  const pgr = loadLiveMachine({ service, localisation });

  const machine = Machine({
    id: "root",
    initial: "pgr",
    context: {
      user: { locale: "pt_PT", userId: "u-1", name: "Feliciano" },
      extraInfo: { tenantId: "mz", whatsAppBusinessNumber: "258840000001" },
      slots: { pgr: {} },
      chatInterface: { toUser: (user, messages) => outputs.push(...messages) },
    },
    states: {
      pgr: pgr.config,
      welcome: { id: "welcome" },
      endstate: { id: "endstate", type: "final" },
      system_error: {
        id: "system_error",
        entry: (context) => context.chatInterface.toUser(context.user, ["SYSTEM_ERROR"]),
      },
    },
  });

  const interpreter = interpret(machine);
  const say = (input, type = "text") => interpreter.send({ type: "USER_MESSAGE", message: { type, input } });
  return { outputs, service: interpreter, say };
}

/** Two-level complaint hierarchy and a one-level boundary tree, both leaf-terminated. */
function happyPathService(overrides = {}) {
  return {
    fetchComplaintHierarchyStep: async (tenantId, hierarchyPath = []) =>
      hierarchyPath.length === 0
        ? {
            options: ["SAUDE"],
            messageBundle: { SAUDE: { pt_PT: "Saúde" } },
            trailBundle: {},
            levelLabel: "Categoria",
            isLeafLevel: false,
          }
        : {
            options: ["FALTA_MEDICAMENTOS"],
            messageBundle: { FALTA_MEDICAMENTOS: { pt_PT: "Falta de medicamentos" } },
            trailBundle: { SAUDE: { pt_PT: "Saúde" } },
            levelLabel: "Subtipo",
            isLeafLevel: true,
          },
    fetchBoundaryStep: async () => ({
      options: ["kampfumu"],
      messageBundle: { kampfumu: { pt_PT: "KaMpfumu" } },
      levelLabel: "Distrito",
      isLeafLevel: true,
    }),
    persistComplaint: async () => ({ complaintNumber: "PGR-42", filedDate: "18/09/2026" }),
    ...overrides,
  };
}

/** Drives the whole happy path; returns what the citizen was shown. */
async function runHappyPath({ service, localisation }) {
  const h = harness({ service, localisation });
  h.service.start();
  await settle();

  // menu -> file, category, sub-type (leaf), district (leaf)
  for (const reply of ["1", "1", "1", "1"]) {
    h.say(reply);
    await settle();
  }
  h.say("Hospital Central");
  await settle();
  h.say("Faltam medicamentos essenciais no hospital desde a semana passada.");
  await settle();
  // skip attachment, accept consent, not confidential, confirm
  for (const reply of ["1", "1", "2", "1"]) {
    h.say(reply);
    await settle();
  }
  await settle(20);
  return h;
}

test("the live filing flow runs end to end and files the complaint", async () => {
  const persisted = [];
  const service = happyPathService({
    // persistComplaint(user, slots, extraInfo) -- the machine passes the slots,
    // not the whole context.
    persistComplaint: async (user, slots, extraInfo) => {
      persisted.push({ ...slots, tenantId: extraInfo.tenantId, userId: user.userId });
      return { complaintNumber: "PGR-42", filedDate: "18/09/2026" };
    },
  });

  const { outputs } = await runHappyPath({ service });

  assert.equal(persisted.length, 1, "exactly one complaint was filed");
  assert.equal(persisted[0].complaint, "FALTA_MEDICAMENTOS");
  assert.equal(persisted[0].locality, "kampfumu");
  assert.equal(persisted[0].instituteName, "Hospital Central");
  assert.match(persisted[0].description, /medicamentos/);
  assert.ok(!outputs.includes("SYSTEM_ERROR"), "no system error on the happy path");
});

test("the receipt names the top-level category, not the leaf", async () => {
  // Regression: receiptCategory read slots.pgr.hierarchyPath, a slot the live
  // WalkState never writes, so the receipt showed the leaf label or raw code.
  const localisation = {
    getLocales: () => [],
    getMessageBundleForCode: (code) =>
      code === "COMPLAINT_HIERARCHY.SAUDE" ? { pt_PT: "Saúde" } : undefined,
  };

  const { outputs } = await runHappyPath({ service: happyPathService(), localisation });

  const receipt = outputs[outputs.length - 1];
  assert.match(receipt, /Manifestação registada/, "the last message is the receipt");
  assert.match(receipt, /Categoria: Saúde/, "it names the top-level category");
  assert.doesNotMatch(receipt, /FALTA_MEDICAMENTOS/, "never the raw leaf code");
});

test("an empty complaint hierarchy reports a system error instead of looping", async () => {
  // Regression: the complaint-type walk had no onEmpty, so an empty root level
  // showed an empty option list and every reply bounced back to it.
  const service = happyPathService({
    fetchComplaintHierarchyStep: async () => ({
      options: [],
      messageBundle: {},
      trailBundle: {},
      isLeafLevel: false,
    }),
  });

  const h = harness({ service });
  h.service.start();
  await settle();

  h.say("1");
  await settle(20);

  assert.ok(h.outputs.includes("SYSTEM_ERROR"), "the citizen is told, and returned to the menu");
});
