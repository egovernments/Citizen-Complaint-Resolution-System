const { test } = require("node:test");
const assert = require("node:assert/strict");

function stubDocument() {
  const props = {};
  global.document = {
    documentElement: {
      style: {
        setProperty(name, value) { props[name] = value; },
      },
    },
  };
  const origWarn = console.warn;
  const origLog = console.log;
  console.warn = () => {};
  console.log = () => {};
  return { props, restore: () => { console.warn = origWarn; console.log = origLog; } };
}

function freshApply() {
  delete require.cache[require.resolve("./applyTheme.js")];
  return require("./applyTheme.js").applyTheme;
}

test("valid config: writes all flattened variables", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({
      version: "1",
      colors: {
        primary: { main: "#ff0000", light: "#ff8080", dark: "#800000" },
        secondary: "#00ff00",
      },
    });
    assert.equal(props["--color-primary-main"], "#ff0000");
    assert.equal(props["--color-primary-light"], "#ff8080");
    assert.equal(props["--color-primary-dark"], "#800000");
    assert.equal(props["--color-secondary"], "#00ff00");
  } finally { restore(); }
});

test("missing colors key: valid config shape, no-op", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({ version: "1" });
    assert.deepEqual(props, {});
  } finally { restore(); }
});

test("invalid value shape (not a hex): no-op", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({ version: "1", colors: { primary: { main: "not-a-color" } } });
    assert.deepEqual(props, {});
  } finally { restore(); }
});

test("null / undefined / non-object config: no-op", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme(null);
    applyTheme(undefined);
    applyTheme(42);
    applyTheme("theme");
    applyTheme([1, 2]);
    assert.deepEqual(props, {});
  } finally { restore(); }
});
