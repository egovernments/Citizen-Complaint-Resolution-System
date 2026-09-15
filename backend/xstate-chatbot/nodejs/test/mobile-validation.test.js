const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const envPath = path.join(projectRoot, "src/env-variables.js");
const servicePath = path.join(projectRoot, "src/machine/service/mobile-validation-service.js");

const INDIA = { countryCode: "+91", mobileNumberRegex: "^[0-9]{10}$" };
// Exactly the seeded ke row (utilities/default-data-handler .../MobileNumberValidation.json).
const KENYA = { countryCode: "+254", mobileNumberRegex: "^0?[17][0-9]{8}$" };
// pg.citya's narrower rule: 9 digits starting 7 or 9. The old hardcoded sanitiser
// rejected these outright because it only ever accepted 10 digits.
const PG_CITYA = { countryCode: "+91", mobileNumberRegex: "^[79][0-9]{8}$" };

function loadService({ fetchImpl, defaultCountryCode = "+91", defaultRegex = "^[0-9]{10}$" } = {}) {
  delete require.cache[servicePath];
  require.cache[envPath] = {
    id: envPath,
    filename: envPath,
    loaded: true,
    exports: {
      rootTenantId: "pg",
      mobileValidation: { defaultCountryCode, defaultRegex, cacheTtlMs: 300000 },
      egovServices: {
        egovServicesHost: "http://localhost/",
        mdmsV2SearchPath: "mdms-v2/v2/_search",
      },
    },
  };
  const fetchPath = require.resolve("node-fetch", { paths: [projectRoot] });
  if (fetchImpl) {
    require.cache[fetchPath] = {
      id: fetchPath,
      filename: fetchPath,
      loaded: true,
      exports: fetchImpl,
    };
  }
  const service = require(servicePath);
  service.clearCache();
  return service;
}

test("India: inbound forms all reduce to the national number", () => {
  const s = loadService();
  for (const input of [
    "whatsapp:+919876543210",
    "+919876543210",
    "919876543210",
    "9876543210",
  ]) {
    assert.equal(s.toNational(input, INDIA), "9876543210", `failed for ${input}`);
  }
});

test("India: outbound addressing is unchanged from the old hardcoded behaviour", () => {
  const s = loadService();
  // Previously the code did `whatsapp:+91${to}` -- this must stay byte-identical.
  assert.equal(s.toE164("9876543210", INDIA), "+919876543210");
  assert.equal(s.toInternational("9876543210", INDIA), "919876543210");
});

test("Kenya: the number that used to be rejected now round-trips", () => {
  const s = loadService();
  // The exact failure this change fixes: 12 digits not starting 91 returned null.
  assert.equal(s.toNational("whatsapp:+254712345678", KENYA), "712345678");
  assert.equal(s.toE164("712345678", KENYA), "+254712345678");
});

test("Kenya: the trunk 0 is accepted inbound and dropped for E.164", () => {
  const s = loadService();
  assert.equal(s.toNational("0712345678", KENYA), "0712345678");
  // +2540712... is invalid; Twilio rejects it.
  assert.equal(s.toE164("0712345678", KENYA), "+254712345678");
  // Country code with the trunk 0 still glued on.
  assert.equal(s.toNational("+2540712345678", KENYA), "0712345678");
});

test("a tenant rule narrower than 10 digits is honoured", () => {
  const s = loadService();
  assert.equal(s.toNational("712345679", PG_CITYA), "712345679");
  assert.equal(s.toNational("+91712345679", PG_CITYA), "712345679");
  // 10 digits is NOT valid for this tenant even though it is the India default.
  assert.equal(s.toNational("9876543210", PG_CITYA), null);
});

test("numbers that do not match the tenant rule are rejected, not mangled", () => {
  const s = loadService();
  assert.equal(s.toNational("12345", INDIA), null);
  assert.equal(s.toNational("", INDIA), null);
  assert.equal(s.toNational(null, INDIA), null);
  assert.equal(s.toNational("254712345678", INDIA), null);
});

test("toInternational is idempotent when the country code is already present", () => {
  const s = loadService();
  assert.equal(s.toInternational("919876543210", INDIA), "919876543210");
  assert.equal(s.toInternational("254712345678", KENYA), "254712345678");
});

test("a malformed regex in MDMS falls back instead of throwing", () => {
  const s = loadService();
  const broken = { countryCode: "+91", mobileNumberRegex: "^[0-9{10}$" };
  assert.equal(s.toNational("9876543210", broken), "9876543210");
});

test("getConfig reads the default row from MDMS v2", async () => {
  const s = loadService({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        mdms: [
          { isActive: true, data: { countryCode: "+1", mobileNumberRegex: "^[0-9]{3}$", default: false } },
          { isActive: true, data: { countryCode: "+254", mobileNumberRegex: "^0?[17][0-9]{8}$", default: true } },
        ],
      }),
    }),
  });
  const resolved = await s.getConfig("ke");
  assert.equal(resolved.countryCode, "+254");
  assert.equal(resolved.mobileNumberRegex, "^0?[17][0-9]{8}$");
});

