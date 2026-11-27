// The citizen complaint map's opening view and tile notice (#2804), with the
// real GeoLocations, useMapConfig and useTenantBoundaries. Leaflet is replaced
// by a recording fake map; boundary-service by calls the test answers (or
// leaves hanging) one at a time.
// Run from digit-ui-esbuild/:  node --test tests/geoLocationsOpening.test.js
const { test, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const OUT = path.join(os.tmpdir(), `geo-locations-opening.${process.pid}.cjs`);

// Stand-ins for the modules that need a browser.
const DOUBLES = {
  "react-leaflet": `
    import React, { createContext, useContext } from "react";
    const MapContext = createContext(null);
    export const MapContainer = ({ children }) => React.createElement(MapContext.Provider, { value: globalThis.__map }, children);
    export const useMap = () => useContext(MapContext);
    export const useMapEvents = () => null;
    export const TileLayer = (props) => { globalThis.__tileLayer = props; return null; };
    export const Marker = ({ children }) => React.createElement("marker", null, children);
    export const Tooltip = ({ children }) => React.createElement("tooltip", null, children);
    export const Polygon = () => null;
    export const GeoJSON = () => null;
  `,
  leaflet: "export default { Icon: { Default: { prototype: {}, mergeOptions() {} } } };",
  "leaflet/dist/leaflet.css": "",
  "@egovernments/digit-ui-react-components": `
    import React from "react";
    export const CardLabel = ({ children }) => React.createElement("label", null, children);
    export const Loader = () => React.createElement("loader", null);
    export const Toast = ({ label }) => React.createElement("toast", null, label);
  `,
  "react-i18next": "export const useTranslation = () => ({ t: (key) => key, i18n: { language: 'en_IN' } });",
};

let ui;
const realFetch = global.fetch;
before(async () => {
  await esbuild.build({
    stdin: {
      contents: `
        export { default as React } from 'react';
        export { create, act } from 'react-test-renderer';
        export { default as GeoLocations } from './products/pgr/src/components/GeoLocations';
        export { OPENING_VIEW_WAIT_MS } from './products/pgr/src/utils/mapView';
      `,
      resolveDir: root,
      loader: "jsx",
    },
    bundle: true, platform: "node", format: "cjs", outfile: OUT, loader: { ".js": "jsx" },
    nodePaths: [path.join(root, "node_modules")],
    logLevel: "error",
    plugins: [{ name: "browser-doubles", setup(build) {
      build.onResolve({ filter: /^react$|^react-test-renderer$|^react-dom$/ }, (args) => ({ path: require.resolve(args.path), external: true }));
      build.onResolve({ filter: /^(react-leaflet|leaflet|leaflet\/dist\/leaflet\.css|@egovernments\/digit-ui-react-components|react-i18next)$/ }, (args) => ({ path: args.path, namespace: "double" }));
      build.onLoad({ filter: /.*/, namespace: "double" }, (args) => ({ contents: DOUBLES[args.path], loader: "js", resolveDir: root }));
    } }],
  });
  ui = require(OUT);
});
after(() => {
  fs.unlinkSync(OUT);
  global.fetch = realFetch;
});

// --- the fake map --------------------------------------------------------
const fakeMap = () => {
  const listeners = {};
  const moves = [];
  const container = {
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
  };
  return {
    moves,
    fitBounds: (bounds, options) => moves.push(["fit", bounds, options]),
    setView: (center, zoom) => moves.push(["view", center, zoom]),
    getContainer: () => container,
    input: (type) => (listeners[type] || []).forEach((fn) => fn({ type })),
  };
};

// --- boundary-service ----------------------------------------------------
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const ward = (i) => ({ code: `W${i}`, boundaryType: "Ward" });
const tree = (count) => ({
  TenantBoundary: [{ boundary: [{ code: "KE", boundaryType: "County", children: Array.from({ length: count }, (_, i) => ward(i)) }] }],
});
// Ward i is a 0.01-degree square at longitude 36 + i/100, latitude -1.3.
const square = (i) => {
  const w = 36 + i / 100;
  const e = w + 0.01;
  return { type: "Polygon", coordinates: [[[w, -1.3], [e, -1.3], [e, -1.29], [w, -1.29], [w, -1.3]]] };
};
const geometryFor = (params) => ({
  Boundary: params.codes.split(",").map((code) => ({ code, geometry: square(Number(code.slice(1))) })),
});
const fitOf = (first, last) => [[-1.3, 36 + first / 100], [-1.29, 36 + last / 100 + 0.01]];

let map;
let deleted;
let waits;
let relationships; // what boundary-relationships/_search answers (a promise)
let chunks; // what each boundary/_search call answers, in order
let mapConfig;
let realSetTimeout;
let realClearTimeout;
const MAP_CENTER = { lat: -25.97, lng: 32.57 };

beforeEach(() => {
  map = fakeMap();
  globalThis.__map = map;
  globalThis.__tileLayer = null;
  deleted = [];
  waits = [];
  relationships = null;
  chunks = [];
  mapConfig = { code: "DEFAULT", boundaryTenantId: "ke" };
  // Nominatim is never called for real.
  global.fetch = async () => ({ json: async () => [] });
  global.window = { globalConfigs: { getConfig: (key) => (key === "MAP_CENTER" ? MAP_CENTER : undefined) } };
  global.Digit = {
    SessionStorage: { get: () => null, del: (key) => deleted.push(key) },
    ULBService: { getCurrentTenantId: () => "ke" },
    StoreData: { getCurrentLanguage: () => "en_IN" },
    Hooks: { useCustomMDMS: () => ({ data: [mapConfig], isLoading: false }) },
    MDMSService: { call: async () => ({ MdmsRes: {} }) },
    CustomService: {
      getResponse: ({ url, params }) => {
        if (url.includes("boundary-relationships")) return relationships;
        const next = chunks.shift();
        return typeof next === "function" ? next(params) : next;
      },
    },
  };
  // The opening wait is the only 3-second timer; the test runs it by hand.
  realSetTimeout = global.setTimeout;
  realClearTimeout = global.clearTimeout;
  global.setTimeout = (fn, ms, ...args) => {
    if (ms === ui.OPENING_VIEW_WAIT_MS) {
      const handle = { fn, cleared: false, wait: true };
      waits.push(handle);
      return handle;
    }
    return realSetTimeout(fn, ms, ...args);
  };
  global.clearTimeout = (handle) => {
    if (handle && handle.wait) handle.cleared = true;
    else realClearTimeout(handle);
  };
});
let mounted = [];
afterEach(async () => {
  await ui.act(async () => mounted.forEach((view) => view.unmount()));
  mounted = [];
  global.setTimeout = realSetTimeout;
  global.clearTimeout = realClearTimeout;
  delete global.window;
  delete global.Digit;
});

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
};
async function render(props = {}) {
  const { React, GeoLocations, create, act } = ui;
  let view;
  await act(async () => {
    view = create(React.createElement(GeoLocations, {
      t: (key) => key, config: { key: "geoLocation" }, onSelect: () => {}, formData: {}, ...props,
    }));
    await settle();
  });
  mounted.push(view);
  return view;
}
const step = (fn) => ui.act(async () => { await fn(); await settle(); });
const waitOut = () => step(() => waits.filter((w) => !w.cleared).forEach((w) => { w.cleared = true; w.fn(); }));
const loading = (view) => view.root.findAll((node) => node.type === "loader").length > 0;
const notice = (view) => view.root.findAll((node) => node.type === "div" && node.props.role === "status").length > 0;

