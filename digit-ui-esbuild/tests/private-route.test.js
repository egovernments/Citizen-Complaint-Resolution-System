const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

// Bundle both PrivateRoute copies with the real router so the guard's
// redirect decisions are exercised end to end (StaticRouter records them).
const OUT = path.join(os.tmpdir(), `private-route.cjs.${process.pid}.js`);
esbuild.buildSync({
  stdin: {
    contents: `
      export { PrivateRoute as ComponentsPrivateRoute } from "./digit-ui-components/src/atoms/PrivateRoute.js";
      export { PrivateRoute as ReactPrivateRoute } from "./react-components/src/atoms/PrivateRoute.js";
      export { privateRouteLogin } from "./libraries/src/services/auth/authSurface.js";
      export { default as React } from "react";
      export { renderToStaticMarkup } from "react-dom/server";
      export { StaticRouter } from "react-router-dom";
    `,
    resolveDir: path.join(__dirname, "../packages"),
    sourcefile: "private-route-test-entry.js",
    loader: "js",
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: OUT,
  loader: { ".js": "jsx" },
  nodePaths: [path.join(__dirname, "../node_modules")],
  logLevel: "error",
});
process.on("exit", () => {
  try { fs.unlinkSync(OUT); } catch (_) { /* already removed */ }
});

// React and the router come from the same bundle so context is shared.
const { ComponentsPrivateRoute, ReactPrivateRoute, privateRouteLogin, React, renderToStaticMarkup, StaticRouter } = require(OUT);

const withUser = (user, fn) => {
  const digit = { UserService: { getUser: () => user }, AuthSurface: { privateRouteLogin } };
  global.Digit = digit;
  global.window = { Digit: digit, contextPath: "digit-ui", globalConfigs: { getConfig: () => undefined } };
  try {
    return fn();
  } finally {
    delete global.Digit;
    delete global.window;
  }
};

const visit = (PrivateRoute, pathname, user) => withUser(user, () => {
  const context = {};
  const Page = () => React.createElement("main", null, "protected");
  const html = renderToStaticMarkup(
    React.createElement(StaticRouter, { location: pathname, context },
      React.createElement(PrivateRoute, { path: "/", component: Page })),
  );
  return { html, redirect: context.url || null };
});

const token = (type) => ({ access_token: "t", info: { type } });

for (const [name, PrivateRoute] of [["digit-ui-components", ComponentsPrivateRoute], ["react-components", ReactPrivateRoute]]) {
  test(`${name} PrivateRoute treats /{slug}/digit-ui/employee as employee`, () => {
    const path = "/bomet/digit-ui/employee/pgr/inbox";
    assert.equal(visit(PrivateRoute, path, token("EMPLOYEE")).html, "<main>protected</main>");
    assert.equal(visit(PrivateRoute, path, token("CITIZEN")).redirect, "/bomet/digit-ui/employee/user/login");
    assert.equal(visit(PrivateRoute, path, null).redirect, "/bomet/digit-ui/employee/user/login");
  });

  test(`${name} PrivateRoute sends tenant citizen routes to the tenant citizen login`, () => {
    const path = "/bomet/digit-ui/citizen/pgr/complaints";
    assert.equal(visit(PrivateRoute, path, token("CITIZEN")).html, "<main>protected</main>");
    assert.equal(visit(PrivateRoute, path, token("EMPLOYEE")).redirect, "/bomet/digit-ui/citizen/login");
    assert.equal(visit(PrivateRoute, path, null).redirect, "/bomet/digit-ui/citizen/login");
  });

  test(`${name} PrivateRoute keeps legacy /digit-ui targets`, () => {
    assert.equal(visit(PrivateRoute, "/digit-ui/employee/pgr/inbox", token("EMPLOYEE")).html, "<main>protected</main>");
    assert.equal(visit(PrivateRoute, "/digit-ui/employee/pgr/inbox", null).redirect, "/digit-ui/employee/user/language-selection");
    assert.equal(visit(PrivateRoute, "/digit-ui/citizen/pgr/complaints", token("EMPLOYEE")).redirect, "/digit-ui/citizen/login");
  });
}
