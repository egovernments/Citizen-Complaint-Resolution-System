# Migration Guide — Complaint Type: 2‑level → configurable N‑level hierarchy (two‑master model)

> Migrates the old complaint classification — **two separate masters**
> `RAINMAKER-PGR.ServiceDefs` (leaf) + `RAINMAKER-PGR.ClassificationNode` (interior) —
> into the **single merged adjacency‑list master** `RAINMAKER-PGR.ComplaintHierarchy`
> (interior nodes AND leaf complaint types in one tree), driven by the unchanged
> `RAINMAKER-PGR.ComplaintHierarchyDefinition`.
>
> **This is a BREAKING, one‑way, lockstep change.** `ServiceDefs` is removed,
> `pgr-services` validates against `ComplaintHierarchy` leaf rows, and there is **no flat
> fallback** — every tenant must be migrated before backend cutover, or it has a hard
> outage. Rollback is via MDMS snapshot, not by deleting a record.
>
> **▶ Running the migration?** Use the proven step-by-step in
> **[operator-runbook.md](./operator-runbook-2level.md)** (one-command path + every gotcha hit in practice).
> This document is the design/reference rationale.
>
> See also: [feature overview](../../../features/complaint-hierarchy/README.md) ·
> [design](../../../features/complaint-hierarchy/design.md) ·
> [two‑master rework plan](../../../features/complaint-hierarchy/two-master-rework-plan.md) ·
> [pre‑flight dry‑run](../../../../local-setup/scripts/migration/complaint-hierarchy/preflight-dryrun.cjs).

---

## 1. The two models

### 1.1 Before — two masters (`ServiceDefs` + `ClassificationNode`)

Two MDMS schemas carried the classification:

**`RAINMAKER-PGR.ServiceDefs`** — the leaf (one record per sub‑type, stored on every complaint):
```
serviceCode (uid, leaf)  ·  name  ·  menuPath (the category code)  ·  menuPathName (category label)
department  ·  slaHours  ·  keywords  ·  order  ·  active
```

**`RAINMAKER-PGR.ClassificationNode`** — the **non‑leaf** levels only (adjacency list):
```
hierarchyType  ·  levelCode  ·  code (uid)  ·  parentCode|null  ·  name  ·  order  ·  active  ·  path
```

A leaf linked to its parent node via `parentCode ?? sector ?? menuPath`. Tenants that never
adopted the N‑level tree had **no** `ClassificationNode` rows at all — their 2 levels were purely
implicit in `ServiceDefs.menuPath`.

### 1.2 After — one merged master (`ComplaintHierarchy`)

**`RAINMAKER-PGR.ComplaintHierarchyDefinition`** — UNCHANGED. Declares the levels (the shape):
```
hierarchyType (uid)  ·  active  ·  levels[]:
   { levelCode, order, parentLevel|null, isFreeText, isLeafServiceCode, label }
```

**`RAINMAKER-PGR.ComplaintHierarchy`** — the ONE adjacency list holding **every** node:
```
hierarchyType  ·  levelCode  ·  code (uid within hierarchyType)  ·  parentCode|null  ·  name  ·  order  ·  active  ·  path
   + LEAF-ONLY (at the isLeafServiceCode level):  department  ·  departments[]  ·  slaHours  ·  keywords
```
- **Interior rows** = the old `ClassificationNode` rows, copied 1:1.
- **Leaf rows** = the old `ServiceDefs` records, folded in: `code = serviceCode` (verbatim),
  `parentCode` = the parent node code, plus `department`/`departments[]`/`slaHours`/`keywords`.
- A row is a **leaf** iff it carries `department` or `slaHours` (interior nodes omit them).
- `menuPath` / `menuPathName` are **gone** — grouping is derived from `parentCode` + the parent
  node's `name`.

**`ServiceDefs`, `ClassificationNode`, `HierarchySchema`, `ComplaintTypeDepartments` are all removed.**

### 1.3 Dual‑mode: PRESERVE an existing tree, or DERIVE a flat 2‑level one

The migration (button, script, and pre‑flight) is **dual‑mode**, matching `hierarchyMigration.ts`'s `linkOf`:

