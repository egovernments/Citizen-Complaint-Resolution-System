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

const sent = [];
const channel = stub("../../channel", serviceDir, {
  sendMessageToUser: async (user) => {
    if (user.mobileNumber === "840000002") throw new Error("transport down");
    sent.push(user.mobileNumber);
  },
});
stub("../../session/repo", serviceDir, {
  getActiveStateForUserId: async () => ({ value: { pgr: { fileComplaint: "x" } }, context: { user: { locale: "pt_PT" } } }),
});
stub("../../phone-numbers", serviceDir, { toNationalNumber: async (v) => String(v ?? "") });

const reminders = require(path.join(serviceDir, "reminders-service.js"));
reminders.getContactFromUserId = async (userId) => {
  const mobileNumber = ({ a: "840000001", b: "840000002", c: "840000003" })[userId];
  return mobileNumber ? { mobileNumber, countryCode: "+258" } : null;
};

test("one failed reminder does not stop the sweep, and the sweep reports it", async () => {
  // Unawaited, a transport error was an unhandled rejection and the reminder was
  // lost without a trace.
  await assert.rejects(() => reminders.sendMessages(["a", "b", "c"]), /1 reminder\(s\) could not be delivered/);
  assert.deepEqual(sent, ["840000001", "840000003"], "the citizens around the failure were still reminded");
});

test("a sweep with no failures resolves", async () => {
  sent.length = 0;
  channel.sendMessageToUser = async (user) => { sent.push(user.mobileNumber); };
  await assert.doesNotReject(() => reminders.sendMessages(["a", "c"]));
  assert.deepEqual(sent, ["840000001", "840000003"]);
});
