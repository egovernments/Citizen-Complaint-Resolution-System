// The citizen home banner (#2358): off by flag, absent without an image, and a
// welcome with the two complaint links when both are there.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");
require("react-test-renderer");
const root = path.resolve(__dirname, "..");
const OUT = path.join(os.tmpdir(), `citizen-home-banner.${process.pid}.cjs`);
let ui;

before(async () => {
  await esbuild.build({
    stdin: {
      contents: `
        export { default as React } from 'react';
        export { create, act } from 'react-test-renderer';
        export { MemoryRouter } from 'react-router-dom';
        export { default as CitizenHomeBanner, citizenBannerEnabled } from './packages/modules/core/src/components/CitizenHomeBanner';
      `,
      resolveDir: root,
      loader: "jsx",
    },
    bundle: true, platform: "node", format: "cjs", outfile: OUT, loader: { ".js": "jsx" },
    nodePaths: [path.join(root, "node_modules")],
    plugins: [{ name: "i18n-double", setup(build) {
      build.onResolve({ filter: /^react$|^react-test-renderer$|^react-dom$/ }, (args) => ({ path: require.resolve(args.path), external: true }));
      build.onResolve({ filter: /^react-i18next$/ }, () => ({ path: "react-i18next", namespace: "double" }));
      build.onLoad({ filter: /.*/, namespace: "double" }, () => ({ contents: "export const useTranslation = () => ({ t: (key) => key });", loader: "js" }));
    } }],
  });
  ui = require(OUT);
});
after(() => { fs.unlinkSync(OUT); delete global.window; delete global.Digit; });

function page({ flag, stateInfo }) {
  global.window = { contextPath: "bomet/digit-ui", globalConfigs: { getConfig: (key) => (key === "CITIZEN_BANNER_ENABLED" ? flag : undefined) } };
  global.Digit = { Hooks: { useStore: { getInitData: () => ({ data: { stateInfo } }) } } };
}
const text = (node) => node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
async function render() {
  const { React, MemoryRouter, CitizenHomeBanner } = ui;
  let view;
  await ui.act(async () => {
    view = ui.create(
      React.createElement(MemoryRouter, null, React.createElement(CitizenHomeBanner, null, React.createElement("main", { id: "services" }, "All Services"))),
    );
  });
  return view;
}
const banner = (view) => view.root.findAll((node) => node.props.className === "cms-home-banner");

test("reads only an explicit true, in either form, as on", () => {
  for (const [flag, on] of [[true, true], ["true", true], [false, false], [undefined, false], ["yes", false]]) {
    page({ flag, stateInfo: {} });
    assert.equal(ui.citizenBannerEnabled(), on, `flag ${JSON.stringify(flag)}`);
  }
});

test("with the flag off the page is untouched, even with a banner set", async () => {
  page({ flag: false, stateInfo: { name: "Bomet County", bannerUrl: "https://img/banner.jpg" } });
  const view = await render();
  assert.equal(banner(view).length, 0);
  assert.equal(view.root.findAll((node) => node.props.className === "cms-citizen-home").length, 0);
  assert.equal(view.root.findByProps({ id: "services" }).children[0], "All Services");
});

test("with the flag on but no banner set (onboarding seeds \"\"), the page is untouched", async () => {
  page({ flag: true, stateInfo: { name: "Bomet County", bannerUrl: "" } });
  assert.equal(banner(await render()).length, 0);
});

test("with both, the welcome sits above the page and links to filing and to the citizen's complaints", async () => {
  page({ flag: true, stateInfo: { name: "Bomet County", bannerUrl: "https://img/banner.jpg" } });
  const view = await render();
  const [hero] = banner(view);
  assert.ok(hero);
  assert.equal(hero.findByType("img").props.src, "https://img/banner.jpg");
  assert.match(text(hero), /CS_HOME_BANNER_WELCOMEBomet CountyCS_HOME_BANNER_PRODUCT/);
  const links = hero.findAllByType("a").map((a) => a.props.href);
  assert.deepEqual(links, ["/bomet/digit-ui/citizen/pgr/create-complaint", "/bomet/digit-ui/citizen/pgr/complaints"]);
  assert.ok(view.root.findByProps({ id: "services" }), "All Services still renders under it");
});

test("a banner that fails to load takes the welcome with it", async () => {
  page({ flag: true, stateInfo: { name: "Bomet County", bannerUrl: "https://img/gone.jpg" } });
  const view = await render();
  await ui.act(async () => banner(view)[0].findByType("img").props.onError());
  assert.equal(banner(view).length, 0);
  assert.ok(view.root.findByProps({ id: "services" }));
});

test("without a name the welcome still reads, just without it", async () => {
  page({ flag: true, stateInfo: { bannerUrl: "https://img/banner.jpg" } });
  const [hero] = banner(await render());
  assert.equal(hero.findAll((node) => node.props.className === "cms-home-banner__name").length, 0);
});
