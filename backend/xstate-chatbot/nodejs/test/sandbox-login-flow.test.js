const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const sessionDir = path.join(projectRoot, "src/session");

function stub(request, from, exports) {
  const filename = require.resolve(request, { paths: [from] });
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
  return exports;
}

stub("../env-variables", sessionDir, { rootTenantId: "mz", countryCode: "258", defaultLocale: "pt_PT", supportedLocales: "pt_PT" });
stub("./repo", sessionDir, {});
stub("./user-service", sessionDir, {});
stub("../machine/service/email-tenant-service", sessionDir, {});

const SandboxLoginFlow = require(path.join(sessionDir, "sandbox-login-flow.js"));
const { ExternalServiceError } = require(path.join(sessionDir, "errors.js"));

function harness({ authenticateUser } = {}) {
  const sent = [];
  const deleted = [];
  const tracker = {
    expireIfStale: () => {},
    isWaitingForEmail: () => false,
    isWaitingForOrgSelection: () => false,
    delete: (n) => deleted.push(n),
    set: () => {},
  };
  const model = {
    user: { mobileNumber: "840000000" },
    extraInfo: { tenantId: "mz" },
    getMessage: () => ({ isGreeting: () => false, getInputMessage: () => "x" }),
  };

  const flow = new SandboxLoginFlow(model, tracker, authenticateUser, async (user, messages) => {
    sent.push({ mobileNumber: user.mobileNumber, messages });
  });
  return { flow, sent, deleted };
}

test("a login prompt goes through the injected queued sender", async () => {
  // It used to call channelProvider.sendMessageToUser directly and unawaited,
  // bypassing the per-user ordering in SessionManager.toUser.
  const { flow, sent } = harness();

  const result = await flow.notifyAndStop(["Enter your registered email address"]);

  assert.equal(result, null, "the turn still stops");
  assert.equal(sent.length, 1, "exactly one queued send");
  assert.equal(sent[0].mobileNumber, "840000000");
  assert.deepEqual(sent[0].messages, ["Enter your registered email address"]);
});

test("notifyAndStop resolves only after the send completes", async () => {
  let delivered = false;
  const model = {
    user: { mobileNumber: "840000000" },
    extraInfo: {},
    getMessage: () => ({ isGreeting: () => false }),
  };
  const flow = new SandboxLoginFlow(model, {}, null, async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    delivered = true;
  });

  await flow.notifyAndStop(["hello"]);

  assert.equal(delivered, true, "a later reply cannot overtake this prompt");
});

test("every authentication failure surfaces, none is read as not-registered", async () => {
  // Two earlier shapes, both wrong: ANY error deleted the tracker and told the
  // citizen to re-register, then only a NotRegisteredError did. Nothing could
  // reach the second — getAuthenticatedSandboxUser goes through
  // loginOrCreateUser, which CREATES the citizen when absent, so "not
  // registered" is not a state this flow can produce.
  for (const error of [
    new ExternalServiceError("user/_search failed with status 503"),
    new Error("Failed to authenticate or create user in tenant mz.ige"),
  ]) {
    const { flow, sent, deleted } = harness({ authenticateUser: async () => { throw error; } });

    await assert.rejects(
      () => flow.authenticateForOrg({ code: "mz.ige", name: "IGE" }, "citizen@example.mz"),
      (thrown) => thrown === error,
      "the real error surfaces unchanged"
    );
    assert.deepEqual(deleted, [], "the tracker is preserved");
    assert.deepEqual(sent, [], "and nothing tells the citizen to re-register");
  }
});
