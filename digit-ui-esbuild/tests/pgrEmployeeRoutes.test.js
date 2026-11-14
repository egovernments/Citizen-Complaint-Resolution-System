// Pins what each employee complaints address renders (#2808): the inbox's old
// address `/employee/pgr/inbox`, and any other address without a page, goes to
// the complaints list (and says why in the console) instead of leaving a blank
// page under the breadcrumb.
// Run from digit-ui-esbuild/:  node --test tests/pgrEmployeeRoutes.test.js
//
// The page set is products/pgr's EmployeeApp (the one the app builds). It is
// bundled with the real router and rendered through StaticRouter, which
// records redirects; the component library and i18n are stubbed.

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ROOT = path.join(__dirname, "..");
const STUBS = {
  "@egovernments/digit-ui-react-components": `
    import React from "react";
    import { Route } from "react-router-dom";
    export const AppContainer = ({ children }) => React.createElement("div", null, children);
    export const PrivateRoute = ({ component: Component, ...rest }) =>
      React.createElement(Route, { ...rest, render: (props) => React.createElement(Component, props) });
  `,
  "react-i18next": "export const useTranslation = () => ({ t: (key) => key });",
};
const stubs = {
  name: "stubs",
  setup(build) {
    build.onResolve({ filter: /^(@egovernments\/digit-ui-react-components|react-i18next)$/ }, (args) => ({ path: args.path, namespace: "stub" }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: STUBS[args.path], loader: "js", resolveDir: ROOT }));
  },
};

const OUT = path.join(os.tmpdir(), `pgrEmployeeRoutes.${process.pid}.cjs`);
// Plugins need the async API, so the bundle is built before the tests run.
let EmployeeApp, React, renderToStaticMarkup, StaticRouter;
before(async () => {
  await esbuild.build({
    stdin: {
      contents: `
        export { default as EmployeeApp } from "./products/pgr/src/pages/employee/index.js";
        export { default as React } from "react";
        export { renderToStaticMarkup } from "react-dom/server";
        export { StaticRouter } from "react-router-dom";
      `,
      resolveDir: ROOT,
      sourcefile: "pgr-employee-routes-entry.js",
      loader: "js",
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    outfile: OUT,
    loader: { ".js": "jsx" },
    nodePaths: [path.join(ROOT, "node_modules")],
    plugins: [stubs],
    logLevel: "error",
  });
  ({ EmployeeApp, React, renderToStaticMarkup, StaticRouter } = require(OUT));
});
process.on("exit", () => fs.rmSync(OUT, { force: true }));

const page = (name) => () => React.createElement("main", null, name);
const SCREENS = {
  PGRCreateComplaint: page("create"),
  PGRComplaintDetails: page("details"),
  PGRSearchInbox: page("inbox"),
  PGRResponse: page("response"),
  PGRBreadCrumbs: () => null,
};
const LIST = "/digit-ui/employee/pgr/inbox-v2";

const visit = (pathname) => {
  global.window = { contextPath: "digit-ui" };
  global.Digit = { ComponentRegistryService: { getComponent: (name) => SCREENS[name] } };
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    const context = {};
    const html = renderToStaticMarkup(
      React.createElement(StaticRouter, { location: pathname, context },
        React.createElement(EmployeeApp, { path: "/digit-ui/employee/pgr" })),
    );
    return { html, redirect: context.url || null, warnings };
  } finally {
    console.warn = warn;
    delete global.Digit;
    delete global.window;
  }
};

test("the complaints list renders at inbox-v2", () => {
  const { html, redirect, warnings } = visit(LIST);
  assert.equal(redirect, null);
  assert.equal(html, "<div><main>inbox</main></div>");
  assert.deepEqual(warnings, []);
});

test("the old inbox address goes to the complaints list", () => {
  assert.equal(visit("/digit-ui/employee/pgr/inbox").redirect, LIST);
  assert.equal(visit("/digit-ui/employee/pgr/inbox/").redirect, LIST);
});

test("the old inbox address keeps its query string", () => {
  assert.equal(visit("/digit-ui/employee/pgr/inbox?status=OPEN").redirect, `${LIST}?status=OPEN`);
});

test("the known pages still render, one each", () => {
  for (const [url, name] of [
    ["/digit-ui/employee/pgr/create-complaint", "create"],
    ["/digit-ui/employee/pgr/complaint-details/PG-PGR-2026-01-01-000001", "details"],
    ["/digit-ui/employee/pgr/complaint-success", "response"],
    ["/digit-ui/employee/pgr/complaint-failed", "response"],
  ]) {
    const { html, redirect, warnings } = visit(url);
    assert.equal(redirect, null, url);
    assert.equal(html, `<div><main>${name}</main></div>`, url);
    assert.deepEqual(warnings, [], url);
  }
});

test("any address without a page goes to the complaints list and says why in the console", () => {
  for (const url of ["/digit-ui/employee/pgr/inbox", "/digit-ui/employee/pgr/nowhere", "/digit-ui/employee/pgr/inbox/extra", "/digit-ui/employee/pgr"]) {
    const { redirect, warnings } = visit(url);
    assert.equal(redirect, LIST, url);
    assert.equal(warnings.length, 1, url);
    assert.ok(warnings[0].includes(url) && warnings[0].includes(LIST), warnings[0]);
  }
});
