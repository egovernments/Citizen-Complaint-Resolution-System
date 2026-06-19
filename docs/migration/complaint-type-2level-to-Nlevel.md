# Migration Guide — Complaint Type: 2‑level → configurable N‑level hierarchy

> Converts the existing **2‑level** complaint classification on `develop`
> (`menuPath → serviceCode`) into the **configurable N‑level** model on
> `feat/complaint-classification-hierarchy`
> (`ComplaintHierarchyDefinition` + `ClassificationNode` + leaf `ServiceDefs`).
>
> **It is additive, opt‑in per tenant, and reversible.** No ServiceDef data is
> rewritten; the backend is unchanged.

---

## 1. The two models

### 1.1 `develop` — 2 levels (today)
Only one MDMS schema carries the classification: **`RAINMAKER-PGR.ServiceDefs`**
```
serviceCode (uid, leaf)  ·  name  ·  menuPath (the "category")  ·  menuPathName (category label)
department  ·  slaHours  ·  keywords  ·  order  ·  active
```
The UI builds the 2 levels **at render time** by grouping on `menuPath`:
- **Level 1 (category)** = distinct `menuPath` values (label = `menuPathName`)
- **Level 2 (sub‑type, leaf)** = the `ServiceDefs` under each `menuPath`

There is **no** definition record and **no** node record — the tree is implicit in `menuPath`.

### 1.2 This branch — configurable N levels (target)
Three schemas:

**`RAINMAKER-PGR.ComplaintHierarchyDefinition`** — declares the levels (the "how many levels")
```
hierarchyType (uid)  ·  active  ·  levels[]:
   { levelCode, order, parentLevel|null, isFreeText, isLeafServiceCode, label }
```

**`RAINMAKER-PGR.ClassificationNode`** — the non‑leaf level values (adjacency list)
```
hierarchyType  ·  levelCode  ·  code (uid)  ·  parentCode|null  ·  name  ·  order  ·  active  ·  path
```

**`RAINMAKER-PGR.ServiceDefs`** — **the leaf, unchanged required fields** + new *optional*
fields `hierarchyType / authorityType / category / sector / path / parentCode`.
The leaf links to its parent node via `parentCode ?? sector ?? menuPath == <parent node code>`.

### 1.3 The one fact that makes migration trivial
- `ServiceDefs` **required** fields are identical on both branches → **existing records already validate** against the new schema.
- The leaf→category link **already exists** as `menuPath`. If we create one
  `ClassificationNode` per distinct `menuPath` with **`code = menuPath`**, then the
  existing `ServiceDefs.menuPath` already points at it — **no ServiceDef rewrite needed.**

So the mechanical migration = "2 levels" → "2 levels expressed as a hierarchy":
```
Level 1  CATEGORY   (ClassificationNode, one per distinct menuPath)
Level 2  SUB_TYPE   (existing ServiceDefs, leaf — unchanged)
```

---

## 2. Compatibility invariants (why this is safe)
1. **Opt‑in per tenant.** Every UI surface falls back to the legacy flat
   `menuPath` grouping when a tenant has **no** `ComplaintHierarchyDefinition`.
   A tenant works *before* migration (flat) and *after* (cascade).
2. **ServiceDefs unchanged.** Same required fields; the migration adds *records*
   (Definition, Nodes), not columns. Old records stay valid; the only optional
   touch is setting `parentCode` (skippable).
3. **Backend untouched.** `pgr-services` still validates `serviceCode` against
   `ServiceDefs` at the state tenant. No protocol/route change.
4. **Reversible.** Delete the Definition + Nodes → the tenant reverts to flat.

---

## 2a. Two ways to run it

**Option A — one-click button in the configurator (recommended for a single tenant).**
On **Manage → Complaint Hierarchies** (`/configurator/manage/complaint-hierarchies`), when the
logged-in tenant has **no** hierarchy definition yet, a **"Migrate from 2-level"** button appears
next to *Create*. Clicking it opens a popup that runs the exact steps in §4 and shows each step's
live status (read types → detect categories → create definition → create nodes → verify → refresh).
On success the list refetches, a definition now exists, and **the button hides itself**. It targets
the tenant you are logged into (shown in the popup) and the derived state-root; it is idempotent and
reversible. Implemented in `src/resources/complaint-hierarchies/MigrateHierarchyAction.tsx` +
`src/api/services/hierarchyMigration.ts`.

