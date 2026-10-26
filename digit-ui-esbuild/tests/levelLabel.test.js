const test = require("node:test");
const assert = require("node:assert");

test("levelLabel prettifies raw codes; translation wins", async () => {
  const { levelLabel } = await import("../products/pgr/src/utils/levelLabel.js");
  const def = { hierarchyType: "complaint" };
  const id = (k) => k;
  assert.equal(levelLabel(id, def, { levelCode: "AUTHORITY_TYPE", label: "AUTHORITY_TYPE" }), "Authority Type");
  assert.equal(levelLabel(id, def, { levelCode: "AUTHORITY_TYPE" }), "Authority Type");
  assert.equal(levelLabel(id, def, { levelCode: "SECTOR", label: "Sector Name" }), "Sector Name");
  const tr = (k) => (k === "COMPLAINT_AUTHORITY_TYPE" ? "Autorite" : k);
  assert.equal(levelLabel(tr, def, { levelCode: "AUTHORITY_TYPE", label: "AUTHORITY_TYPE" }), "Autorite");
});
