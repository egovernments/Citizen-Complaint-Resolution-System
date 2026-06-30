# Onboarding the PGR dynamic-fields masters — guide (Local + Production)

**Who this is for:** anyone (even with zero DIGIT/MDMS experience) who needs the citizen
**"Complaint related to"** dropdown and the per-authority **dynamic detail fields** to work on a
tenant — local **or** production. **You run one script.** It checks, fixes, seeds, and verifies.

---

## 0. What you're setting up (1-minute version)

The citizen complaint form starts with **"Complaint related to"**, which routes the complaint to
the right authority (IGE / IGSAE / …) and then shows that authority's detail fields. Two MDMS
master datasets drive it:

| Master | Plain meaning |
|---|---|
| `RAINMAKER-PGR.ComplaintRelatedToMap` | The category dropdown (`code`/`name`/`shortName`) → which sub-tenant each routes to. |
| `RAINMAKER-PGR.ComplaintTemplateType` | Per category (`caseRelatedTo`): which JSON Schema (`schemaRef`) + allowed document types. |
| `RAINMAKER-PGR.ComplaintExtendedAttributeSchema` | The JSON Schema (per `schemaRef`) that defines the dynamic fields the form renders. |

- **Tenant** = an org/area: a **state** (e.g. `mz`) and **sub-tenants** under it (`mz.ige`, `mz.igsae`).
- **Key fact:** these are **state-level**. Seed them **once at the state** (`mz`); every sub-tenant
  inherits them automatically (MDMS "state fallback"). You do **not** repeat per sub-tenant.

---

## 1. What's automatic on a fresh tenant?