**Option B — headless script (for many tenants / CI).** Use the script in §5 against the MDMS v2
API. Same data result; scriptable across a tenant list.

---

## 2b. Production runbook — migrate with zero errors

Migration is **two independent, individually reversible steps**. Do them in order; each
has its own verification and rollback, so no single action can break the running system.

> **Mental model:** Step 1 deploys code that *can* do hierarchies but changes nothing until
> data exists (opt-in fallback). Step 2 adds data. Existing complaint types are never rewritten.

**Step 0 — Backup.** Export the tenant's `ServiceDefs` (MDMS `_search` → save JSON) and take
your normal MDMS DB snapshot. The migration writes only *new* records, so this is insurance, not
strictly required.

**Step 1 — Deploy the branch (code + schemas), verify NO behaviour change.**
- Install/registry-update the MDMS schemas `RAINMAKER-PGR.ComplaintHierarchyDefinition`,
  `RAINMAKER-PGR.ClassificationNode`, and the additive `RAINMAKER-PGR.ServiceDefs` (required
  fields unchanged → existing records stay valid). Watch for the schema-create `[]→{}` quirk
  (see the project memory / DB fix) on `x-ref` schemas.
- Deploy the branch `digit-ui` + `configurator`.
- **Verify the tenant is untouched:** with no `ComplaintHierarchyDefinition` yet, the citizen and
  employee complaint pickers must still render the **flat** Type→Sub-type list exactly as before.
  File one test complaint to confirm. This proves the deploy is non-breaking *before* any data move.
- Rollback for this step = redeploy previous images. No data was touched.

**Step 2 — Pre-flight (read-only gate). MANDATORY.**
```
BASE_URL=https://<bomet-gateway> TENANT=<bomet-tenant> \
  OAUTH_USER=ADMIN OAUTH_PASS='***' node docs/migration/preflight-dryrun.cjs
```
Writes nothing. It confirms: schemas installed, serviceCodes unique, every `menuPath` is a
**code-safe** node id, no orphan leaves, and prints the exact plan (1 definition + N nodes).
**Only proceed if it prints `SAFE TO MIGRATE` (exit 0).** If it flags unsafe `menuPath` values
(spaces/special chars), fix those values on the ServiceDefs first (or use the slug strategy in §9),
then re-run.

**Step 3 — Migrate (idempotent).** Either:
- **One click:** in the configurator, open *Manage → Complaint Hierarchies* on the Bomet tenant
  and click **Migrate from 2-level** (§2a). Watch the live step status.
- **Headless:** run the script in §5 against the same tenant.

Create the definition + nodes on the **city tenant** (where the picker reads) and the **state root**
(dual-write, non-fatal if it fails). ServiceDefs are not rewritten.

**Step 4 — Verify (§7).** Cascade shows the same options as the old flat list; a test complaint
stores the **same `serviceCode`**; backend validates (no `INVALID_SERVICECODE`); pre-flight re-run
reports 0 orphans.

**Step 5 — Rollback (instant, if anything looks off).** Delete the tenant's
`ComplaintHierarchyDefinition` + `ClassificationNode` records → the UI reverts to the flat picker on
next load. ServiceDefs are untouched, so complaints already filed are unaffected.

**Why this is zero-error:** additive schema (no required-field change) + opt-in fallback (deploy
changes nothing until data exists) + read-only pre-flight (catches every error source before a
write) + idempotent create (safe re-runs) + delete-to-revert (no data rewritten).

---

## 3. Migration strategy (phases)

**Phase 0 — Deploy the branch (no data change).**
Ship schemas + frontends. With no Definition seeded, **all tenants stay on the
flat picker.** This proves the deploy is non‑breaking before touching any data.

**Phase 1 — Migrate one pilot tenant.**
Run the migration (§5) for a single tenant (e.g. `pg.citya`). Verify the cascade
renders the same Category → Sub‑Type the flat picker showed. Roll back if needed.

**Phase 2 — Roll out per tenant.**
Repeat for each tenant. Migration is idempotent, so re‑runs are safe.

