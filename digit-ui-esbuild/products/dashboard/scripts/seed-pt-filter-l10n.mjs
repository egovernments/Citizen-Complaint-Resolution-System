#!/usr/bin/env node
/**
 * Seed locale labels for dashboard filter/table dimension codes (#1108).
 *
 * Usage (from digit-ui-esbuild/, tunnel on :18080):
 *
 *   EMPLOYEE_TOKEN='…' node products/dashboard/scripts/seed-pt-filter-l10n.mjs
 *   EMPLOYEE_TOKEN='…' node products/dashboard/scripts/seed-pt-filter-l10n.mjs --translate
 *
 * Env / flags:
 *   DIGIT_BASE          API base (default http://127.0.0.1:18080)
 *   TENANT_ID           tenant (default ke)
 *   TARGET_LOCALE       destination locale (default pt_PT)
 *   SOURCE_LOCALE       source locale (default en_IN)
 *   BOUNDARY_MODULE     rainmaker-boundary-<hierarchy> (default rainmaker-boundary-admin;
 *                       mirrors runtime HIERARCHY_TYPE → rainmaker-boundary-${lower})
 *   --translate         machine-translate pgr COMPLAINT_HIERARCHY / SERVICEDEFS
 *   --dry-run           no upsert
 *   --skip-ward-gaps    skip analytics ward-gap pass
 *   --with-ke-admin-alias  also upsert KE_ADMIN_<code> aliases (Bomet pack dual-key;
 *                       off by default — doubles the boundary namespace)
 *   --out=<path>        write intended TARGET_LOCALE payload JSON
 *
 * Without --translate: boundary messages are copied source→target (place names);
 * pgr complaint keys are skipped.
 * With --translate: unique English pgr strings go through MyMemory; failures
 * SKIP the key (never bake English into the target pack).
 *
 * Ward-gap pass (default on): analytics ward_code distincts missing from the
 * boundary pack get operator-authored display names upserted to SOURCE_LOCALE
 * then copied with the pack — not a runtime humaniser.
 *
 * Token: DevTools → Application → Local Storage → Employee.token
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function argValue(prefix) {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

const BASE = process.env.DIGIT_BASE || "http://127.0.0.1:18080";
const TENANT = process.env.TENANT_ID || "ke";
const LOCALE = process.env.TARGET_LOCALE || argValue("--locale=") || "pt_PT";
const SOURCE = process.env.SOURCE_LOCALE || "en_IN";
const BOUNDARY_MODULE =
  process.env.BOUNDARY_MODULE ||
  `rainmaker-boundary-${(process.env.HIERARCHY_TYPE || "admin").toString().toLowerCase()}`;
const TRANSLATE = process.argv.includes("--translate");
const DRY = process.argv.includes("--dry-run");
const SKIP_WARD_GAPS = process.argv.includes("--skip-ward-gaps");
const WITH_KE_ADMIN_ALIAS = process.argv.includes("--with-ke-admin-alias");
const OUT = argValue("--out=");

function authToken() {
  const raw = process.env.EMPLOYEE_TOKEN;
  if (!raw) {
    console.error("Set EMPLOYEE_TOKEN to an employee auth token (localStorage Employee.token).");
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function requestInfo() {
  return { apiId: "Rainmaker", ver: ".01", authToken: authToken() };
}

async function search(module, locale) {
  const params = new URLSearchParams({ module, locale, tenantId: TENANT });
  const res = await fetch(`${BASE}/localization/messages/v1/_search?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ RequestInfo: requestInfo() }),
  });
  if (!res.ok) throw new Error(`_search ${module} ${locale}: ${res.status}`);
  const data = await res.json();
  return data.messages || [];
}

async function upsertLocale(locale, messages) {
  if (!messages.length) return 0;
  const params = new URLSearchParams({ tenantId: TENANT, locale });
  const BATCH = 100;
  let upserted = 0;
  for (let i = 0; i < messages.length; i += BATCH) {
    const batch = messages.slice(i, i + BATCH).map((m) => ({ ...m, locale }));
    const res = await fetch(`${BASE}/localization/messages/v1/_upsert?${params}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        RequestInfo: {
          ...requestInfo(),
          action: "_upsert",
          msgId: `seed-l10n-${locale}-${Date.now()}`,
        },
        tenantId: TENANT,
        messages: batch,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`_upsert ${locale} batch ${i}: ${res.status} ${text.slice(0, 300)}`);
    }
    upserted += batch.length;
    console.log(`  upserted ${locale} ${upserted}/${messages.length}`);
  }
  return upserted;
}

/**
 * Machine-translate unique English strings → target language (MyMemory).
 * On failure / quota warning / echo-of-English the key is OMITTED from the map
 * (never falls back to English — that would hide gaps in the target pack).
 */