| Mode | Trigger | Behaviour |
|---|---|---|
| **PRESERVE** | A `ComplaintHierarchyDefinition` with `levels[]` **and** interior `ClassificationNode` rows already exist | Keep the definition + interior nodes verbatim. Each leaf links via its own `parentCode ?? sector ?? menuPath`. Full N‑level depth is retained. |
| **DERIVE** | No existing N‑level tree (legacy flat tenant) | Synthesise a flat 2‑level definition (`CATEGORY → SUB_TYPE`) and one `CATEGORY` interior node per distinct `menuPath` (`code = menuPath`), then fold the leaves under them. `menuPath` is read **here, at migration time only** — its last legitimate read. |

In both modes the leaf `code` is the old `serviceCode` **verbatim** and every node — interior and
leaf — ends up in the single `ComplaintHierarchy` master.

### 1.4 The one fact that makes the leaf move safe

- The leaf `code` **is** the old `serviceCode`, copied **byte‑for‑byte** (never re‑derived via
  `toPascal`/slug). So every already‑filed complaint (`eg_pgr_service_v2.servicecode`), every
  `EscalationConfig.overrides` key, and every localization key still resolves. **No complaint data
  is rewritten.**

---

## 2. Compatibility — what holds, what breaks

This is **not** the old additive/opt‑in/reversible model. The honest statement of invariants:

### What MUST hold (data safety)
1. **Verbatim leaf code.** Leaf `ComplaintHierarchy.code` == old `ServiceDefs.serviceCode`, exactly.
2. **Global uniqueness.** `(hierarchyType, code)` is unique across the **merged interior + leaf** keyspace. A leaf serviceCode that equals an interior node code, or two same‑named leaves under different parents, silently drops a row on x‑unique create.
3. **Completeness.** Every old `serviceCode` exists as exactly one leaf `code` after migration.
4. **Leaf fields carried.** Each leaf row has `department`/`slaHours` (and `keywords`, and `departments[]` where multi‑dept applied), so the leaf‑detection heuristic and backend routing work.
5. **Escalation keys.** `EscalationConfig.overrides` keys still equal the migrated leaf codes.

### What BREAKS for an un‑migrated tenant after cutover
- **No flat fallback.** With neither old nor new master populated, the citizen/employee picker
  renders `CS_NO_COMPLAINT_HIERARCHY` and **pgr-services throws `INVALID_SERVICECODE` on every
  create/update** — a hard outage. Every tenant MUST be migrated (city **and** state level) before
  the backend is cut over.
- **Not reversible by deletion.** Because the leaves were *moved* (not added alongside `ServiceDefs`),
  rollback requires the MDMS snapshot — see §8.

---

## 3. Two ways to run it

**Option A — one‑click button in the configurator (single tenant).**
On **Manage → Complaint Hierarchies** (`/configurator/manage/complaint-hierarchies`), the
**"Migrate from 2‑level"** action runs the masters migration: it reads the old masters
(`ServiceDefs`, `ClassificationNode`, `ComplaintHierarchyDefinition`, `ComplaintTypeDepartments`)
as a **read‑only source**, then creates the merged `ComplaintHierarchy` rows — interior nodes and
**leaf complaint types** (`code = serviceCode` verbatim, with `department`/`departments[]`/`slaHours`/
`keywords` + explicit `parentCode`). It targets the logged‑in tenant **and** the derived state root,
shows live per‑step status (read → definition → interior nodes → leaves → verify), and is idempotent
on `(hierarchyType, code)`. Its result/rollback banner reflects the **breaking, one‑way** nature.
Implemented in `configurator/src/resources/complaint-hierarchies/MigrateHierarchyAction.tsx` +
`configurator/src/api/services/hierarchyMigration.ts`.

**Option B — headless script (many tenants / CI).** Use the script in §5. Same data result.

---

## 4. Mechanical mapping (old masters → `ComplaintHierarchy`)

For a tenant `T`, `hierarchyType = "PGR"`:

**Definition** (1 record) — kept verbatim in PRESERVE mode; synthesised in DERIVE mode:
```json
{ "hierarchyType": "PGR", "active": true, "levels": [
  { "levelCode": "CATEGORY", "order": 1, "parentLevel": null,       "isFreeText": false, "isLeafServiceCode": false, "label": "Category" },
  { "levelCode": "SUB_TYPE", "order": 2, "parentLevel": "CATEGORY", "isFreeText": false, "isLeafServiceCode": true,  "label": "Sub-Type" }
] }
```