test("opens once on the wards when they all arrive, without waiting out the timer", async () => {
  relationships = Promise.resolve(tree(2));
  chunks = [geometryFor];
  const view = await render();
  assert.deepEqual(map.moves, [["fit", fitOf(0, 1), { padding: [16, 16], maxZoom: 16 }]]);
  assert.equal(loading(view), false);
  assert.deepEqual(deleted, ["PGR_MAP_LOCATION"]);
});

test("waits on a loading state, not the fallback centre, while the wards load", async () => {
  const pending = deferred();
  relationships = pending.promise;
  const view = await render();
  assert.deepEqual(map.moves, []);
  assert.equal(loading(view), true);
  // The old session key is cleared even though the wards never came.
  assert.deepEqual(deleted, ["PGR_MAP_LOCATION"]);
});

test("a hung geometry call: the map opens on the wards that did arrive when the wait runs out", async () => {
  relationships = Promise.resolve(tree(45)); // two chunks: 40 + 5
  chunks = [geometryFor, deferred().promise];
  const view = await render();
  assert.deepEqual(map.moves, []);
  await waitOut();
  assert.deepEqual(map.moves, [["fit", fitOf(0, 39), { padding: [16, 16], maxZoom: 16 }]]);
  assert.equal(loading(view), false);
});

test("a geometry call that fails keeps the wards before it, and the map opens on them at once", async () => {
  relationships = Promise.resolve(tree(45));
  chunks = [geometryFor, () => Promise.reject(new Error("boundary-service down"))];
  const original = console.error;
  console.error = () => {};
  try {
    await render();
  } finally {
    console.error = original;
  }
  assert.deepEqual(map.moves, [["fit", fitOf(0, 39), { padding: [16, 16], maxZoom: 16 }]]);
});

test("nothing yet when the wait runs out: the fallback centre, then the wards when they come", async () => {
  const pending = deferred();
  relationships = pending.promise;
  chunks = [geometryFor];
  const view = await render();
  await waitOut();
  assert.deepEqual(map.moves, [["view", [MAP_CENTER.lat, MAP_CENTER.lng], 12]]);
  assert.equal(loading(view), false);
  await step(() => pending.resolve(tree(2)));
  assert.deepEqual(map.moves.slice(1), [["fit", fitOf(0, 1), { padding: [16, 16], maxZoom: 16 }]]);
});

