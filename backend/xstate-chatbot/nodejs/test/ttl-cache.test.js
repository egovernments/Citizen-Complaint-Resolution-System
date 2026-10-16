const test = require("node:test");
const assert = require("node:assert/strict");
const TtlCache = require("../src/ttl-cache");

test("a second read inside the window does not load again", async () => {
  const cache = new TtlCache(60000);
  let loads = 0;
  const load = async () => { loads += 1; return "value"; };

  assert.equal(await cache.get("k", load), "value");
  assert.equal(await cache.get("k", load), "value");
  assert.equal(loads, 1);
});

test("callers racing on a cold key share one load", async () => {
  const cache = new TtlCache(60000);
  let loads = 0;
  const load = () => { loads += 1; return new Promise((r) => setTimeout(() => r("value"), 10)); };

  const [a, b] = await Promise.all([cache.get("k", load), cache.get("k", load)]);
  assert.equal(a, "value");
  assert.equal(b, "value");
  assert.equal(loads, 1, "the second caller awaited the first load, it did not start its own");
});

test("a failed load is not cached", async () => {
  // Caching a rejection would hold a tenant broken for the whole window,
  // long after the backend recovered.
  const cache = new TtlCache(60000);
  let loads = 0;
  const load = async () => { loads += 1; if (loads === 1) throw new Error("MDMS down"); return "value"; };

  await assert.rejects(() => cache.get("k", load), /MDMS down/);
  assert.equal(await cache.get("k", load), "value", "the next caller retries");
  assert.equal(loads, 2);
});

test("keys do not collide", async () => {
  const cache = new TtlCache(60000);
  assert.equal(await cache.get("a", async () => 1), 1);
  assert.equal(await cache.get("b", async () => 2), 2);
  assert.equal(await cache.get("a", async () => 99), 1);
});

test("an expired entry loads again", async () => {
  const cache = new TtlCache(1);
  let loads = 0;
  const load = async () => { loads += 1; return loads; };

  assert.equal(await cache.get("k", load), 1);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(await cache.get("k", load), 2);
});
