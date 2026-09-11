// Hook-level regression coverage for #1276.
// Run from digit-ui-esbuild/:
//   node --test products/dashboard/src/hooks/useCatalogLayout.test.js

const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const bundlePath = path.join(
  os.tmpdir(),
  `useCatalogLayout.cjs.${process.pid}.js`
);

let useCatalogLayout;

before(async () => {
  await esbuild.build({
    entryPoints: [path.join(__dirname, "useCatalogLayout.js")],
    bundle: true,
    format: "cjs",
    platform: "node",
    outfile: bundlePath,
    plugins: [
      {
        name: "hook-test-mocks",
        setup(build) {
          build.onResolve({ filter: /^react$/ }, () => ({
            path: "react",
            namespace: "hook-test",
          }));
          build.onResolve({ filter: /services\/authService$/ }, () => ({
            path: "authService",
            namespace: "hook-test",
          }));
          build.onLoad({ filter: /.*/, namespace: "hook-test" }, (args) => {
            if (args.path === "authService") {
              return {
                contents: `
                  export const getTenantId = () => globalThis.__catalogTestTenant;
                  export const getEmployeeInfo = () => ({ uuid: globalThis.__catalogTestUser });
                `,
                loader: "js",
              };
            }
            return {
              contents: `
                export const useMemo = (factory) => factory();
                export const useCallback = (callback) => callback;
                export const useRef = (value) => ({ current: value });
                export const useEffect = (effect) => effect();
                export const useState = (value) => {
                  const index = globalThis.__catalogTestState.length;
                  globalThis.__catalogTestState.push(value);
                  return [value, (next) => {
                    const current = globalThis.__catalogTestState[index];
                    globalThis.__catalogTestState[index] =
                      typeof next === "function" ? next(current) : next;
                  }];
                };
              `,
              loader: "js",
            };
          });
        },
      },
    ],
  });
  ({ useCatalogLayout } = require(bundlePath));
});

after(() => {
  try {
    fs.unlinkSync(bundlePath);
  } catch {
    /* already gone */
  }
  delete globalThis.window;
});

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

const KPIS = {
  card_a: { kpiId: "card_a", viz: { kind: "number-tile" } },
  chart_a: { kpiId: "chart_a", viz: { kind: "stacked-bar" } },
};

const storedItem = (i) => ({ i, x: 0, y: 0, w: 2, h: 2 });

beforeEach(() => {
  globalThis.__catalogTestTenant = "ke";
  globalThis.__catalogTestUser = "user-a";
  globalThis.__catalogTestState = [];
});

test("rehydrates a saved Add-KPI layout when the pack seed is empty", () => {
  globalThis.window = {
    localStorage: fakeStorage({
      "ccrs.dashboard.catalog-layout.v1.ke.user-a": JSON.stringify([
        storedItem("card_a"),
      ]),
    }),
  };

  useCatalogLayout(KPIS, []);

  assert.deepEqual(
    globalThis.__catalogTestState[0].map((item) => item.i),
    ["card_a"]
  );
});

test("hydrates only the current tenant and user's saved layout", () => {
  globalThis.window = {
    localStorage: fakeStorage({
      "ccrs.dashboard.catalog-layout.v1.ke.user-a": JSON.stringify([
        storedItem("card_a"),
      ]),
      "ccrs.dashboard.catalog-layout.v1.ke.user-b": JSON.stringify([
        storedItem("chart_a"),
      ]),
    }),
  };
  globalThis.__catalogTestUser = "user-b";

  useCatalogLayout(KPIS, []);

  assert.deepEqual(
    globalThis.__catalogTestState[0].map((item) => item.i),
    ["chart_a"]
  );
});

test("uses the pack seed without touching storage when persistence is disabled", () => {
  let reads = 0;
  let writes = 0;
  globalThis.window = {
    localStorage: {
      getItem: () => {
        reads += 1;
        return null;
      },
      setItem: () => {
        writes += 1;
      },
    },
  };

  useCatalogLayout(
    KPIS,
    [{ kpiId: "card_a", x: 0, y: 0, w: 2, h: 2 }],
    { persistent: false }
  );

  assert.deepEqual(
    globalThis.__catalogTestState[0].map((item) => item.i),
    ["card_a"]
  );
  assert.equal(reads, 0);
  assert.equal(writes, 0);
});
