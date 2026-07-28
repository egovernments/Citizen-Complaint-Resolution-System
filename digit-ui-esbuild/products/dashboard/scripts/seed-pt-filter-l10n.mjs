#!/usr/bin/env node
/**
 * Seed pt_PT labels for dashboard filter/table dimension codes (#1108).
 *
 * Bomet today:
 *   rainmaker-dashboard pt_PT  → ~316 (chrome OK)
 *   rainmaker-pgr pt_PT        → 0     (complaint types stay English via MDMS)
 *   rainmaker-boundary-admin   → 0     (wards fall back to en_IN in FE, or raw)
 *
 * Usage (from digit-ui-esbuild/, tunnel on :18080):
 *
 *   EMPLOYEE_TOKEN='…' node products/dashboard/scripts/seed-pt-filter-l10n.mjs
 *   EMPLOYEE_TOKEN='…' node products/dashboard/scripts/seed-pt-filter-l10n.mjs --translate
 *
 * Without --translate: boundary messages are copied en→pt (place names); pgr
 * complaint keys are skipped (would still be English).
 * With --translate: unique English pgr strings are machine-translated to
 * Portuguese via MyMemory (api.mymemory.translated.net; ~120ms between calls
 * to stay under the free-tier rate limit) then upserted.
 *
 * Ward-gap pass (default on, `--skip-ward-gaps` to disable): analytics
 * distinct ward_code values that are missing from rainmaker-boundary-admin
 * get operator-authored display names upserted to en_IN (and copied to pt_PT
 * with the rest of the boundary pack). This is the supported fix for raw
 * codes like ETOEROLES_WARD_1 in the filter dropdown — not a runtime humaniser.
 *
 * Token: DevTools → Application → Local Storage → Employee.token (JSON string
 * without quotes, or the raw JWT).
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const BASE = process.env.DIGIT_BASE || "http://127.0.0.1:18080";
const TENANT = process.env.TENANT_ID || "ke";
const LOCALE = "pt_PT";
const SOURCE = "en_IN";
const BOUNDARY_MODULE = "rainmaker-boundary-admin";
const TRANSLATE = process.argv.includes("--translate");
const DRY = process.argv.includes("--dry-run");
const SKIP_WARD_GAPS = process.argv.includes("--skip-ward-gaps");
const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6);

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
          msgId: `seed-pt-${locale}-${Date.now()}`,
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

/** Machine-translate unique English strings → Portuguese (MyMemory, rate-limited). */
async function translateMap(uniqueEnglish) {
  const cache = {};
  for (let i = 0; i < uniqueEnglish.length; i++) {
    const text = uniqueEnglish[i];
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|pt`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      cache[text] = data?.responseData?.translatedText || text;
    } catch {
      cache[text] = text;
    }
    if (i % 25 === 0) console.log(`  translated ${i}/${uniqueEnglish.length}`);
    await new Promise((r) => setTimeout(r, 120));
  }
  return cache;
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
  for (const [k, message] of index.byNormalized) {
    if (k === want) return message;
  }
  return null;
}

function boundaryMessageRows(code, message) {
  const rows = [
    { code, message, module: BOUNDARY_MODULE },
    { code: `KE_ADMIN_${code}`, message, module: BOUNDARY_MODULE },
  ];
  return rows;
}

async function fetchAnalyticsWardCodes() {
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
          limit: 300,
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
  return [...new Set(rows.map((r) => String(r?.ward_code ?? "").trim()).filter(Boolean))];
}

/**
 * Ward codes present in analytics but absent from the boundary pack (incl.
 * underscore-insensitive match). Upsert en_IN aliases so dimensionLabel can
 * resolve them without a runtime humaniser.
 */
function buildWardGapMessages(wardCodes, boundaryPack) {
  const index = buildBoundaryPackIndex(boundaryPack);
  const gaps = [];
  const seenCodes = new Set();

  for (const code of wardCodes) {
    if (resolvePackMessage(code, index)) continue;

    const want = normalizeKey(code);
    let message = null;
    for (const m of boundaryPack) {
      if (
        m?.code &&
        normalizeKey(m.code) === want &&
        m.message &&
        String(m.message) !== code
      ) {
        message = m.message;
        break;
      }
    }
    if (!message) message = seedDisplayNameForWardCode(code);
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
  console.log(`Fetching ${SOURCE} packs from ${BASE} (tenant ${TENANT})…`);
  let boundary = await search(BOUNDARY_MODULE, SOURCE);
  const pgr = await search("rainmaker-pgr", SOURCE);

  if (!SKIP_WARD_GAPS) {
    const wardCodes = await fetchAnalyticsWardCodes();
    const gapMessages = buildWardGapMessages(wardCodes, boundary);
    const gapCount = new Set(gapMessages.map((m) => m.code.replace(/^KE_ADMIN_/, ""))).size;
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
  console.log(`boundary copy en→${LOCALE}: ${messages.length}`);

  const pgrKeys = pgr.filter(
    (m) =>
      m?.code &&
      (m.code.startsWith("COMPLAINT_HIERARCHY.") || m.code.startsWith("SERVICEDEFS."))
  );

  if (TRANSLATE) {
    const unique = [...new Set(pgrKeys.map((m) => m.message).filter(Boolean))];
    console.log(`translating ${unique.length} unique pgr strings…`);
    const cache = await translateMap(unique);
    for (const m of pgrKeys) {
      messages.push({
        code: m.code,
        message: cache[m.message] || m.message,
        module: "rainmaker-pgr",
      });
    }
  } else {
    console.log(
      `skipping ${pgrKeys.length} pgr keys (pass --translate for Portuguese complaint types)`
    );
  }

  if (OUT) {
    writeFileSync(OUT, JSON.stringify({ locale: LOCALE, tenantId: TENANT, messages }, null, 1));
    console.log(`wrote ${OUT} (${messages.length} messages)`);
  }

  if (DRY) {
    console.log(`dry-run: would upsert ${messages.length} messages → ${LOCALE}`);
    return;
  }

  console.log(`upserting ${messages.length} → ${LOCALE}…`);
  await upsertLocale(LOCALE, messages);
  await cacheBust();

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
