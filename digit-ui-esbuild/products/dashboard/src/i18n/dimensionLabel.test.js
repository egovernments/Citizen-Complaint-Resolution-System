// Regression: boundary labels may resolve from en_IN when the active locale
// (e.g. pt_PT) has an empty rainmaker-boundary-* pack; complaintType must NOT
// inherit that en_IN bleed (#1108).
//
// Run from digit-ui-esbuild/:
//   node --test products/dashboard/src/i18n/dimensionLabel.test.js

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

function bundle(entry) {
  const out = path.join(
    os.tmpdir(),
    `${path.basename(entry, ".js")}.cjs.${process.pid}.js`
  );
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, entry)],
    bundle: true,
    format: "cjs",
    platform: "neutral",
    outfile: out,
  });
  process.on("exit", () => {
    try {
      fs.unlinkSync(out);
    } catch (e) {
      /* already gone */
    }
  });
  delete require.cache[out];
  return require(out);
}

function mockI18n({ language, bags }) {
  global.window = {
    i18next: {
      language,
      options: { defaultNS: "translations" },
      // exists/t deliberately bleed English — runtime must use getResource.
      exists: () => true,
      t: (key) => bags.en_IN?.[key] ?? key,
      getResource: (lng, _ns, key) => bags[lng]?.[key],
      getResourceBundle: (lng) => bags[lng] || {},
      on() {},
      off() {},
      store: { on() {}, off() {} },
    },
    localStorage: {
      getItem: (k) => (k === "Employee.locale" ? language : null),
    },
    globalConfigs: { getConfig: () => "ADMIN" },
  };
}

beforeEach(() => {
  delete global.window;
});

afterEach(() => {
  delete global.window;
});

test("boundary falls back to en_IN place name when pt_PT pack is empty", () => {
  mockI18n({
    language: "pt_PT",
    bags: {
      pt_PT: {},
      en_IN: { BOMET_BOMET_CENTRAL_CHESOEN: "Chesoen" },
    },
  });
  const { dimensionLabel } = bundle("dimensionLabel.js");
  assert.equal(dimensionLabel("BOMET_BOMET_CENTRAL_CHESOEN", "boundary"), "Chesoen");
});

test("complaintType skips taxonomy-path i18n messages (incl. PT partial translate)", () => {
  mockI18n({
    language: "pt_PT",
    bags: {
      pt_PT: {
        "COMPLAINT_HIERARCHY.complaints.categories.StreetLightNotWorking":
          "reclamações.categories.StreetLightNotWorking",
      },
      en_IN: {
        "COMPLAINT_HIERARCHY.complaints.categories.StreetLightNotWorking":
          "complaints.categories.StreetLightNotWorking",
      },
    },
  });
  const { dimensionLabel } = bundle("dimensionLabel.js");
  // Path-shaped seeds skipped; no usable pt message → raw code (no humaniser).
  assert.equal(
    dimensionLabel("complaints.categories.StreetLightNotWorking", "complaintType"),
    "complaints.categories.StreetLightNotWorking"
  );
});

test("complaintType on pt_PT prefers last-segment COMPLAINT_HIERARCHY key", () => {
  mockI18n({
    language: "pt_PT",
    bags: {
      pt_PT: {
        "COMPLAINT_HIERARCHY.complaints.categories.DamagedRoad":
          "reclamações.categories.DamagedRoad",
        "COMPLAINT_HIERARCHY.DAMAGEDROAD": "Estrada danificada",
      },
      en_IN: {
        "COMPLAINT_HIERARCHY.DAMAGEDROAD": "Damaged road",
        "COMPLAINT_HIERARCHY.complaints.categories.DamagedRoad":
          "complaints.categories.DamagedRoad",
      },
    },
  });
  const { dimensionLabel } = bundle("dimensionLabel.js");
  assert.equal(
    dimensionLabel("complaints.categories.DamagedRoad", "complaintType"),
    "Estrada danificada"
  );
});

test("complaintType on pt_PT does not fall back to en_IN English titles", () => {
  mockI18n({
    language: "pt_PT",
    bags: {
      pt_PT: {},
      en_IN: { "COMPLAINT_HIERARCHY.STREETLIGHT": "Street Light Not Working" },
    },
  });
  const { dimensionLabel } = bundle("dimensionLabel.js");
  // No usable pt message → raw code, never bleed the English pack.
  assert.equal(dimensionLabel("STREETLIGHT", "complaintType"), "STREETLIGHT");
});