| | Automatic when a tenant is created? |
|---|---|
| The **schema** (the data's *shape*) | ✅ Yes — the platform registers it. |
| The **data** (the rows) | ❌ No — you seed it. **→ the one script below does this.** |

---

## 2. Set up your environment (once)

Pick your environment and export these — the script reads them.

### 🖥️ Local
```bash
export BASE_URL=http://localhost:18000     # local gateway
export TENANT=mz                           # your state tenant
# Auth defaults to ADMIN / eGov@123 locally — nothing else to set.
```

### 🌐 Production (run ON the prod server, after you `ssh` in)
```bash
export BASE_URL=http://<prod-host>         # e.g. http://20.40.49.209  (or https://<domain>)
export TENANT=mz
export OAUTH_USER='<prodAdmin>'; export OAUTH_PASS='<prodPassword>'   # or:  export TOKEN='<authToken>'
export PGPASSWORD='<egov-db-password>'     # lets the script auto-repair the x-ref quirk if needed
```

| | Local | Production |
|---|---|---|
| `BASE_URL` | `http://localhost:18000` | prod gateway host/domain |
| Auth | default `ADMIN`/`eGov@123` | `OAUTH_USER`/`OAUTH_PASS` or `TOKEN` |
| `PGPASSWORD` | not needed (trust) | the egov DB password (for the auto-repair) |
| Where to run | your machine | the prod VM |

Also needed (both): the stack is running, **Node.js** installed, and you're in the repo root.

---

## 3. Which situation are you in?

- **Adding a sub-tenant under a state that's already seeded** → it **inherits** the masters →
  skip to **[§5 verify](#5-final-check-in-the-ui)**.
- **A new state, or first time** → run the script (§4).

---

## 4. Run it — one command ⭐

```bash
BASE_URL=$BASE_URL TENANT=$TENANT node docs/migration/seed-pgr-masters.cjs
```
*(On prod, `OAUTH_USER`/`OAUTH_PASS` (or `TOKEN`) and `PGPASSWORD` from §2 are picked up
automatically — the command is the same.)*

**What it does (and verifies as it goes):**
1. **Preflight** — logs in (fails loudly with the fix if the gateway/creds are wrong).
2. **Register schemas** — idempotent; auto-strips the empty `x-ref-schema` so the mdms-v2 quirk
   can't happen.
3. **Seed data** — idempotent; if a *pre-existing* schema still has the x-ref quirk it **repairs it
   automatically** (via the DB) and retries.
4. **Verify** — confirms all three masters actually have rows at the state.

**Expected output:**
```
[1/4] Preflight — logging in…            ✓ authenticated
[2/4] Registering schemas…               ✓ / • already present
[3/4] Seeding data…                      ✓ data … created / already present
[4/4] Verifying…                         ✓ …ComplaintRelatedToMap: 2 row(s)
                                         ✓ …ComplaintTemplateType: 2 row(s)
                                         ✓ …ComplaintExtendedAttributeSchema: 2 row(s)
✅ DONE — all masters present at 'mz'. Sub-tenants inherit them via state-fallback.
```

**If it stops with `✗`** it prints the exact reason **and the fix** (e.g. the one x-ref SQL line if
it couldn't reach the DB to auto-repair). Apply it, re-run — the script is safe to re-run.

> It's **idempotent**: re-running just reports "already present". No harm.

> **Re-seeding after a shape change (`RESEED=1`).** If a master was *already* seeded with an older
> shape (e.g. before the `code` / `caseRelatedTo` rename), a plain re-run keeps the old shape
> (idempotent → "already present"). To replace it, run once with `RESEED=1` — it first removes the
> old schema definitions + data for these masters, then re-registers and re-seeds:
> ```bash
> RESEED=1 BASE_URL=$BASE_URL TENANT=$TENANT node docs/migration/seed-pgr-masters.cjs
> ```
> Locally it clears them via the DB container; on prod it prints the exact `DELETE` SQL to run.

---

## 5. Final check in the UI

Open the citizen app and **hard-refresh** (Ctrl+Shift+R):
- Local: `http://localhost/digit-ui/citizen` · Prod: `http://<prod-host>/digit-ui/citizen`

**File a Complaint → Step 1** → the **"Complaint related to"** dropdown shows your options; picking
one loads that authority's complaint types and (Step 3) its dynamic fields. ✅

---

## 6. Adding a NEW authority later

A new authority is **just data** — no code:
1. Add a row to `docs/migration/seed/ComplaintRelatedToMap.json` (new option → its sub-tenant).
2. Add a matching entry to `docs/migration/seed/ComplaintTemplateType.json` (its field set).
3. Re-run the script (§4) — it seeds the new rows and skips existing ones.
4. Onboard the new sub-tenant's hierarchy/departments/employees via the configurator as usual.

---

## 7. Why isn't this fully automatic on tenant-create?

The data is **deployment-specific** (it names *your* authorities and sub-tenants), so it is **not**
baked into the shared product defaults — that would leak onto unrelated deployments. The schema
(generic) auto-registers; the data is this one-command seed, run once per state.

---

## 8. Troubleshooting

| Symptom | Cause → Fix |
|---|---|
| `login failed` | Gateway unreachable (`BASE_URL`) or wrong creds. Local: `ADMIN`/`eGov@123`. Prod: set `OAUTH_USER`/`OAUTH_PASS` (or `TOKEN`) for the state. |
| Script prints `could NOT auto-repair` for x-ref | It couldn't reach the DB (e.g. run off-VM, or `PGPASSWORD` unset on prod). Run the SQL it printed, then re-run the script. |
| `✗ … 0 row(s)` at verify | Seeding didn't complete — read the `✗` line above it. |
| Dropdown empty in the UI | Seeded at the wrong tenant — it's **state-level**, seed at the **state** (`TENANT=mz`), not a sub-tenant. Also **hard-refresh** (UI caches MDMS ~1 day; or clear DevTools → Application → IndexedDB → `digit-ui` → `mdms_cache`). |
| Both authorities show the **same** complaint types | A complaint hierarchy was loaded into the wrong sub-tenant — a *different* issue from these masters. |

---

## Appendix A — Manual steps (only if you can't run the script)

The script does all of this for you. Use this only to do it by hand or to understand it.

```bash
# 1) register the three schemas at the state
TENANT=$TENANT BASE_URL=$BASE_URL SCHEMA_CODES=RAINMAKER-PGR.ComplaintRelatedToMap,RAINMAKER-PGR.ComplaintTemplateType,RAINMAKER-PGR.ComplaintExtendedAttributeSchema \
  node docs/migration/install-schemas.cjs

# 2) ONLY if data-create later errors with ClassCastException (x-ref quirk on a pre-existing schema):
docker exec docker-postgres psql -U egov -d egov -c \
  "UPDATE eg_mdms_schema_definition SET definition=jsonb_set(definition,'{x-ref-schema}','[]'::jsonb) \
   WHERE tenantid='$TENANT' AND code IN ('RAINMAKER-PGR.ComplaintRelatedToMap','RAINMAKER-PGR.ComplaintTemplateType','RAINMAKER-PGR.ComplaintExtendedAttributeSchema') \
     AND jsonb_typeof(definition->'x-ref-schema')='object';"
#   (prod: same SQL on the prod DB with the egov password)

# 3) seed the data (UID key per master: code / caseRelatedTo / schemaRef)
TENANT=$TENANT BASE_URL=$BASE_URL SCHEMA=RAINMAKER-PGR.ComplaintRelatedToMap \
  FILE=docs/migration/seed/ComplaintRelatedToMap.json UID_KEY=code node docs/migration/seed-data.cjs
TENANT=$TENANT BASE_URL=$BASE_URL SCHEMA=RAINMAKER-PGR.ComplaintTemplateType \
  FILE=docs/migration/seed/ComplaintTemplateType.json UID_KEY=caseRelatedTo node docs/migration/seed-data.cjs
TENANT=$TENANT BASE_URL=$BASE_URL SCHEMA=RAINMAKER-PGR.ComplaintExtendedAttributeSchema \
  FILE=docs/migration/seed/ComplaintExtendedAttributeSchema.json UID_KEY=schemaRef node docs/migration/seed-data.cjs

# 4) verify
docker exec docker-postgres psql -U egov -d egov -tA -c \
  "SELECT schemacode, count(*) FROM eg_mdms_data WHERE tenantid='$TENANT' \
     AND schemacode LIKE 'RAINMAKER-PGR.Complaint%' GROUP BY schemacode;"
```

> Note: the empty `x-ref-schema` has been removed from these two schema definitions, so a fresh
> registration shouldn't hit the quirk at all — step 2 is a fallback for tenants registered before
> that change.