**Interior nodes** → `ComplaintHierarchy` rows (no `department`/`slaHours`):
```json
{ "hierarchyType": "PGR", "levelCode": "CATEGORY", "code": "<node code>",
  "parentCode": null, "name": "<name>", "order": <i>, "active": true, "path": "<code>" }
```
PRESERVE: the existing `ClassificationNode` rows, copied 1:1. DERIVE: one per distinct `menuPath`
(`code = menuPath`).

**Leaf rows** → `ComplaintHierarchy` rows at the `isLeafServiceCode` level (carrying the leaf fields):
```json
{ "hierarchyType": "PGR", "levelCode": "SUB_TYPE", "code": "<serviceCode VERBATIM>",
  "parentCode": "<parent node code>", "name": "<name>", "order": <i>, "active": true,
  "path": "<parent.path>.<code>",
  "department": "<primary dept>", "departments": ["<all depts>"], "slaHours": <n>, "keywords": "<csv>" }
```
- `code = ServiceDefs.serviceCode` — **verbatim, never re‑derived.**
- `parentCode` = `linkOf(leaf)` = `parentCode ?? sector ?? menuPath` in PRESERVE; `menuPath` (or
  `"Complaint"` for empty `menuPath`) in DERIVE — this is the **last legitimate read of `menuPath`**.
- `department` = the leaf's primary department; `departments[]` = the full list (from the old
  `ComplaintTypeDepartments` if present, else `[department]`) — this re‑expresses the removed
  multi‑department master inline.
- `slaHours`, `keywords`, `order`, `active` copied from the leaf; `path` derived from the parent chain.

> **`code = serviceCode` verbatim is non‑negotiable.** Re‑deriving the code (toPascal/slug) would
> orphan historical complaints, `EscalationConfig.overrides`, and localization keys.

---

## 5. Masters‑migration script (idempotent)

Run against the deployed stack via the MDMS v2 API, per tenant, at **both** the city tenant (where
the picker reads) **and** the state‑level tenant (where pgr-services validates). Idempotent on
`(hierarchyType, code)` — re‑runs skip duplicates.

