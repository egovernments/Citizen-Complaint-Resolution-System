// Pins the complaint map's base tiles and opening view (#2804).
// Run from digit-ui-esbuild/:  node --test tests/mapView.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "../products/pgr/src/utils/mapView.js");
const OUT = path.join(os.tmpdir(), `mapView.cjs.${process.pid}.js`);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, format: "cjs", platform: "neutral", outfile: OUT });
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch {
    // Best effort; the temp file is process-scoped.
  }
});
const {
  resolveBaseTiles,
  isKeylessCartoUrl,
  boundsOfFeatures,
  resolveOpeningView,
  CITY_ZOOM,
  nextOpeningView,
  createTileFailureTracker,
} = require(OUT);

const OSM_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const KEYED_CARTO = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=abc123";

test("a tenant with no MapConfig gets OpenStreetMap with OSM credit", () => {
  for (const cfg of [undefined, {}, { code: "DEFAULT" }, { baseMapTheme: "nonsense" }]) {
    const tiles = resolveBaseTiles(cfg);
    assert.equal(tiles.tileUrl, OSM_URL);
    assert.match(tiles.tileAttribution, /OpenStreetMap<\/a> contributors/);
    assert.equal(tiles.keylessCartoFallback, false);
  }
});

test("a CARTO theme chosen without a key falls back to OpenStreetMap", () => {
  for (const baseMapTheme of ["voyager", "light", "dark"]) {
    const tiles = resolveBaseTiles({ baseMapTheme });
    assert.equal(tiles.tileUrl, OSM_URL, baseMapTheme);
    assert.equal(tiles.keylessCartoFallback, true, baseMapTheme);
  }
});

test("a keyless CARTO tile URL falls back to OpenStreetMap", () => {
  const tiles = resolveBaseTiles({ tileUrl: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" });
  assert.equal(tiles.tileUrl, OSM_URL);
  assert.equal(tiles.keylessCartoFallback, true);
});

test("a keyed CARTO tile URL is kept, with CARTO credit", () => {
  const tiles = resolveBaseTiles({ baseMapTheme: "light", tileUrl: KEYED_CARTO });
  assert.equal(tiles.tileUrl, KEYED_CARTO);
  assert.match(tiles.tileAttribution, /CARTO/);
  assert.equal(tiles.keylessCartoFallback, false);
  // api_key= is CARTO's other spelling.
  assert.equal(isKeylessCartoUrl("https://a.basemaps.cartocdn.com/x/{z}/{x}/{y}.png?api_key=k"), false);
});

test("any other custom tile URL wins, with its own credit line", () => {
  const tiles = resolveBaseTiles({ tileUrl: " https://tiles.example.org/{z}/{x}/{y}.png ", tileAttribution: "Example" });
  assert.deepEqual(tiles, { tileUrl: "https://tiles.example.org/{z}/{x}/{y}.png", tileAttribution: "Example", keylessCartoFallback: false });
});

test("an explicit osm theme stays OpenStreetMap", () => {
  assert.equal(resolveBaseTiles({ baseMapTheme: "osm" }).tileUrl, OSM_URL);
});

const square = (west, south, east, north) => ({
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] },
});

test("the outline is the box around every ward, MultiPolygons included", () => {
  const multi = { type: "Feature", geometry: { type: "MultiPolygon", coordinates: [square(37, -2, 37.5, -1.5).geometry.coordinates] } };
  const box = boundsOfFeatures({ type: "FeatureCollection", features: [square(36.7, -1.4, 36.9, -1.2), multi] });
  assert.deepEqual(box, { south: -2, west: 36.7, north: -1.2, east: 37.5 });
});

test("no outline without usable coordinates", () => {
  assert.equal(boundsOfFeatures(null), undefined);
  assert.equal(boundsOfFeatures({ features: [] }), undefined);
  assert.equal(boundsOfFeatures({ features: [{ geometry: null }, { geometry: { coordinates: [[["x", "y"]]] } }] }), undefined);
});

const NAIROBI = { south: -1.44, west: 36.66, north: -1.16, east: 37.1 };
const MAPUTO = { lat: -25.97, lng: 32.57 };

test("the MapConfig centre wins over the outline and the deployment default", () => {
  const view = resolveOpeningView({ configCenter: { lat: 1, lng: 2 }, configZoom: 9, outline: NAIROBI, fallbackCenter: MAPUTO });
  assert.deepEqual(view, { source: "config", center: { lat: 1, lng: 2 }, zoom: 9 });
});

test("a MapConfig centre without a zoom opens at city zoom, not zoom 5", () => {
  const view = resolveOpeningView({ configCenter: { lat: 1, lng: 2 }, fallbackCenter: MAPUTO });
  assert.equal(view.zoom, CITY_ZOOM);
  assert.equal(CITY_ZOOM, 12);
});