test("complaintType with no locale and no usable MDMS surfaces the raw code", () => {
  mockI18n({
    language: "pt_PT",
    bags: { pt_PT: {}, en_IN: {} },
  });
  const { dimensionLabel } = bundle("dimensionLabel.js");
  assert.equal(
    dimensionLabel("complaints.categories.DamagedRoad", "complaintType"),
    "complaints.categories.DamagedRoad"
  );
  // MDMS English fallback is ignored on pt_PT — raw code, not a humaniser.
  assert.equal(
    dimensionLabel("PWAUTHORITY_TYPE_xyz", "complaintType", "Sample Authority"),
    "PWAUTHORITY_TYPE_xyz"
  );
});

test("boundary loose-matches underscore variants to place names", () => {
  mockI18n({
    language: "pt_PT",
    bags: {
      pt_PT: {},
      en_IN: { BOMET_CHEPALUNGU_KONG_ASIS: "Kong'asis" },
    },
  });
  const { dimensionLabel } = bundle("dimensionLabel.js");
  assert.equal(dimensionLabel("BOMET_CHEPALUNGU_KONGASIS", "boundary"), "Kong'asis");
});

test("boundary/department with no pack entry surface the raw code", () => {
  mockI18n({
    language: "pt_PT",
    bags: { pt_PT: {}, en_IN: {} },
  });
  const { dimensionLabel } = bundle("dimensionLabel.js");
  assert.equal(dimensionLabel("ETOEROLES_WARD_1", "boundary"), "ETOEROLES_WARD_1");
  assert.equal(dimensionLabel("MEDICAL_SVC", "department"), "MEDICAL_SVC");
});

test("boundary uses data-owned localname when pack has no entry", () => {
  mockI18n({
    language: "pt_PT",
    bags: { pt_PT: {}, en_IN: {} },
  });
  const { dimensionLabel } = bundle("dimensionLabel.js");
  assert.equal(
    dimensionLabel("ETOEROLES_WARD_1", "boundary", "Etoeroles Ward 1"),
    "Etoeroles Ward 1"
  );
});

test("Unknown department bucket uses DASHBOARD_COMMON_UNKNOWN", () => {
  mockI18n({
    language: "pt_PT",
    bags: {
      pt_PT: { DASHBOARD_COMMON_UNKNOWN: "Desconhecido" },
      en_IN: { DASHBOARD_COMMON_UNKNOWN: "Unknown" },
    },
  });
  const { dimensionLabel } = bundle("dimensionLabel.js");
  assert.equal(dimensionLabel("Unknown", "department"), "Desconhecido");
  assert.equal(dimensionLabel("UNKNOWN", "department"), "Desconhecido");
});

test("boundary/department skip code-echo pack messages and fall through", () => {
  mockI18n({
    language: "pt_PT",
    bags: {
      pt_PT: {
        ETOEROLES_WARD_1: "ETOEROLES_WARD_1",
        COMMON_MASTERS_DEPARTMENT_MEDICAL_SVC: "MEDICAL_SVC",
      },
      en_IN: {
        ETOEROLES_WARD_1: "Etoeroles Ward 1",
        COMMON_MASTERS_DEPARTMENT_MEDICAL_SVC: "Medical Services",
      },
    },
  });
  const { dimensionLabel } = bundle("dimensionLabel.js");
  // pt code-echo skipped → boundary still may use en_IN place name
  assert.equal(dimensionLabel("ETOEROLES_WARD_1", "boundary"), "Etoeroles Ward 1");
  // department does not bleed en_IN; code-echo skipped → raw code
  assert.equal(dimensionLabel("MEDICAL_SVC", "department"), "MEDICAL_SVC");
  // data-owned fallback still wins for department when present
  assert.equal(
    dimensionLabel("MEDICAL_SVC", "department", "Serviços Médicos"),
    "Serviços Médicos"
  );
});

test("active-locale complaintType translation wins", () => {
  mockI18n({
    language: "pt_PT",
    bags: {
      pt_PT: { "COMPLAINT_HIERARCHY.STREETLIGHT": "Lâmpada de rua não funciona" },
      en_IN: { "COMPLAINT_HIERARCHY.STREETLIGHT": "Street Light Not Working" },
    },
  });
  const { dimensionLabel } = bundle("dimensionLabel.js");
  assert.equal(dimensionLabel("STREETLIGHT", "complaintType"), "Lâmpada de rua não funciona");
});