test("inactive rows are ignored", async () => {
  const s = loadService({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        mdms: [
          { isActive: false, data: { countryCode: "+1", mobileNumberRegex: "^[0-9]{3}$", default: true } },
          { isActive: true, data: { countryCode: "+254", mobileNumberRegex: "^0?[17][0-9]{8}$" } },
        ],
      }),
    }),
  });
  assert.equal((await s.getConfig("ke")).countryCode, "+254");
});

test("MDMS being unreachable falls back to India rather than failing the message", async () => {
  const s = loadService({
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  const resolved = await s.getConfig("pg");
  assert.equal(resolved.countryCode, "+91");
  assert.equal(resolved.fallback, true);
});

test("an empty MDMS result falls back", async () => {
  const s = loadService({
    fetchImpl: async () => ({ ok: true, json: async () => ({ mdms: [] }) }),
  });
  assert.equal((await s.getConfig("pg")).fallback, true);
});

test("the resolved config is cached per tenant", async () => {
  let calls = 0;
  const s = loadService({
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => ({
          mdms: [{ isActive: true, data: { countryCode: "+254", mobileNumberRegex: "^[17][0-9]{8}$", default: true } }],
        }),
      };
    },
  });
  await s.getConfig("ke");
  await s.getConfig("ke");
  await s.getConfig("ke");
  assert.equal(calls, 1);
});

// ---------------------------------------------------------------------------
// Regressions from PR #2054 review. Each of these failed before the fix.
// ---------------------------------------------------------------------------

test("REGRESSION #3: an Indian national number starting 91 keeps its country code", () => {
  const s = loadService();
  // 9123456789 is a valid 10-digit Indian mobile that happens to start with the dial
  // code. The old `startsWith(cc)` shortcut treated it as already-international and
  // returned +9123456789 -- Twilio 21211, citizen gets no reply.
  for (const national of ["9123456789", "9188776655", "9100000001"]) {
    assert.equal(s.toInternational(national, INDIA), "91" + national);
    assert.equal(s.toE164(national, INDIA), "+91" + national);
  }
});

test("REGRESSION #3: inbound -> outbound round-trip is stable for 91-prefixed mobiles", () => {
  const s = loadService();
  for (const raw of ["whatsapp:+919123456789", "whatsapp:+919188776655"]) {
    const national = s.toNational(raw, INDIA);
    // Must match what the old hardcoded `whatsapp:+91${to}` produced.
    assert.equal(s.toE164(national, INDIA), "+91" + national);
    assert.equal(s.digitsOnly(raw), s.toInternational(national, INDIA));
  }
});

test("REGRESSION #2: a bare national number is never rewritten to a different one", () => {
  const s = loadService();
  const US = { countryCode: "+1", mobileNumberRegex: "^[0-9]{10}$" };
  // Stripping the country code first ate the leading '1' and prepended a fabricated '0',
  // yielding 0234567890 -- a DIFFERENT subscriber, which then flowed into createUser.
  assert.equal(s.toNational("1234567890", US), "1234567890");
  assert.equal(s.toNational("+11234567890", US), "1234567890");
  assert.equal(s.toNational("11234567890", US), "1234567890");
});

test("REGRESSION #1: a city tenant falls back to its state root, not to India", async () => {
  const seen = [];
  const s = loadService({
    fetchImpl: async (url, opts) => {
      seen.push(JSON.parse(opts.body).MdmsCriteria.tenantId);
      const t = JSON.parse(opts.body).MdmsCriteria.tenantId;
      // MobileNumberValidation is seeded at the STATE tenant only.
      if (t !== "ke") return { ok: true, json: async () => ({ mdms: [] }) };
      return {
        ok: true,
        json: async () => ({
          mdms: [{ isActive: true, data: { countryCode: "+254", mobileNumberRegex: "^0?[17][0-9]{8}$", default: true } }],
        }),
      };
    },
  });
  const resolved = await s.getConfig("ke.nairobi");
  assert.deepEqual(seen, ["ke.nairobi", "ke"]);
  assert.equal(resolved.countryCode, "+254");
  assert.notEqual(resolved.fallback, true);
});

test("REGRESSION #1: an unqualified tenant is not looked up twice", async () => {
  const seen = [];
  const s = loadService({
    fetchImpl: async (url, opts) => {
      seen.push(JSON.parse(opts.body).MdmsCriteria.tenantId);
      return { ok: true, json: async () => ({ mdms: [] }) };
    },
  });
  await s.getConfig("pg");
  assert.deepEqual(seen, ["pg"]);
});
