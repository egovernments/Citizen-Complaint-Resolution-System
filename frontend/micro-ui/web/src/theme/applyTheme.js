// Theme loader. Walks a nested color config (validated against schema.json),
// flattens each leaf path into a --color-<path-joined-by-dashes> CSS custom
// property, and writes it to document.documentElement.
//
// Phase 1: called with a bundled default.json at app bootstrap.
// Phase 2 (future): called with the MDMS response keyed by tenantId once the
// tenant is resolved. If validation fails or no config is passed, :root
// defaults prepended to the vendored CSS render the shipped palette.

const Ajv = require("ajv");
const schema = require("./schema.json");

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

function flatten(obj, prefix, out) {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const next = prefix ? `${prefix}-${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, next, out);
    } else {
      out[`--color-${next}`] = value;
    }
  }
}

function applyTheme(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    console.warn("[theme] config must be an object, skipping apply");
    return;
  }
  if (!validate(config)) {
    console.warn("[theme] invalid config, skipping apply", validate.errors);
    return;
  }
  if (!config.colors) return;

  const vars = {};
  flatten(config.colors, "", vars);
  const root = document.documentElement;
  for (const name of Object.keys(vars)) {
    root.style.setProperty(name, vars[name]);
  }
  console.log(`[theme] applied ${Object.keys(vars).length} variables`);
}

module.exports = { applyTheme };