```js
// node migrate-pgr-masters.cjs <tenantId> [hierarchyType=PGR]
// Folds RAINMAKER-PGR.ServiceDefs (leaf) + ClassificationNode (interior) -> RAINMAKER-PGR.ComplaintHierarchy.
const http = require("http");
const TENANT = process.argv[2];
const HT = process.argv[3] || "PGR";
const HOST = "localhost", PORT = 18000; // kong

const form = (p,d)=>new Promise(r=>{const q=http.request({host:HOST,port:PORT,path:p,method:"POST",headers:{authorization:"Basic ZWdvdi11c2VyLWNsaWVudDo=","content-type":"application/x-www-form-urlencoded","Content-Length":Buffer.byteLength(d)}},s=>{let b="";s.on("data",c=>b+=c);s.on("end",()=>r(b));});q.write(d);q.end();});
const post=(p,b)=>new Promise(r=>{const d=JSON.stringify(b);const q=http.request({host:HOST,port:PORT,path:p,method:"POST",headers:{"content-type":"application/json","Content-Length":Buffer.byteLength(d)}},s=>{let x="";s.on("data",c=>x+=c);s.on("end",()=>r({code:s.statusCode,body:x}));});q.write(d);q.end();});
const search=async(RI,schema)=>{const r=await post("/mdms-v2/v2/_search",{RequestInfo:RI,MdmsCriteria:{tenantId:TENANT,schemaCode:schema,limit:5000}});try{return (JSON.parse(r.body).mdms||[]).map(m=>m.data);}catch{return [];}};

(async()=>{
  // 1) auth (ADMIN on this tenant)
  const j = JSON.parse(await form("/user/oauth/token",
    `username=ADMIN&password=eGov%40123&userType=EMPLOYEE&tenantId=${TENANT}&scope=read&grant_type=password`));
  const u = j.UserRequest;
  const RI = { apiId:"Rainmaker", ver:"1.0", msgId:"migrate", authToken:j.access_token,
    userInfo:{ id:u.id, uuid:u.uuid, userName:u.userName, name:u.name, type:u.type, roles:u.roles, tenantId:u.tenantId } };

  // 2) read the SOURCE masters (read-only): ServiceDefs (leaf) + ClassificationNode (interior)
  //    + the existing Definition + ComplaintTypeDepartments (multi-dept).
  const defs  = await search(RI, "RAINMAKER-PGR.ServiceDefs");
  const nodes = await search(RI, "RAINMAKER-PGR.ClassificationNode");
  const hdef  = await search(RI, "RAINMAKER-PGR.ComplaintHierarchyDefinition");
  const cdept = await search(RI, "RAINMAKER-PGR.ComplaintTypeDepartments");
  if (!defs.length) { console.log("no ServiceDefs on",TENANT,"- nothing to migrate"); return; }

  // 3) multi-department list per serviceCode (Q1), from the removed ComplaintTypeDepartments master.
  const deptByCode = new Map();
  for (const r of cdept) {
    const sc = r.serviceCode; if (!sc) continue;
    deptByCode.set(sc, { departments: Array.isArray(r.departments)?r.departments.map(String):[], primary: r.primaryDepartment });
  }

  // 4) PRESERVE vs DERIVE: keep an existing N-level tree, else synthesise a flat 2-level one.
  const existingDef = hdef.find(d => d.hierarchyType === HT);
  const interiorNodes = nodes.filter(n => n.hierarchyType === HT);
  const preserve = !!existingDef && interiorNodes.length > 0;
  const linkOf = (d) => preserve
    ? (d.parentCode ?? d.sector ?? (String(d.menuPath||"").trim() || "Complaint"))
    : (String(d.menuPath||"").trim() || "Complaint");

  const create = async (schema, uid, data) => {
    const r = await post(`/mdms-v2/v2/_create/${schema}`,
      { RequestInfo:RI, Mdms:{ tenantId:TENANT, schemaCode:schema, uniqueIdentifier:uid, data, isActive:true }});
    return r.code; // 4xx on duplicate => idempotent skip
  };

  // 5) Definition: keep existing, else create a flat 2-level one.
  let levels = existingDef?.levels;
  if (!preserve) {
    levels = [
      { levelCode:"CATEGORY", order:1, parentLevel:null,       isFreeText:false, isLeafServiceCode:false, label:"Category" },
      { levelCode:"SUB_TYPE", order:2, parentLevel:"CATEGORY", isFreeText:false, isLeafServiceCode:true,  label:"Sub-Type" },
    ];
    await create("RAINMAKER-PGR.ComplaintHierarchyDefinition", HT, { hierarchyType:HT, active:true, levels });
  }
  const leafLevel = (levels.find(l => l.isLeafServiceCode) || levels[levels.length-1]).levelCode;

  // 6) interior nodes -> ComplaintHierarchy (PRESERVE: 1:1 copy; DERIVE: one CATEGORY per menuPath)
  let interior;
  if (preserve) {
    interior = interiorNodes.map(n => ({ levelCode:n.levelCode, code:n.code, parentCode:n.parentCode??null, name:n.name, order:n.order, path:n.path }));
  } else {
    const cats = new Map(); let i=0;
    for (const d of defs) { const mp = (String(d.menuPath||"").trim()) || "Complaint"; if (!cats.has(mp)) cats.set(mp, String(d.menuPathName||mp)); }
    interior = Array.from(cats.entries()).map(([code,name]) => ({ levelCode:"CATEGORY", code, parentCode:null, name, order:++i, path:code }));
  }
  for (const n of interior) {
    await create("RAINMAKER-PGR.ComplaintHierarchy", n.code,
      { hierarchyType:HT, levelCode:n.levelCode, code:n.code, parentCode:n.parentCode??null, name:n.name, order:n.order, active:true, path:n.path });
  }

  // 7) leaves -> ComplaintHierarchy leaf rows. code = serviceCode VERBATIM (Q8).
  const pathOf = new Map(interior.map(n => [n.code, n.path]));
  let li=0;
  for (const d of defs) {
    const parent = linkOf(d);
    const dep = deptByCode.get(d.serviceCode);
    const primary = dep?.primary || d.department;
    const all = dep?.departments?.length ? dep.departments : (primary ? [primary] : []);
    await create("RAINMAKER-PGR.ComplaintHierarchy", d.serviceCode, {
      hierarchyType:HT, levelCode:leafLevel, code:d.serviceCode, parentCode:parent,
      name:d.name, order:d.order ?? ++li, active:d.active !== false,
      path:`${pathOf.get(parent)||parent}.${d.serviceCode}`,
      department:primary, departments:all,
      slaHours: typeof d.slaHours==="number" ? d.slaHours : Number(d.slaHours)||undefined,
      keywords: d.keywords ? String(d.keywords) : undefined,
    });
  }
  console.log(`migrated ${TENANT} [${preserve?"PRESERVE":"DERIVE"}]: ${interior.length} interior + ${defs.length} leaf rows into ComplaintHierarchy`);
})();
```

