const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const serviceDir = path.join(projectRoot, "src/machine/service");

function stub(request, from, exports) {
  const filename = require.resolve(request, { paths: [from] });
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
  return exports;
}

stub("../../env-variables", serviceDir, {
  timeouts: { request: 20000 },
  egovServices: { userServiceHost: "http://user/", userServiceUpdateNoValidatePath: "user/users/_updatenovalidate" },
});
stub("../../session/user-service", serviceDir, {
  getServiceAccount: async () => ({ authToken: "t", userInfo: {} }),
  serviceRequestInfo: () => ({}),
});

let nextResponse;
let sentBody;
stub("node-fetch", serviceDir, async (url, options) => {
  sentBody = JSON.parse(options.body);
  return nextResponse;
});

const profileService = require(path.join(serviceDir, "egov-user-profile.js"));

const citizen = () => ({ userInfo: { uuid: "u-1", name: "Cidadão", locale: "en_IN" } });

test("a failed update leaves the session's profile as it was", async () => {
  // The session is persisted even when this request fails; mutating first marked
  // the citizen onboarded while egov-user kept the placeholder.
  nextResponse = { status: 500, text: async () => "boom" };
  const user = citizen();

  await assert.rejects(() => profileService.updateUser(user, { name: "Maria", locale: "pt_PT" }, "mz"));

  assert.deepEqual(user.userInfo, { uuid: "u-1", name: "Cidadão", locale: "en_IN" });
  assert.equal(sentBody.user.name, "Maria", "the request still carried the new values");
});

test("a successful update is copied into the session", async () => {
  nextResponse = { status: 200, json: async () => ({ user: [] }) };
  const user = citizen();

  await profileService.updateUser(user, { name: "Maria", locale: "pt_PT" }, "mz");

  assert.equal(user.userInfo.name, "Maria");
  assert.equal(user.userInfo.locale, "pt_PT");
});