async function translateMap(uniqueEnglish, langpair) {
  const cache = {};
  let skipped = 0;
  for (let i = 0; i < uniqueEnglish.length; i++) {
    const text = uniqueEnglish[i];
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langpair}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        skipped += 1;
        continue;
      }
      const data = await res.json();
      // MyMemory uses string "200" on success; quota exhaustion still returns
      // HTTP 200 with translatedText = "MYMEMORY WARNING: …".
      const status = String(data?.responseStatus ?? "");
      const translated = data?.responseData?.translatedText;
      const usable =
        status === "200" &&
        typeof translated === "string" &&
        translated.trim() !== "" &&
        translated !== text &&
        !/^MYMEMORY WARNING/i.test(translated);
      if (usable) {
        cache[text] = translated;
      } else {
        skipped += 1;
      }
    } catch {
      skipped += 1;
    }
    if (i % 25 === 0) console.log(`  translated ${i}/${uniqueEnglish.length} (skipped ${skipped})`);
    await new Promise((r) => setTimeout(r, 120));
  }
  console.log(`  translate done: ${Object.keys(cache).length} ok, ${skipped} skipped`);
  return { cache, skipped };
}

function normalizeKey(code) {
  return String(code ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Seed-time title for ward codes with no pack entry. Intentionally NOT used
 * at runtime in dimensionLabel — only when authoring localization messages.
 */
function seedDisplayNameForWardCode(code) {
  const raw = String(code ?? "").trim();
  if (!raw) return "";
  let s = raw.replace(/^(KE_ADMIN_)+/i, "");
  s = s.replace(/^BOMET_/i, "");
  s = s
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return s
    .split(" ")
    .map((w) => {
      if (!w) return w;
      if (/^\d+[A-Z]?\d*$/i.test(w) || /^[A-Z]\d+/i.test(w)) return w.toUpperCase();
      const lower = w.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function buildBoundaryPackIndex(messages) {
  const byCode = new Map();
  const byNormalized = new Map();
  for (const m of messages) {
    if (!m?.code || m.message == null || m.message === "") continue;
    byCode.set(m.code, m.message);
    byNormalized.set(normalizeKey(m.code), m.message);
  }
  return { byCode, byNormalized };
}

function resolvePackMessage(code, index) {
  if (index.byCode.has(code)) return index.byCode.get(code);
  const want = normalizeKey(code);
  return index.byNormalized.has(want) ? index.byNormalized.get(want) : null;
}

/**
 * Boundary message rows for a code. KE_ADMIN_<code> is optional — some tenants
 * (Bomet) seeded both bare and prefixed keys; default off to avoid doubling.
 */
function boundaryMessageRows(code, message) {
  const rows = [{ code, message, module: BOUNDARY_MODULE }];
  if (WITH_KE_ADMIN_ALIAS && !code.startsWith("KE_ADMIN_")) {
    rows.push({ code: `KE_ADMIN_${code}`, message, module: BOUNDARY_MODULE });
  }
  return rows;
}

async function fetchAnalyticsWardCodes() {
  const WARD_LIMIT = 300;
  const res = await fetch(`${BASE}/pgr-services/v2/analytics/_query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      RequestInfo: requestInfo(),
      tenantId: TENANT,
      queries: {
        wards: {
          grain: "facts",
          window: { name: "all" },
          dimensions: ["ward_code"],
          measures: [{ name: "n", agg: "count" }],
          limit: WARD_LIMIT,
        },
      },
    }),
  });
  if (!res.ok) {
    console.warn(`analytics ward distinct failed (${res.status}) — skipping ward-gap pass`);
    return [];
  }
  const data = await res.json();
  const rows = data?.results?.wards?.rows || [];
  if (rows.length >= WARD_LIMIT) {
    console.warn(
      `ward distinct hit limit=${WARD_LIMIT} — some ward_codes may be missing from the gap pass; ` +
        `raise the limit or re-run with a narrower analytics window`
    );
  }
  return [...new Set(rows.map((r) => String(r?.ward_code ?? "").trim()).filter(Boolean))];
}

function buildWardGapMessages(wardCodes, boundaryPack) {
  const index = buildBoundaryPackIndex(boundaryPack);
  const gaps = [];
  const seenCodes = new Set();

  for (const code of wardCodes) {
    if (resolvePackMessage(code, index)) continue;

    const want = normalizeKey(code);
    let message = index.byNormalized.get(want) || null;
    if (!message || String(message) === code) {
      message = seedDisplayNameForWardCode(code);
    }
    if (!message || message === code) continue;

    for (const row of boundaryMessageRows(code, message)) {
      if (seenCodes.has(row.code)) continue;
      seenCodes.add(row.code);
      gaps.push(row);
    }
  }
  return gaps;
}

async function cacheBust() {
  try {
    const bust = await fetch(`${BASE}/localization/messages/cache-bust`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ RequestInfo: requestInfo() }),
    });
    console.log(`cache-bust: ${bust.status}`);
  } catch (e) {
    console.warn("cache-bust failed (non-fatal):", e.message || e);
  }
}

async function main() {
  console.log(
    `Fetching ${SOURCE} packs from ${BASE} (tenant ${TENANT}, module ${BOUNDARY_MODULE}, target ${LOCALE})…`
  );
  let boundary = await search(BOUNDARY_MODULE, SOURCE);
  const pgr = await search("rainmaker-pgr", SOURCE);

  if (!SKIP_WARD_GAPS) {
    const wardCodes = await fetchAnalyticsWardCodes();
    const gapMessages = buildWardGapMessages(wardCodes, boundary);
    const gapCount = new Set(
      gapMessages.map((m) => m.code.replace(/^KE_ADMIN_/, ""))
    ).size;
    console.log(
      `ward gaps: ${wardCodes.length} analytics wards, ${gapCount} missing codes to upsert into ${SOURCE}`
    );
    if (gapMessages.length) {
      if (DRY) {
        console.log("dry-run ward gaps:", gapMessages.slice(0, 6), "…");
      } else {
        await upsertLocale(SOURCE, gapMessages);
        boundary = await search(BOUNDARY_MODULE, SOURCE);
      }
    }
  } else {
    console.log("skipping ward-gap pass (--skip-ward-gaps)");
  }

  const messages = [];

  for (const m of boundary) {
    if (!m?.code || m.message == null) continue;
    messages.push({
      code: m.code,
      message: m.message,
      module: BOUNDARY_MODULE,
    });
  }
  console.log(`boundary copy ${SOURCE}→${LOCALE}: ${messages.length}`);

  const pgrKeys = pgr.filter(
    (m) =>
      m?.code &&
      (m.code.startsWith("COMPLAINT_HIERARCHY.") || m.code.startsWith("SERVICEDEFS."))
  );

  let translateSkipped = 0;
  if (TRANSLATE) {
    const unique = [...new Set(pgrKeys.map((m) => m.message).filter(Boolean))];
    const langpair = `${SOURCE.split("_")[0].toLowerCase()}|${LOCALE.split("_")[0].toLowerCase()}`;
    console.log(`translating ${unique.length} unique pgr strings (${langpair})…`);
    const { cache, skipped } = await translateMap(unique, langpair);
    translateSkipped = skipped;
    let upsertedPgr = 0;
    for (const m of pgrKeys) {
      const translated = cache[m.message];
      if (!translated) continue; // skip — do not bake English into target
      messages.push({
        code: m.code,
        message: translated,
        module: "rainmaker-pgr",
      });
      upsertedPgr += 1;
    }
    console.log(`pgr keys with translation: ${upsertedPgr}/${pgrKeys.length}`);
  } else {
    console.log(
      `skipping ${pgrKeys.length} pgr keys (pass --translate for machine-translated complaint types)`
    );
  }

  if (OUT) {
    writeFileSync(OUT, JSON.stringify({ locale: LOCALE, tenantId: TENANT, messages }, null, 1));
    console.log(`wrote ${OUT} (${messages.length} messages)`);
  }

  if (DRY) {
    console.log(`dry-run: would upsert ${messages.length} messages → ${LOCALE}`);
    if (translateSkipped) console.log(`dry-run: would skip ${translateSkipped} failed translations`);
    return;
  }

  console.log(`upserting ${messages.length} → ${LOCALE}…`);
  await upsertLocale(LOCALE, messages);
  await cacheBust();

  if (translateSkipped) {
    console.log(`note: ${translateSkipped} pgr strings skipped (translate failure — gaps stay visible)`);
  }
  console.log(
    "done. Hard-refresh the dashboard (clear Digit.Locale.* from localStorage if labels stay stale)."
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