After running (and **only after** backend cutover + verification), retire the old masters:
`active=false` / delete the `ServiceDefs` / `ClassificationNode` / `HierarchySchema` /
`ComplaintTypeDepartments` records.

---

## 6. Where to create the records (tenant scoping)

Create `ComplaintHierarchy` (and the Definition) at **both**:
- the **city tenant** — where the citizen/employee picker reads, and
- the **state‑level tenant** — where pgr-services validates (`MultiStateInstanceUtil.getStateLevelTenant`).

If you only populate the city tenant, the picker works but **every backend create/update fails
`INVALID_SERVICECODE`** because validation runs at the state level. The migrate button and script
both dual‑write.

---

## 7. Verification (per tenant)

1. `ComplaintHierarchyDefinition` count = 1; `ComplaintHierarchy` leaf‑row count = old `ServiceDefs` count; interior‑row count = (PRESERVE) old `ClassificationNode` count, or (DERIVE) distinct `menuPath` count.
2. **Uniqueness:** no `(hierarchyType, code)` collision across the merged interior + leaf keyspace.
3. **Verbatim codes:** every old `ServiceDefs.serviceCode` exists as a leaf `code`, unchanged.
4. **Leaf fields:** each leaf carries `department`/`slaHours` (and `departments[]`/`keywords`).
5. In the UI, the cascade shows the same options the flat picker did; grouping labels come from the parent node `name`.
6. File a test complaint → stored `serviceCode` unchanged → backend validates (no `INVALID_SERVICECODE`).
7. `EscalationConfig.overrides` keys still match leaf codes.
8. **Analytics:** the V2‑grain MV rebuilt against `ComplaintHierarchy` (see §9) — `service_group` populated from `parentCode`.
9. Re‑run `preflight-dryrun.cjs` → reports the tenant looks already migrated (idempotent no‑op) with 0 orphans.

Run the pre‑flight gate **before** writing:
```
BASE_URL=https://<gateway> TENANT=<tenant> OAUTH_USER=ADMIN OAUTH_PASS='***' \
  node local-setup/scripts/migration/complaint-hierarchy/preflight-dryrun.cjs
```
It writes nothing and asserts: schemas installed, dual‑mode detected, every category **and** leaf
code is MDMS‑safe, no leaf‑link orphans, and — critically — no `(hierarchyType, code)` collision in
the merged keyspace. **Proceed only on `SAFE TO MIGRATE` (exit 0).**

---

## 8. Lockstep upgrade runbook + rollback

Each step has a verification; the whole sequence is **ordered and lockstep** — partial deploys
cause outages.

**Step 0 — Snapshot (MANDATORY).** Export every tenant's `ServiceDefs` + `ClassificationNode` (+
`HierarchySchema`/`ComplaintTypeDepartments`) via MDMS `_search`, and take an MDMS DB snapshot.
**This is the rollback artifact** — the leaves are *moved*, so a delete cannot restore them.

**Step 1 — Register the `ComplaintHierarchy` schema.** Install the merged schema; apply the
`x-ref-schema [] → {}` jsonb quirk fix on create and verify with `jsonb_typeof` (per project memory:
`/schema/v1/_create` can persist `x-ref-schema` as `{}` → HTTP 400 `ClassCastException` on the first
data `_create`; schema `_update` is 501, so fix in‑place via `jsonb_set('{x-ref-schema}','[]')`).

**Step 2 — Run the masters migration for ALL tenants, at city AND state level.** Pre‑flight green
first. Verify uniqueness + verbatim‑code preservation (§7).

**Step 3 — Deploy pgr-services (validates against `ComplaintHierarchy`) + the V2‑grain MV.** See the
**flyway‑repair caveat** in §9. Restart pgr-services to reload the process‑lifetime
`serviceCodeToSlaCache`.

**Step 4 — Deploy all frontends + integrations together.** configurator + DIGIT‑UI esbuild +
digit‑ui‑v2 + micro‑ui (all read `ComplaintHierarchy`, drop `ServiceDefs`); update egov‑indexer
configs, xstate‑chatbot, digit‑mcp. **Clear the `useServiceDefs` SessionStorage cache**
(`cacheTime: Infinity`) on deploy or stale data masks the migration.

