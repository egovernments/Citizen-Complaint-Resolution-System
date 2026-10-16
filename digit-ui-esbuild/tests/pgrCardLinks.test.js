// Pins who sees the PGR home card's links now that every employee holds CSR
// (#2239): CSR files complaints, but the Configure Master admin screen stays
// with admin roles.
// Run from digit-ui-esbuild/:  node --test tests/pgrCardLinks.test.js
//
// PGRCard.js is ESM JSX, so the test bundles it to CJS with the repo's own
// esbuild and swaps React, i18n and the component library for stubs; the card
// then returns the props it would hand EmployeeModuleCard.

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const STUBS = {
  react: "export default { createElement: (type, props) => ({ type, props }) }; export const useEffect = () => {}; export const useState = (v) => [v, () => {}];",
  "react-i18next": "export const useTranslation = () => ({ t: (key) => key });",
  "react-router-dom": "export const Link = () => null;",
  "@egovernments/digit-ui-react-components": "export const EmployeeModuleCard = () => null; export const SVG = {};",
};
const stubs = {
  name: "stubs",
  setup(build) {
    build.onResolve({ filter: /^(react|react-i18next|react-router-dom|@egovernments\/digit-ui-react-components)$/ }, (args) => ({ path: args.path, namespace: "stub" }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: STUBS[args.path], loader: "js" }));
  },
};

const load = async (entry, name) => {
  const out = path.join(os.tmpdir(), `pgrCard.${name}.${process.pid}.cjs`);
  await esbuild.build({ entryPoints: [entry], bundle: true, format: "cjs", platform: "node", outfile: out, logLevel: "silent", plugins: [stubs], loader: { ".js": "jsx" } });
  process.on("exit", () => fs.rmSync(out, { force: true }));
  return require(out).default;
};
// The app builds products/pgr (esbuild.build.js aliases the PGR module to it); packages/modules/pgr is the upstream copy.
const cards = {};
before(async () => {
  cards["products/pgr"] = await load(path.join(__dirname, "../products/pgr/src/components/PGRCard.js"), "product");
  cards["packages/modules/pgr"] = await load(path.join(__dirname, "../packages/modules/pgr/src/components/PGRCard.js"), "upstream");
});

const linksFor = (Card, roles, multiRoot = false) => {
  global.window = { contextPath: "digit-ui" };
  global.Digit = { Utils: { pgrAccess: () => true, getMultiRootTenant: () => multiRoot, didEmployeeHasAtleastOneRole: (wanted) => wanted.some((r) => roles.includes(r)) } };
  const element = Card();
  return element ? element.props.links.map((l) => l.link) : [];
};
const configureMaster = (links) => links.some((link) => link.includes("setup-master"));
const create = (links) => links.some((link) => /complaint\/create|create-complaint/.test(link));

for (const name of ["products/pgr", "packages/modules/pgr"]) {
  test(`${name}: a field employee with CSR can file a complaint but gets no Configure Master link`, () => {
    const Card = cards[name];
    for (const roles of [["EMPLOYEE", "CSR"], ["GRO", "CSR"], ["PGR_LME", "CSR"]]) {
      const links = linksFor(Card, roles);
      assert.ok(create(links), `${roles} can file`);
      assert.ok(!configureMaster(links), `${roles} sees no Configure Master`);
    }
    assert.ok(!configureMaster(linksFor(Card, ["CSR"], true)), "multi-root CSR sees no Configure Master");
  });
}

test("packages/modules/pgr: an MDMS admin or SUPERUSER keeps Configure Master", () => {
  assert.ok(configureMaster(linksFor(cards["packages/modules/pgr"], ["MDMS_ADMIN"])));
  assert.ok(configureMaster(linksFor(cards["packages/modules/pgr"], ["SUPERUSER"])));
});