test("without a MapConfig centre the map fits the tenant's outline, not the deployment default", () => {
  const view = resolveOpeningView({ outline: NAIROBI, fallbackCenter: MAPUTO });
  assert.equal(view.source, "outline");
  assert.deepEqual(view.bounds, NAIROBI);
  assert.ok(Math.abs(view.center.lat - -1.3) < 1e-9 && Math.abs(view.center.lng - 36.88) < 1e-9);
});

test("with nothing else known the map opens on the deployment default at city zoom", () => {
  const view = resolveOpeningView({ fallbackCenter: MAPUTO, configZoom: 3 });
  assert.deepEqual(view, { source: "fallback", center: MAPUTO, zoom: CITY_ZOOM });
});

test("the opening zoom stays inside the tenant's zoom limits", () => {
  assert.equal(resolveOpeningView({ fallbackCenter: MAPUTO, maxZoom: 10 }).zoom, 10);
  assert.equal(resolveOpeningView({ configCenter: MAPUTO, configZoom: 3, minZoom: 6 }).zoom, 6);
});

const OUTLINE_VIEW = resolveOpeningView({ outline: NAIROBI, fallbackCenter: MAPUTO });
const FALLBACK_VIEW = resolveOpeningView({ fallbackCenter: MAPUTO });
const CONFIG_VIEW = resolveOpeningView({ configCenter: MAPUTO, fallbackCenter: MAPUTO });
const step = (over) =>
  nextOpeningView({ ready: true, view: FALLBACK_VIEW, boundariesDone: false, waitedOut: false, applied: null, userMoved: false, hasPin: false, ...over });

test("the opening view waits for MapConfig, then opens a MapConfig centre at once", () => {
  assert.equal(step({ ready: false, view: CONFIG_VIEW }), null);
  assert.equal(step({ view: CONFIG_VIEW }), "config");
  assert.equal(step({ view: CONFIG_VIEW, applied: "config" }), null);
});

test("without a MapConfig centre it waits for the wards, but not past the wait", () => {
  assert.equal(step({}), null, "wards still loading");
  assert.equal(step({ view: OUTLINE_VIEW }), null, "some wards in, more loading");
  assert.equal(step({ view: OUTLINE_VIEW, boundariesDone: true }), "outline:all");
  assert.equal(step({ boundariesDone: true }), "fallback", "the tenant has no wards");
  assert.equal(step({ waitedOut: true }), "fallback", "nothing in yet");
  assert.equal(step({ view: OUTLINE_VIEW, waitedOut: true }), "outline:some");
});

test("a better view later moves the map, the same view never twice", () => {
  assert.equal(step({ view: OUTLINE_VIEW, waitedOut: true, applied: "fallback" }), "outline:some");
  assert.equal(step({ view: OUTLINE_VIEW, waitedOut: true, applied: "outline:some" }), null);
  assert.equal(step({ view: OUTLINE_VIEW, boundariesDone: true, waitedOut: true, applied: "outline:some" }), "outline:all");
  assert.equal(step({ boundariesDone: true, waitedOut: true, applied: "fallback" }), null, "no wards after all");
});

test("nothing moves the map once the citizen has, or while there is a pin", () => {
  for (const over of [{ userMoved: true }, { hasPin: true }]) {
    assert.equal(step({ view: CONFIG_VIEW, ...over }), null);
    assert.equal(step({ view: OUTLINE_VIEW, boundariesDone: true, applied: "fallback", ...over }), null);
  }
});

const trackerAt = (clock) => createTileFailureTracker({ threshold: 3, windowMs: 1000, now: () => clock.t });

test("one failed tile is not an outage; several with none loading are", () => {
  const clock = { t: 0 };
  const tiles = trackerAt(clock);
  assert.equal(tiles.failed(), false);
  assert.equal(tiles.failed(), false);
  assert.equal(tiles.failed(), true);
});

test("a tile that loads starts the count again, so a later outage still shows", () => {
  const clock = { t: 0 };
  const tiles = trackerAt(clock);
  tiles.failed();
  tiles.failed();
  tiles.loaded();
  assert.equal(tiles.failed(), false);
  assert.equal(tiles.failed(), false);
  assert.equal(tiles.failed(), true);
});

test("failures spread out past the window don't add up", () => {
  const clock = { t: 0 };
  const tiles = trackerAt(clock);
  tiles.failed();
  clock.t = 600;
  tiles.failed();
  clock.t = 1300; // the first failure has aged out
  assert.equal(tiles.failed(), false);
  clock.t = 1400;
  assert.equal(tiles.failed(), true);
});