**Step 5 — Only now delete the old masters.** `ServiceDefs` / `HierarchySchema` /
`ComplaintTypeDepartments` records.

**Rollback** (the data migration + backend deploy are **not** independently reversible):
1. Redeploy the previous pgr-services jar/images.
2. **Restore `ServiceDefs` + `ClassificationNode` masters from the Step‑0 snapshot** (deleting the
   Definition + `ComplaintHierarchy` rows is **not** enough — the leaves must come back).
3. Revert the V2‑grain MV migration to its `ServiceDefs`/`menuPath` form (see §9).
4. Redeploy the previous frontend bundles.

---

## 9. The V2‑grain materialized‑view edit — flyway‑repair caveat

`backend/pgr-services/src/main/resources/db/migration/main/V20260608000000__create_v2_grain_mvs.sql`
builds an MDMS CTE that the analytics grain MV joins. It was **edited in place** to read the new
master:

```sql
mdms AS (   -- ComplaintHierarchy LEAF rows; dedupe by code preferring the root (shortest) tenant.
            -- service_group is the parent category code (menuPath was removed from masters).
  SELECT ...
         NULLIF(data->>'parentCode','')  AS service_group,   -- was: NULLIF(data->>'menuPath','')
         data->>'department'             AS department_code
  FROM   eg_mdms_data
  WHERE  schemacode = 'RAINMAKER-PGR.ComplaintHierarchy'      -- was: 'RAINMAKER-PGR.ServiceDefs'
         AND isactive
         AND data->>'department' IS NOT NULL                  -- leaf rows only (interior nodes carry no department)
)
```

> **CAVEAT — Flyway checksum.** A Flyway migration that has **already been applied** on an
> environment cannot be edited in place: changing the file body changes its checksum and the next
> `flyway migrate` **fails with a checksum mismatch**. On any environment where the original
> `V20260608000000` already ran (reading `ServiceDefs`/`menuPath`), you must EITHER:
>
> - run **`flyway repair`** to re‑baseline the stored checksum to the edited file (acceptable only
>   if the MV is recreated by a later step — note this migration uses `CREATE MATERIALIZED VIEW`,
>   so on a re‑applied checksum the body does **not** re‑execute; you must manually
>   `DROP MATERIALIZED VIEW … CASCADE` + re‑run the new body, or), preferably
> - ship a **new forward migration** (e.g. `V2026…__repoint_grain_mvs_to_complainthierarchy.sql`)
>   that `DROP`s and recreates the MV against `RAINMAKER-PGR.ComplaintHierarchy` leaf rows.
>
> On **fresh** environments (no prior `V20260608000000`) the edited file applies cleanly. The
> `service_group` dimension is now derived from `parentCode` (the parent category code), not the
> removed `menuPath`; confirm no BI/report consumer depends on the old `menuPath`‑valued
> `service_group` (rework‑plan §8 Q9). After cutover, `REFRESH MATERIALIZED VIEW` so the MV
> materializes the migrated `ComplaintHierarchy` state (it builds empty if run before the data
> migration).

---

## 10. Edge cases & gotchas

- **`ServiceDefs` without `menuPath`** → in DERIVE mode the leaf is bucketed under a `"Complaint"` interior node. In PRESERVE mode it uses its own `parentCode`/`sector`.
- **Merged‑keyspace collision** → a leaf `serviceCode` equal to an interior node `code` (or two same‑named leaves under different parents) collides on `(hierarchyType, code)` and silently drops a row. The pre‑flight asserts this explicitly. Resolve by re‑coding the interior node (data fix), never the leaf (leaf codes are sacrosanct).
- **Multi‑department** → folded into the leaf's `departments[]` (primary = `department`). Confirm no consumer relied on the standalone `ComplaintTypeDepartments` master before deletion.
- **Localization** → leaf labels render from `name`; intermediate labels move from `SERVICEDEFS.<MENUPATH>` keys to the node `name` / `<HIERARCHYTYPE>_<LEVELCODE>` keys.
- **Idempotency** → re‑running creates nothing new (duplicate uid → 4xx skip). Safe to re‑apply after any redeploy that wipes custom tenants.
- **Rollback** → restore old masters from the Step‑0 snapshot + redeploy old images + revert the V2‑MV (§8). **Not** a delete.
- **SLA cache** → restart pgr-services after migration; `serviceCodeToSlaCache` is process‑lifetime.
