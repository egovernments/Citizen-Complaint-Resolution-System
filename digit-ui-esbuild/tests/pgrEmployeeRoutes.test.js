// Pins what each employee complaints address renders (#2808): the inbox's old
// address `/employee/pgr/inbox`, and any other address without a page, goes to
// the complaints list (and says why in the console) instead of leaving a blank
// page under the breadcrumb.
// Run from digit-ui-esbuild/:  node --test tests/pgrEmployeeRoutes.test.js
//
// The page set is products/pgr's EmployeeApp (the one the app builds). It is
// bundled with the real router and rendered the way the browser renders it: a
// real (memory) history, effects run, and a redirect really changes the address
// and renders the page it lands on. The component library and i18n are stubbed.

const { test, before, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");
require("react-test-renderer");

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
    // One React for the bundle and the renderer.
    build.onResolve({ filter: /^react$|^react-test-renderer$|^react-dom$/ }, (args) => ({ path: require.resolve(args.path), external: true }));
    build.onResolve({ filter: /^(@egovernments\/digit-ui-react-components|react-i18next)$/ }, (args) => ({ path: args.path, namespace: "stub" }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: STUBS[args.path], loader: "js", resolveDir: ROOT }));
  },
};

const OUT = path.join(os.tmpdir(), `pgrEmployeeRoutes.${process.pid}.cjs`);
// Plugins need the async API, so the bundle is built before the tests run.
let EmployeeApp, React, create, act, Router, createMemoryHistory;
before(async () => {
  await esbuild.build({
    stdin: {
      contents: `
        export { default as EmployeeApp } from "./products/pgr/src/pages/employee/index.js";
        export { default as React } from "react";
        export { create, act } from "react-test-renderer";
        export { Router } from "react-router-dom";
        export { createMemoryHistory } from "history";
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
  ({ EmployeeApp, React, create, act, Router, createMemoryHistory } = require(OUT));
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
const APP = "/digit-ui/employee/pgr";
const LIST = `${APP}/inbox-v2`;

// The rendered tree as markup (the stubs carry no attributes).
const markup = (node) =>
  node == null ? "" : typeof node === "string" ? node : Array.isArray(node) ? node.map(markup).join("")
    : `<${node.type}>${(node.children || []).map(markup).join("")}</${node.type}>`;
const where = ({ location: { pathname, search, hash, state } }) => ({ pathname, search, hash, state });

const realWarn = console.warn;
const views = [];
afterEach(async () => {
  for (const view of views.splice(0)) await act(async () => view.unmount());
  console.warn = realWarn;
  delete global.Digit;
  delete global.window;
});

// Opens `entry` (an address, or a location with a hash and state) in a fresh
// history, with the app mounted at `mount`. Warnings are collected from here
// until the next visit.
const visit = async (entry, mount = APP) => {
  global.window = { contextPath: "digit-ui" };
  global.Digit = { ComponentRegistryService: { getComponent: (name) => SCREENS[name] } };
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(" "));
  const history = createMemoryHistory({ initialEntries: [entry] });
  const app = () => React.createElement(Router, { history }, React.createElement(EmployeeApp, { path: mount }));
  let view;
  await act(async () => { view = create(app()); });
  views.push(view);
  return {
    history,
    warnings,
    html: () => markup(view.toJSON()),
    go: (to) => act(async () => history.push(to)),
    rerender: () => act(async () => view.update(app())),
  };
};

test("the complaints list renders at inbox-v2", async () => {
  const { history, html, warnings } = await visit(LIST);
  assert.equal(history.location.pathname, LIST);
  assert.equal(html(), "<div><main>inbox</main></div>");
  assert.deepEqual(warnings, []);
});

test("the old inbox address goes to the complaints list", async () => {
  for (const url of [`${APP}/inbox`, `${APP}/inbox/`]) {
    const { history, html } = await visit(url);
    assert.equal(history.location.pathname, LIST, url);
    assert.equal(html(), "<div><main>inbox</main></div>", url);
  }
});

test("the old inbox address keeps its query string", async () => {
  const { history } = await visit(`${APP}/inbox?status=OPEN`);
  assert.equal(history.location.pathname + history.location.search, `${LIST}?status=OPEN`);
});

test("the old inbox address keeps its hash and history state too", async () => {
  const { history } = await visit({ pathname: `${APP}/inbox`, search: "?status=OPEN", hash: "#tab=assigned", state: { from: "menu" } });
  assert.deepEqual(where(history), { pathname: LIST, search: "?status=OPEN", hash: "#tab=assigned", state: { from: "menu" } });
});

test("the known pages still render, one each", async () => {
  for (const [url, name] of [
    [`${APP}/create-complaint`, "create"],
    [`${APP}/complaint-details/PG-PGR-2026-01-01-000001`, "details"],
    [`${APP}/complaint-success`, "response"],
    [`${APP}/complaint-failed`, "response"],
  ]) {
    const { history, html, warnings } = await visit(url);
    assert.equal(history.location.pathname, url, url);
    assert.equal(html(), `<div><main>${name}</main></div>`, url);
    assert.deepEqual(warnings, [], url);
  }
});

test("any address without a page goes to the complaints list and says why in the console", async () => {
  for (const url of [`${APP}/inbox`, `${APP}/nowhere`, `${APP}/inbox/extra`, APP]) {
    const { history, html, warnings } = await visit(url);
    assert.equal(history.location.pathname, LIST, url);
    assert.equal(html(), "<div><main>inbox</main></div>", url);
    assert.equal(warnings.length, 1, url);
    assert.ok(warnings[0].includes(url) && warnings[0].includes(LIST), warnings[0]);
  }
});

test("under the no-top-bar mount, the complaints list it opens is the no-top-bar one", async () => {
  // Core mounts the employee app at /<ctx>/employee and at /<ctx>/no-top-bar/employee.
  const mount = "/digit-ui/no-top-bar/employee/pgr";
  const { history, html, warnings } = await visit(`${mount}/inbox?status=OPEN`, mount);
  assert.equal(history.location.pathname + history.location.search, `${mount}/inbox-v2?status=OPEN`);
  assert.equal(html(), "<div><main>inbox</main></div>");
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes(`${mount}/inbox-v2`), warnings[0]);
});

// In a browser the fallback renders once before its redirect unmounts it, so
// this counts the warnings over the arrival and the renders that follow it.
test("the console says it once per arrival, however often the app renders after", async () => {
  const { history, html, warnings, go, rerender } = await visit(`${APP}/inbox`);
  assert.equal(history.location.pathname, LIST);
  assert.equal(warnings.length, 1);
  // The list's own address changes and plain re-renders add nothing.
  await go(`${LIST}?status=OPEN`);
  await rerender();
  await rerender();
  assert.equal(html(), "<div><main>inbox</main></div>");
  assert.equal(warnings.length, 1);
  // A later arrival at another address without a page says so again, once.
  await go(`${APP}/nowhere`);
  assert.equal(history.location.pathname, LIST);
  assert.equal(warnings.length, 2);
  assert.ok(warnings[1].includes(`${APP}/nowhere`), warnings[1]);
});
