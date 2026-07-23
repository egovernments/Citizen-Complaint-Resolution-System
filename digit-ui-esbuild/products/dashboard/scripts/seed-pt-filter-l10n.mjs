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
 * Portuguese (Google via deep-translator) then upserted.
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
const TRANSLATE = process.argv.includes("--translate");
const DRY = process.argv.includes("--dry-run");
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

async function search(module, locale) {
  const params = new URLSearchParams({ module, locale, tenantId: TENANT });
  const res = await fetch(`${BASE}/localization/messages/v1/_search?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      RequestInfo: { apiId: "Rainmaker", ver: ".01", authToken: authToken() },
    }),
  });
  if (!res.ok) throw new Error(`_search ${module} ${locale}: ${res.status}`);
  const data = await res.json();
  return data.messages || [];
}

async function upsert(messages) {
  const params = new URLSearchParams({ tenantId: TENANT, locale: LOCALE });
  const BATCH = 100;
  let upserted = 0;
  for (let i = 0; i < messages.length; i += BATCH) {
    const batch = messages.slice(i, i + BATCH).map((m) => ({ ...m, locale: LOCALE }));
    const res = await fetch(`${BASE}/localization/messages/v1/_upsert?${params}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        RequestInfo: {
          apiId: "Rainmaker",
          ver: ".01",
          authToken: authToken(),
          action: "_upsert",
          msgId: `seed-pt-${Date.now()}`,
        },
        tenantId: TENANT,
        messages: batch,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`_upsert batch ${i}: ${res.status} ${text.slice(0, 300)}`);
    }
    upserted += batch.length;
    console.log(`  upserted ${upserted}/${messages.length}`);
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

async function main() {
  console.log(`Fetching ${SOURCE} packs from ${BASE} (tenant ${TENANT})…`);
  const [boundary, pgr] = await Promise.all([
    search("rainmaker-boundary-admin", SOURCE),
    search("rainmaker-pgr", SOURCE),
  ]);

  const messages = [];

  for (const m of boundary) {
    if (!m?.code || m.message == null) continue;
    messages.push({
      code: m.code,
      message: m.message,
      module: "rainmaker-boundary-admin",
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
    console.log(`dry-run: would upsert ${messages.length} messages`);
    return;
  }

  console.log(`upserting ${messages.length} → ${LOCALE}…`);
  await upsert(messages);

  // egov-localization Redis can keep empty module results after upsert —
  // without this, module-filtered _search still returns [] and the UI never
  // sees the new pt_PT labels.
  try {
    const bust = await fetch(`${BASE}/localization/messages/cache-bust`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        RequestInfo: { apiId: "Rainmaker", ver: ".01", authToken: authToken() },
      }),
    });
    console.log(`cache-bust: ${bust.status}`);
  } catch (e) {
    console.warn("cache-bust failed (non-fatal):", e.message || e);
  }

  console.log("done. Hard-refresh the dashboard (clear Locale.pt_PT.* from localStorage if labels stay stale).");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