**Phase 3 (optional) — Enrich to true N levels.**
Insert higher levels (Authority Type, Sector, …) — a *data* exercise, not part of
the mechanical migration. See §8.

---

## 4. Mechanical mapping (2‑level → hierarchy form)

For a tenant `T`, `hierarchyType = "PGR"`:

**Definition** (1 record)
```json
{ "hierarchyType": "PGR", "active": true, "levels": [
  { "levelCode": "CATEGORY", "order": 1, "parentLevel": null,       "isFreeText": false, "isLeafServiceCode": false, "label": "Category" },
  { "levelCode": "SUB_TYPE", "order": 2, "parentLevel": "CATEGORY", "isFreeText": false, "isLeafServiceCode": true,  "label": "Sub-Type" }
] }
```

**Nodes** (one per distinct `menuPath`)
```json
{ "hierarchyType": "PGR", "levelCode": "CATEGORY", "code": "<menuPath>",
  "parentCode": null, "name": "<menuPathName | menuPath>", "order": <i>, "active": true, "path": "<menuPath>" }
```

**Leaves** = existing `ServiceDefs`, **unchanged** (their `menuPath` already equals the node `code`).
*(Optional, for explicitness: set `ServiceDefs.parentCode = menuPath`. Not required — the picker falls back to `menuPath`.)*

> Why `code = menuPath` (raw, not slugged): it keeps `ServiceDefs.menuPath`
> matching the node code with **zero ServiceDef writes**. Only slug the code if a
> `menuPath` contains characters MDMS uniqueIdentifier rejects — and then you must
> also update `ServiceDefs.menuPath` to the slug.

---

## 5. Migration script (idempotent)

Run against the deployed stack via the MDMS v2 API. Reads `ServiceDefs`, derives
categories, creates the Definition + Nodes. Safe to re‑run (duplicates are skipped).

```js
// node migrate-pgr-hierarchy.cjs <tenantId> [hierarchyType=PGR]
const http = require("http");
const TENANT = process.argv[2];
const HT = process.argv[3] || "PGR";
const HOST = "localhost", PORT = 18000; // kong

const form = (p,d)=>new Promise(r=>{const q=http.request({host:HOST,port:PORT,path:p,method:"POST",headers:{authorization:"Basic ZWdvdi11c2VyLWNsaWVudDo=","content-type":"application/x-www-form-urlencoded","Content-Length":Buffer.byteLength(d)}},s=>{let b="";s.on("data",c=>b+=c);s.on("end",()=>r(b));});q.write(d);q.end();});
const post=(p,b)=>new Promise(r=>{const d=JSON.stringify(b);const q=http.request({host:HOST,port:PORT,path:p,method:"POST",headers:{"content-type":"application/json","Content-Length":Buffer.byteLength(d)}},s=>{let x="";s.on("data",c=>x+=c);s.on("end",()=>r({code:s.statusCode,body:x}));});q.write(d);q.end();});

(async()=>{
  // 1) auth (use an ADMIN on this tenant)
  const j = JSON.parse(await form("/user/oauth/token",
    `username=ADMIN&password=eGov%40123&userType=EMPLOYEE&tenantId=${TENANT}&scope=read&grant_type=password`));
  const u = j.UserRequest;
  const RI = { apiId:"Rainmaker", ver:"1.0", msgId:"migrate", authToken:j.access_token,
    userInfo:{ id:u.id, uuid:u.uuid, userName:u.userName, name:u.name, type:u.type, roles:u.roles, tenantId:u.tenantId } };

  // 2) read existing ServiceDefs (the 2-level data)
  const sr = await post("/mdms-v2/v2/_search",{ RequestInfo:RI,
    MdmsCriteria:{ tenantId:TENANT, schemaCode:"RAINMAKER-PGR.ServiceDefs", limit:1000 }});
  const defs = (JSON.parse(sr.body).mdms||[]).map(m=>m.data);
  if (!defs.length) { console.log("no ServiceDefs on",TENANT,"- nothing to migrate"); return; }

  // 3) derive distinct categories from menuPath
  const cats = new Map(); // menuPath -> name
  for (const d of defs) {
    const mp = (d.menuPath||"").trim() || "Uncategorized";
    if (!cats.has(mp)) cats.set(mp, (d.menuPathName||mp));
  }

  const create = async (schema, uid, data) => {
    const r = await post(`/mdms-v2/v2/_create/${schema}`,
      { RequestInfo:RI, Mdms:{ tenantId:TENANT, schemaCode:schema, uniqueIdentifier:uid, data, isActive:true }});
    return r.code; // 4xx on duplicate => idempotent skip
  };

  // 4) definition (2 levels)
  await create("RAINMAKER-PGR.ComplaintHierarchyDefinition", HT, { hierarchyType:HT, active:true, levels:[
    { levelCode:"CATEGORY", order:1, parentLevel:null,       isFreeText:false, isLeafServiceCode:false, label:"Category" },
    { levelCode:"SUB_TYPE", order:2, parentLevel:"CATEGORY", isFreeText:false, isLeafServiceCode:true,  label:"Sub-Type" },
  ]});

  // 5) one CATEGORY node per distinct menuPath (code = menuPath -> leaf.menuPath already matches)
  let i=0;
  for (const [mp,name] of cats) {
    await create("RAINMAKER-PGR.ClassificationNode", mp,
      { hierarchyType:HT, levelCode:"CATEGORY", code:mp, parentCode:null, name, order:++i, active:true, path:mp });
  }
  console.log(`migrated ${TENANT}: 1 definition + ${cats.size} category nodes (${defs.length} leaves reused)`);
})();
```

