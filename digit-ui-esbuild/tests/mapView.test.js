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
const { resolveBaseTiles, isKeylessCartoUrl, boundsOfFeatures, resolveOpeningView, CITY_ZOOM } = require(OUT);

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