test("some wards at the wait, then all of them: the map widens to the whole outline", async () => {
  relationships = Promise.resolve(tree(45));
  const second = deferred();
  chunks = [geometryFor, second.promise];
  await render();
  await waitOut();
  await step(() => second.resolve(geometryFor({ codes: "W40,W41,W42,W43,W44" })));
  assert.deepEqual(map.moves.map(([kind, bounds]) => [kind, bounds]), [["fit", fitOf(0, 39)], ["fit", fitOf(0, 44)]]);
});

for (const input of ["pointerdown", "touchstart", "wheel", "keydown"]) {
  test(`after the citizen moves the map (${input}), late wards don't move it back`, async () => {
    const pending = deferred();
    relationships = pending.promise;
    chunks = [geometryFor];
    const view = await render();
    await step(() => map.input(input));
    assert.equal(loading(view), false, "the loading state gives way to the citizen");
    await waitOut();
    await step(() => pending.resolve(tree(2)));
    assert.deepEqual(map.moves, []);
  });
}

test("after a search in polygon mode, late wards don't move the map back", async () => {
  const pending = deferred();
  relationships = pending.promise;
  chunks = [geometryFor];
  global.fetch = async () => ({ json: async () => [{ lat: "-1.28", lon: "36.81" }] });
  const view = await render();
  await waitOut();
  await step(() => view.root.find((node) => node.type === "div" && node.props.title === "CS_SELECT_AREA").props.onClick());
  const search = view.root.find((node) => node.type === "input");
  await step(() => search.props.onChange({ target: { value: "Kenyatta Avenue" } }));
  // Let the debounced suggestions call run against the stub before moving on.
  await step(() => new Promise((resolve) => realSetTimeout(resolve, 600)));
  await step(() => view.root.find((node) => node.type === "input").props.onKeyPress({ key: "Enter", preventDefault() {} }));
  await step(() => pending.resolve(tree(2)));
  assert.deepEqual(map.moves, [["view", [MAP_CENTER.lat, MAP_CENTER.lng], 12], ["view", [-1.28, 36.81], 13]]);
});

test("after locate-me, late wards don't move the map back", async () => {
  const pending = deferred();
  relationships = pending.promise;
  chunks = [geometryFor];
  global.fetch = async () => ({ json: async () => ({}) });
  const navigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { geolocation: { getCurrentPosition: (ok) => ok({ coords: { latitude: -1.27, longitude: 36.8 } }) } },
  });
  try {
    // formData never gets the pin here, so only locate-me itself can hold the map.
    const view = await render();
    await waitOut();
    await step(() => view.root.find((node) => node.type === "div" && node.props.title === "CS_LOCATE_ME").props.onClick());
    await step(() => pending.resolve(tree(2)));
    assert.deepEqual(map.moves, [["view", [MAP_CENTER.lat, MAP_CENTER.lng], 12], ["view", [-1.27, 36.8], 13]]);
  } finally {
    if (navigator) Object.defineProperty(globalThis, "navigator", navigator);
    else delete globalThis.navigator;
  }
});

test("a MapConfig centre opens at once, without waiting for the wards", async () => {
  mapConfig = { ...mapConfig, center: { lat: -1.29, lng: 36.82 }, defaultZoom: 11 };
  relationships = deferred().promise;
  const view = await render();
  assert.deepEqual(map.moves, [["view", [-1.29, 36.82], 11]]);
  assert.equal(loading(view), false);
});

test("a pin restored from the form keeps the map on it", async () => {
  relationships = Promise.resolve(tree(2));
  chunks = [geometryFor];
  const view = await render({ formData: { geoLocation: { lat: -1.25, lng: 36.85, address: "Here" } } });
  await waitOut();
  assert.deepEqual(map.moves, [["view", [-1.25, 36.85], 13]]);
  assert.equal(loading(view), false);
});

test("the tile notice: not for one failed tile, yes when tiles keep failing, gone when one loads, back on a later outage", async () => {
  relationships = Promise.resolve(tree(2));
  chunks = [geometryFor];
  const view = await render();
  const tiles = () => globalThis.__tileLayer.eventHandlers;
  await step(() => tiles().tileerror());
  assert.equal(notice(view), false, "one failed tile");
  await step(() => { tiles().tileerror(); tiles().tileerror(); });
  assert.equal(notice(view), true, "three failed tiles and none loaded");
  await step(() => tiles().tileload());
  assert.equal(notice(view), false, "a tile loaded");
  await step(() => { tiles().tileerror(); tiles().tileerror(); });
  assert.equal(notice(view), false, "two failures since the last load");
  await step(() => tiles().tileerror());
  assert.equal(notice(view), true, "the connection dropped after tiles had loaded");
});