Run for the tenant(s) that hold the ServiceDefs (often both the **city** tenant —
where the picker reads — and the **state** tenant — where the backend validates).
If your tenants store ServiceDefs only at one level, run there.

---

## 6. Where to create the records (tenant scoping)
- The citizen/employee picker reads `ComplaintHierarchyDefinition` + `ClassificationNode`
  at the **tenant it files complaints under** (city tenant). Create them **there**.
- `ServiceDefs` already live wherever the flat flow read them; reuse as‑is.
- If you dual‑write ServiceDefs (city + state), also create the Definition + Nodes
  at both, so both the citizen UI (city) and any state‑level reads resolve.

---

## 7. Verification (per tenant)
1. `ComplaintHierarchyDefinition` count = 1; `ClassificationNode` count = distinct `menuPath` count.
2. In the UI, Category → Sub‑Type cascade shows **the same options** the flat picker did.
3. File a test complaint → stored `serviceCode` unchanged → backend validates (no `INVALID_SERVICECODE`).
4. A non‑migrated tenant still shows the **flat** picker (fallback intact).

---

## 8. (Optional) Enrich 2 → true N levels later
The mechanical migration gives you 2 levels in hierarchy form. To add real upper
levels (e.g. `AUTHORITY_TYPE → MAIN_CATEGORY → SECTOR → SUB_TYPE`):
1. Extend the Definition `levels[]` (insert the new levels, set `parentLevel` chain).
2. Add `ClassificationNode`s for the new levels and **re‑parent** the existing
   category nodes (set their `parentCode` to the new sector/category node).
3. Use **parent‑scoped node codes** at this point (e.g. `Ige_Complaint_Health`) so the
   same label under different parents stays unique on `(hierarchyType, code)`.
4. Update leaf `ServiceDefs.menuPath` (or `parentCode`) to the new immediate parent code.
This is per‑tenant data work, not a mechanical step.

---

## 9. Edge cases & gotchas
- **ServiceDefs without `menuPath`** → bucketed under an `"Uncategorized"` node by the script.
- **`menuPath` with MDMS‑illegal chars** → slug the node `code` AND update `ServiceDefs.menuPath` to match (otherwise the leaf won't link).
- **Localization** — node labels render from `name`; if you rely on i18n keys, seed
  `SERVICEDEFS_<CODE>` (note the underscore‑vs‑dot drift, issue #539 — emit one form consistently).
- **Idempotency** — re‑running creates nothing new (duplicate uid → 4xx skip). Safe.
- **Rollback** — delete the `ComplaintHierarchyDefinition` + `ClassificationNode`
  records for the tenant → it reverts to the flat picker. ServiceDefs untouched.
- **Don't make the new ServiceDefs fields required** — keep them optional so
  un‑migrated tenants' records stay valid.
