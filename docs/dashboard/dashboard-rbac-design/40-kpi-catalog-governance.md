# Part D — KPI Catalog, Definitions & Inline Gating

**Status:** v2 (pass-1 findings folded), 2026-06-23 · **Maps to:** plan §Phase 4 + design §3/§3a/§5a-Layer 2 · **Part graph:** A → D → E (00-requirements §8)
**Reads first:** `00-requirements.md` (§1 problem, §3 Layer 2, §5 ownership split, §6 NFRs, §7 hazards), `dashboard-query-api-design.md` §3 (KPI-def schema), §3a (publish pipeline), §5a (Layer 2), §10 (`/_schema`), `rbac-kpi-access-implementation-plan.md` §Phase 4.
**Grounding rule:** every "today" claim is anchored to a file:line that was read. Where a thing is missing it is stated as missing with the anchor showing the gap. Java anchors are the CCRS vendored tree: `CCRS/backend/pgr-services/src/main/java/org/egov/pgr/...`.

---

## Goal & responsibilities

This part owns **Layer 2 — KPI catalog access** of the three-layer model (00-requirements §3): *which questions a caller may ask at all*. Concretely it owns:

1. **KPI definitions as governed MDMS config** — the `dss.KpiDefinition` schemacode (frozen query body + viz + declared params + `rbac.visibleTo` + optional `rbac.requiresAttributes`), replacing the FE-hardcoded catalog (`frontend/micro-ui/web/src/dashboard/config/kpiQueries.js`, 00-requirements §1).
2. **`kpiId` resolution + materialization** — load a stored def, validate supplied runtime params against the def's `allowed` lists, materialize the frozen `query` body into the node the planner already consumes (`AnalyticsPlanner.plan(JsonNode, scope)`, `AnalyticsPlanner.java:37`).
3. **Discovery endpoint** — `POST /v2/analytics/catalog/_search` (DIGIT `_search` idiom — see M1), returning only defs where `visibleTo ∩ caller.roles ≠ ∅`.
4. **Invocation re-check** — on every `POST /_query` carrying a `kpiId`, re-check `visibleTo` (and `requiresAttributes`) **before planning** → `403 kpi_forbidden`. This re-check is the security boundary; discovery filtering is UX only (design §5a, "this re-check is the whole ballgame").
5. **Inline-query gate** — the role check that decides whether a body carrying inline `measures`/`dimensions`/`filters` (vs a `kpiId`) is even allowed (`403 inline_forbidden`). *Authored here because the gate's location is the same parse step that branches `kpiId`-vs-inline; logically it is Layer 3 / Part F, and Part F owns its semantics. This part installs the branch point — at **every** execution arm (see D.3 / B1 fix) — and the simplest gate; Part F refines the role policy.*
6. **The publish-time safety pipeline** (design §3a) — validate-against-catalog → bounded dry-run → cost estimate → PII/officer approval gate → immutable versioned publish.

**What this part explicitly does NOT own:**
- **Row scope (Layer 1).** *Which rows* come back is Parts B (attribute resolution) + C (`AnalyticsScope`/`applyScope`). This part decides *if you may invoke*; it never widens or narrows the injected `WHERE`. `visibleTo` is the **security ceiling**, never affected by row scope being empty (design §5a).
- **The trustworthy principal (Layer-0).** Part A. Everything here reads `{roles}` off the principal; if A hasn't landed, `visibleTo` is enforced against spoofable roles and is theater (00-requirements §7.1). **D hard-depends on A.**
- **HRMS attribute resolution.** `requiresAttributes` *consumes* the resolved `{boundaryPrefixes, departmentCodes}` from Part B; it does not resolve them.
- **Dashboard packs** (`dss.DashboardPack`, role → tile bundle). Part E. This part only guarantees the per-def ceiling that packs re-check at invocation.
- **The query grammar / planner SQL.** Unchanged (design says "no grammar change"). A materialized KPI def is *exactly* a `query` JsonNode the existing planner already accepts.
- **Caching.** NFR (00-requirements §6); cache key must include `{kpiId|queryBody, params, resolved scope, asOf}` but the cache layer itself is cross-cutting, not owned here. This part only fixes the cache-key *inputs* it produces (`kpiId`, `kpiVersion`, resolved params).

---

## Current code reality (file:line — what exists vs what's missing)

| Capability this part needs | State today | Anchor |
|---|---|---|
| `POST /_query` entry | exists, takes raw `JsonNode body` | `AnalyticsController.java:40-41` (mapping), body→`service.query` `:47` |
| `POST /_schema` (capabilities) | exists, no auth, no role filter | `AnalyticsController.java:57-60`; `AnalyticsService.schema()` `AnalyticsService.java:72-94` |
| `kpiId` handling | **MISSING** — `query(...)` only branches `queries` (batch) vs `query` (single); no `kpiId` read anywhere | `AnalyticsService.java:38-54` |
| **Two execution arms (both unguarded)** | batch dict arm loops + calls `runOne` per entry; single arm calls `runOne` once — **neither** branches `kpiId` or gates inline | batch arm `AnalyticsService.java:38-49` (loop body `:42-47`); single arm `:50-51` |
| Stored KPI defs in MDMS | **MISSING** — no `dss.KpiDefinition` schema, no loader | — (plan §0: "no saved KPI defs in MDMS yet") |
| `catalog` discovery | **MISSING** | no mapping in `AnalyticsController` |
| `visibleTo` invocation re-check | **MISSING** | — |
| Inline-vs-saved branch | **MISSING** — every body (single AND batch) is treated as inline; planner runs directly | `AnalyticsService.runOne()` `AnalyticsService.java:58-69` calls `planner.plan(q, scope)` straight; reached from both `:45` and `:51` |
| Inline role gate | **MISSING** | — |
| Roles available on principal | present but **spoofable** — read from body `userInfo` | `AnalyticsScope.resolve()` `AnalyticsScope.java:31-48`; `AnalyticsController.java:43-44` |
| **`AnalyticsScope` discards roles** | keeps only `tenantId`/`tenantStateLevel`/`citizenUuid`/`boundaryPrefix`; roles read at `:38-42` are used then dropped, never surfaced | `AnalyticsScope.java:21-28,38-44` |
| The served whitelist a def validates against | exists (the publish pipeline step-1 target) | `AnalyticsCatalog.java:50-113` (per-grain `groupable`/`filterable`/`measurable`/`distinctable` sets) |
| MDMS client in pgr-services | exists but **v1** (`MdmsCriteria`, `mdmsHost`) — needs a v2 `/v2/_search` path for schemacode reads | `MDMSUtils.java:8-9,103-118`; `PGRConfiguration.java:125` (`mdmsHost`) |
| AGG/op whitelist for pipeline validation | exists as a static set + per-grain sets | `AnalyticsCatalog.AGG_FNS` `AnalyticsCatalog.java:115-116` |
| Row cap | only a hard global `MAX_LIMIT=1000`; no per-grain budget | `AnalyticsPlanner.java:24` (defined), `:110-111` (applied) |

**Two reality gaps that shape the design:**

1. **The catalog is coarser than the design's `/_schema` (§10).** The shipped `Grain` (`AnalyticsCatalog.java:25-48`) carries `groupable`/`filterable`/`measurable`/`distinctable` **sets of column names** — it does *not* carry the per-column operation-set objects (`returnable`, `sortable`, `roleAllowed`, `minGroupSize`, `pii`) the design's §10 publish pipeline references. So the §3a step-1 "operation-level checks" and step-4 "PII/officer approval gate" have **no field to read today**. This part must either (a) extend `Grain` with these per-column attributes, or (b) keep the approval gate as out-of-band metadata on the def. We pick (a)-lite: add the minimum (`officerColumns`/`citizenColumns` sets) needed to make the PII gate real, and treat the rest as deferred (see Open Questions).

2. **`AnalyticsService.schema()` and the design's §10 catalog diverge.** Shipped `filterOps` (`AnalyticsService.java:75`) lists `eq,ne,gt,gte,lt,lte,in,isnull`; the planner actually implements exactly those in its op switch (`AnalyticsPlanner.java:182-197`). The design §10 lists `eq,in,nin,range,null`. The publish pipeline must validate against the **shipped** op-set the planner emits, not the design's aspirational one, or valid defs will be rejected (or invalid ones pass). **The pipeline's whitelist source of truth is `AnalyticsCatalog` + `AnalyticsPlanner`'s actual switch, never the prose.**

---

## Design

### D.1 Data model — `dss.KpiDefinition` MDMS schemacode

Registered via the standard MDMS v2 schema-create flow (`mdms_schema_create`, `digit-mcp/docs/api/tools/mdms_schema_create.md:1-99`) at the **state-level root** tenant (e.g. `ke`), city tenants inherit. The JSON-Schema definition (same convention as the shipped `ProviderDetail.json:1-42`: `type`/`properties`/`required`/`x-unique`/`x-security`):

```jsonc
// mdms v2 schema definition body for schemaCode = "dss.KpiDefinition"
{
  "type": "object",
  "title": "KpiDefinition",
  "description": "A governed, versioned KPI template for the PGR analytics query API.",
  "properties": {
    "id":          { "type": "string", "description": "stable KPI id, e.g. sla_compliance_rate" },
    "version":     { "type": "integer", "minimum": 1 },
    "status":      { "type": "string", "enum": ["draft","published","archived"] },
    "title":       { "type": "string", "description": "localization code" },
    "description": { "type": "string" },
    "grain":       { "type": "string", "enum": ["facts","events","daily"],
                     "description": "REQUIRED — explicit target grain; inferGrain never resolves daily (see m2)" },
    "query":       { "type": "object", "description": "frozen query body (design §2 grammar), no runtime params; MUST carry the same explicit grain" },
    "defaultTimeRole":  { "type": "string" },
    "allowedTimeRoles": { "type": "array", "items": { "type": "string" } },
    "params":      { "type": "object", "description": "declared runtime params + defaults + allowed values; each param fixes its target COLUMN (def-fixed), caller supplies only the bound VALUE (see m1)" },
    "viz":         { "type": "object" },
    "freshness":   { "type": "string", "enum": ["hourly","daily","weekly","monthly"] },
    "rbac": {
      "type": "object",
      "properties": {
        "visibleTo":          { "type": "array", "items": { "type": "string" }, "description": "role codes — the security ceiling" },
        "requiresAttributes": { "type": "array", "items": { "type": "string" },
                                "description": "e.g. [\"department\"] — caller must carry a resolved value for each (Part B), AND the target grain must be able to scope it (see D→B note)" }
      },
      "required": ["visibleTo"]
    },
    "approval": {
      "type": "object",
      "description": "publish-pipeline audit record (design §3a step 5)",
      "properties": {
        "approvedBy": { "type": "string" }, "approvedAt": { "type": "integer" },
        "officerDimApproved": { "type": "boolean" }, "estRows": { "type": "integer" }, "estCost": { "type": "number" }
      }
    }
  },
  "required": ["id","version","status","grain","query","rbac"],
  "x-unique": ["id","version"]            // (id,version) composite-key UNIQUE only (not immutable — immutability is a pipeline invariant, D.5 step 5); "latest published" resolved at read
}
```

Notes grounded in MDMS reality:
- `x-unique: ["id","version"]` enforces only that the **composite key `(id,version)` is unique** — `CompositeUniqueIdentifierGenerationUtil.getUniqueIdentifier` (`CompositeUniqueIdentifierGenerationUtil.java:23-44`) concatenates the x-unique field values into one identifier at *create* time; it does **NOT** make a published record immutable. MDMS v2 exposes `_update/{schemaCode}` (`MDMSControllerV2.java:56-59` → `MDMSServiceV2.update()` `MDMSServiceV2.java:99-114`) which mutates an existing `(id,version)` record in place. So `x-unique` alone does **not** give the design's **immutable versioned publish** (§3a step 5). Immutability is achieved **explicitly by the publish pipeline** (D.5 step 5): the `version` field is part of the composite key, each publish writes a *new* `(id,version)` record, the pipeline **never issues `_update` against a prior published version**, and supersession is a forward-only status transition (`published`→`archived` on the old version + a new `published` record) — not a mutation. The x-unique constraint only backstops this by rejecting an accidental duplicate `(id,version)` create; it is a uniqueness guard, not an immutability guard.
- `grain` is **required at the top level and must equal `query.grain`**. The planner's `inferGrain` only ever returns `events` or `facts`, **never `daily`** (`AnalyticsPlanner.java:267-275`), so an implicit-grain daily def would silently run on `facts` with wrong semantics (m2). The publish pipeline rejects any def whose `query` omits an explicit `grain` or whose `grain` ≠ `query.grain`.
- `status:"draft"` records exist in MDMS but are filtered out of the served catalog except for their author (design §3a). MDMS has no native "draft visibility" — that filter is **service-side** (D.4), keyed on the def's `auditDetails.createdBy` (MDMS v2 stamps it on write; confirm read path in D.2).
- The schema lives at the **state root**; per-tenant overrides are separate `dss.KpiDefinition` records at the city tenant. **MDMS v2 search does NOT merge across tenant levels** — `MDMSServiceV2.search()` iterates the fallback tenant list and `break`s on the **first non-empty** result (`MDMSServiceV2.java:83-89`), so a single city-local record would suppress *all* root defs, not augment them. Therefore defs are resolved by the store issuing **two explicit reads** — once at the city tenant, once at the state root (via `getStateLevelTenant(tenantId)`, `MDMSUtils.java:91`) — and merging in-process (city record wins per `id`). The design must not lean on an automatic platform merge that does not exist (D.2).

### D.2 Loader — `KpiDefinitionStore`

New class `org.egov.pgr.analytics.KpiDefinitionStore`. Reads `dss.KpiDefinition` via MDMS **v2** `/v2/_search` (the shipped `MDMSUtils` is v1 `MdmsCriteria` — `MDMSUtils.java:103-118` — so this is a net-new v2 search path; reuse `PGRConfiguration.mdmsHost` `PGRConfiguration.java:125`). Short-TTL in-process cache keyed by `{tenantId}` (defs are admin-edited rarely; the publish pipeline busts on write).

```java
public final class KpiDefinitionStore {
  /** All published defs (latest version per id) visible at this tenant. NOTE: MDMS v2 search is
   *  first-hit, not merge (MDMSServiceV2.java:83-89 breaks on the first non-empty fallback tenant),
   *  so a city-local def set would SUPPRESS the root set. The store therefore issues an EXPLICIT
   *  read at the city tenant AND at the state root and merges them itself (city overrides root per id). */
  List<KpiDef> publishedFor(String tenantId);
  /** One def by id; version=null => latest published. Throws kpi_not_found / kpi_version_not_found. */
  KpiDef load(String tenantId, String kpiId, Integer version);
}
public final class KpiDef {
  String id; int version; String status; String grain; JsonNode query;  // grain explicit; query is the frozen body
  Map<String,Param> params; String defaultTimeRole; List<String> allowedTimeRoles;
  JsonNode viz; String freshness; String createdBy;                       // createdBy for draft-author filter (D.4)
  List<String> visibleTo; List<String> requiresAttributes;               // rbac
}
```

The loaded `query` JsonNode is **structurally identical** to what `AnalyticsPlanner.plan` already accepts (`AnalyticsPlanner.java:37-116`) — that is the whole point of "a KPI def is a frozen query body": no planner change.

### D.3 Control flow — single point of entry for BOTH arms (`runEntry`) + `kpiId` re-check + inline gate

**Critical (B1 fix):** `AnalyticsService.query(...)` has **two** execution arms today — the batch-dict arm (`AnalyticsService.java:38-49`, loop calling `runOne(e.getValue(), scope)` at `:45`) **and** the single arm (`:50-51`, `runOne(body.get("query"), scope)`). Both reach `runOne` (`:58-69`) → `planner.plan(q, scope)` directly. **The new pre-flight `runEntry` MUST be the only path to `runOne` for both arms.** Wiring only the single arm leaves the batch arm as a gate bypass: a caller submits `{"queries":{"x":{...inline measures...}}}` and the inline gate and `kpiId` re-check never run (the original leak). The revised `query()`:

```java
public Map<String,Object> query(JsonNode body, RequestInfo requestInfo, String tenantId, int stateLevelLen){
  if (tenantId == null || tenantId.isEmpty()) throw new IllegalArgumentException("invalid_param: tenantId is required");
  AnalyticsScope scope   = AnalyticsScope.resolve(requestInfo, tenantId, stateLevelLen); // Part C row scope
  Principal      princ   = Principal.of(requestInfo, scope);            // roles/type/canInline + tenant guard (see below)

  Map<String,Object> out = new LinkedHashMap<>();
  out.put("asOf", asOf()); out.put("scope", scopeInfo(scope));

  if (body.has("queries") && body.get("queries").isObject()) {          // batch arm — MUST go through runEntry
    Map<String,Object> results = new LinkedHashMap<>(); boolean partial = false;
    Iterator<Map.Entry<String,JsonNode>> it = body.get("queries").fields();
    while (it.hasNext()) { Map.Entry<String,JsonNode> e = it.next();
      try { results.put(e.getKey(), runEntry(e.getValue(), scope, princ)); }   // ← was runOne(...) at :45
      catch (Exception ex) { partial = true; results.put(e.getKey(), err(ex)); } }
    out.put("results", results); out.put("partial", partial);
  } else if (body.has("query")) {
    out.putAll(runEntry(body.get("query"), scope, princ));              // ← was runOne(...) at :51
  } else throw new IllegalArgumentException("invalid_param: body must contain 'query' or 'queries'");
  return out;
}
```

```java
// AnalyticsService — the single gated pre-flight; reached from BOTH arms
private Map<String,Object> runEntry(JsonNode q, AnalyticsScope scope, Principal principal){
  if (q.hasNonNull("kpiId")) {
    // ---- SAVED-KPI PATH (citizen/supervisor/admin all allowed; row scope still applies) ----
    String  kpiId = q.get("kpiId").asText();
    Integer ver   = q.hasNonNull("kpiVersion") ? q.get("kpiVersion").asInt() : null;
    KpiDef  def   = store.load(scope.tenantId, kpiId, ver);             // 404 kpi_not_found / kpi_version_not_found

    // (1) INVOCATION RE-CHECK — the security boundary (design §5a). Null/empty roles => disjoint true => deny.
    if (disjoint(def.visibleTo, principal.roles))
        throw new ForbiddenException("kpi_forbidden: not visible to caller roles");
    // (1b) attribute precondition — caller must carry the attrs this KPI needs (Part B output), fail-closed
    for (String attr : def.requiresAttributes)
        if (!principal.hasResolvedAttribute(attr))
            throw new ForbiddenException("kpi_forbidden: requires attribute " + attr);

    // (2) materialize frozen body + validated runtime params (design §3 "composition at call time")
    JsonNode materialized = materialize(def, q.get("params"));          // 422 param_not_allowed
    Map<String,Object> r = runOne(materialized, scope);                 // planner + scope UNCHANGED
    r.put("kpiId", kpiId); r.put("kpiVersion", def.version);
    r.put("viz", def.viz); r.put("freshness", def.freshness);
    return r;
  }
  // ---- INLINE PATH (Layer 3 gate — see Part F for full policy; gate is installed at EVERY arm) ----
  if (!principal.canInline())                                          // PGR_ADMIN/DSS_ANALYST/SUPERADMIN only
      throw new ForbiddenException("inline_forbidden: inline queries require analyst/admin role");
  return runOne(q, scope);
}
```

`materialize(def, params)` (design §3 steps 2-3): deep-copy the frozen `def.query`; for each supplied param, validate value ∈ `def.params[name].allowed` (else `422 param_not_allowed`), then apply by type — `window`→ set `query.window.name`; `timeRole`→ set `window.timeRole`/`timeBucket.timeRole` (must be in `allowedTimeRoles`); `dimensionFilter`→ **the filter COLUMN is fixed by the def** (the JSON key under `query.filters`), the param supplies only the **bound value** that is ANDed in (m1 fix — never a caller-chosen filter key); `boundaryScope`→ a *declared narrowing* the planner ANDs **under** the injected scope (Part C; never a free `prefix` filter, design §2). The planner backstops any stray column key anyway (`predicate()` rejects non-`filterable` columns → `op_not_allowed`, `AnalyticsPlanner.java:174-175`; all values bound `:183-194`). **Scope injection (Part C `applyScope`) happens after materialization and cannot be overridden** (design §3 step 4, §5; `applyScope` `AnalyticsPlanner.java:241-251`).

**Building the principal — `Principal.of(requestInfo, scope)` (Gaps fix).** `AnalyticsScope` **discards roles** — it reads `u.getRoles()` at `AnalyticsScope.java:38-42` only to derive `citizenUuid`, and the returned object keeps only `tenantId`/`tenantStateLevel`/`citizenUuid`/`boundaryPrefix` (`:21-28,47`). So D cannot read roles off `AnalyticsScope`. `Principal.of` re-reads `requestInfo.getUserInfo()` (trustworthy **post-Part-A**) and extracts:
- `roles` ← `u.getRoles()` mapped to upper-cased codes (same source `AnalyticsScope.java:38-42` reads). **Null or empty → `roles = ∅`**, which makes `disjoint(visibleTo, ∅)` true → fail-closed (00-requirements §6).
- `type` ← `u.getType()`.
- `canInline()` ← `roles ∩ {PGR_ADMIN, DSS_ANALYST, SUPERADMIN} ≠ ∅`.
- `hasResolvedAttribute(attr)` ← delegates to Part B's resolved `{boundaryPrefixes, departmentCodes}` (non-empty).
- **Tenant guard (D→A caveat fix):** `Principal.of` asserts the body `tenantId` is within the principal's allowed/resolved tenant set **before** any `store.load(scope.tenantId, …)`. Part A.4 (`10-auth-foundation.md:207`) owns the precise cross-state policy and is "intentionally conservative (cross-state 403)", deferring sub-tenant nuance to Part C; D does **not** re-implement it but **does** assert the guard ran (throws `tenant_mismatch` if the principal carries no allowed-tenant evidence) rather than blindly trusting body `tenantId`. **D consumes A's trust guarantee; it does not re-validate the token.**

### D.4 `POST /v2/analytics/catalog/_search` (discovery)

New mapping in `AnalyticsController` (sibling of `_schema` at `AnalyticsController.java:57-60`). **POST, not GET** (M1 fix): the two shipped sibling endpoints carry `RequestInfo` over **POST** (`AnalyticsController.java:40` `_query`, `:57` `_schema`), and the only existing `@GetMapping` in pgr-services (`RequestsApiController.java:107` `/dashboard`) takes **`@RequestParam` only, no body, no `RequestInfo`**. There is no "GET + RequestInfo body" convention here, and GET-with-body is routinely stripped by Kong/clients (a stripped body → null roles → empty catalog for everyone — fail-safe but dead). The DIGIT-idiomatic shape is a POST `_search`:

```java
@PostMapping("/catalog/_search")
public ResponseEntity<Map<String,Object>> catalogSearch(@RequestBody JsonNode body){
  RequestInfo ri = body.has("RequestInfo")
        ? mapper.convertValue(body.get("RequestInfo"), RequestInfo.class) : null;
  String tenantId = body.hasNonNull("tenantId") ? body.get("tenantId").asText() : null;
  Principal p = Principal.of(ri, AnalyticsScope.resolve(ri, tenantId, stateLen()));  // roles from validated userInfo (Part A)
  return ResponseEntity.ok(service.catalog(tenantId, p));
}
```
```java
// AnalyticsService
public Map<String,Object> catalog(String tenantId, Principal p){
  List<Map<String,Object>> tiles = new ArrayList<>();
  for (KpiDef d : store.publishedFor(tenantId)) {
    if (disjoint(d.visibleTo, p.roles)) continue;        // ← discovery filter (UX); SAME predicate as invocation
    // draft defs already excluded by publishedFor(); author-draft preview is a separate analyst/admin-only call
    tiles.add(Map.of("id",d.id,"version",d.version,"title",d.title,
                     "viz",d.viz,"freshness",d.freshness,"params",d.params,
                     "requiresAttributes",d.requiresAttributes));
  }
  return Map.of("version","1","kpis",tiles);
}
```

**Discovery and invocation share the exact same `disjoint(visibleTo, roles)` method** — different enforcement points, one rule. The catalog returns **no `query` body and no SQL** — only what the FE picker needs (id, title, viz, declared params). A caller cannot learn a hidden KPI's existence from `catalog/_search`.

### D.4a `_schema` must be role-filtered too (M2 fix)

`catalog/_search` closing the KPI-def side door is not enough: `POST /_schema` (`AnalyticsController.java:57-60` → `AnalyticsService.schema()` `:72-94`) is **zero-arg, unauthenticated**, and returns the **full** grain/column catalog to anyone — including the officer/PII columns `current_assignee_uuid` (`AnalyticsCatalog.java:59,77,103,107`), `assignee_uuid` and `actor_uuid` (`:88,95`) as groupable/distinct-countable. With the (now-gated) inline path closed to non-analysts, `_schema` is still a *map* of every queryable officer column. This part therefore:
1. Changes `_schema` to accept the same `RequestInfo` body (POST already) and build a `Principal`.
2. For non-analyst/admin callers, **elides officer/PII columns** (the new `officerColumns` set, D.5 step 4) from every grain's `groupable`/`distinctable`/`scopeColumns` in the `schema()` response.
3. Null/empty roles → the most-restricted (citizen) view, never the full catalog. (Fail-closed.)

This keeps `_schema` useful for the analyst KPI-editor while removing the officer-column reconnaissance side door past the def ceiling. Full Layer-3 policy on `_schema` is Part F's; D installs the minimal elision so the PII ceiling has no side door before F lands.

### D.5 Publish-time safety pipeline (design §3a)

`mdms_create` of a `dss.KpiDefinition` is the *intent*; a def becomes servable only after a fixed pipeline. This is **not** a raw MDMS write — it is a governed endpoint (new `POST /v2/analytics/kpi/_publish`, analyst/admin only) that runs the steps then writes the immutable record.

1. **Validate against the catalog — for the def's DECLARED grain.** Every `column`/`agg`/`timeRole`/`granularity`/`dimension`/`filter` key in `def.query` is checked against `AnalyticsCatalog` **for the def's explicit `grain`** (required, D.1) — the **same** sets the planner enforces (`AnalyticsCatalog.java:54-108` per-grain; `AGG_FNS` `:115-116`). Reuse the planner by calling `planner.plan(def.query, ADMIN_SCOPE)` in a dry-validate mode and catching `unknown_column`/`unknown_grain`/`op_not_allowed`. **Reject any def whose `query` omits `grain`** — do **not** lean on `inferGrain` (`AnalyticsPlanner.java:267-275`), which never returns `daily` (m2). Grain/column validation is a **scope-independent property of the grain** and runs here regardless of the sample scopes used in step 2 (Gaps fix). Op-set source of truth is the planner's actual switch `AnalyticsPlanner.java:182-197` (`eq,ne,gt,gte,lt,lte,in,isnull`), **never** design §10's prose (reality gap 2).
2. **Bounded dry-run under sample scopes.** Execute the plan with a `LIMIT`/`EXPLAIN` cap under a representative **citizen** scope, a **supervisor** subtree scope, and the **admin** scope (build three `AnalyticsScope` fixtures), confirming the injected `boundary_path`/`account_id` predicate (Part C, `applyScope` `AnalyticsPlanner.java:241-251`) composes and the SQL is well-formed for each caller class. This catches a def that is valid for admin but blows up when row scope is ANDed in. **Daily-grain note:** the shipped daily grain has `citizenColumn = null` (`AnalyticsCatalog.java:108`) so the citizen self-scope predicate is **silently skipped** (`AnalyticsPlanner.java:246` guards on `citizenColumn != null`) — a citizen-visible daily def would return tenant-wide rows. This is the convergent cross-cutting **daily-grain citizen leak** (README §1); the *fix* (add `account_id` to the daily grain, or reject citizen daily queries) is **Part C's** to land. Until C lands, this part's step 4 **hard-rejects any `dss.KpiDefinition` with `grain:"daily"` whose `visibleTo` includes a citizen role** — D cannot fix the leak but refuses to mint a def that rides it.
3. **Row-count / cost estimate.** `EXPLAIN (FORMAT JSON)` the admin-scope plan; capture estimated rows + cost. There is **no per-grain `maxRows` field on `Grain` today** — the only row cap is the hard global `MAX_LIMIT=1000` (`AnalyticsPlanner.java:24`, applied `:110-111`) (m3 fix). This part uses a **single global cost/row threshold** (config, default tied to `MAX_LIMIT`) and rejects defs that group by an unbounded high-cardinality column with no `topN`/`limit`. A per-grain `maxRows` is deferred to the catalog-modernization PR (Open Q1); the design does **not** assume a `Grain.maxRows` exists. Record `estRows`/`estCost` on the def's `approval` block.
4. **Approval gate for PII/officer dimensions.** Any def that returns or groups by a PII/officer column requires explicit reviewer sign-off recorded as `approval.officerDimApproved=true`. **Reality gap (above):** the shipped `Grain` has no `pii` marker, so this part adds a minimal `Set<String> officerColumns` + `Set<String> citizenColumns` to `AnalyticsCatalog` (derivable today: `current_assignee_uuid` (`AnalyticsCatalog.java:59,77,103,107`), `assignee_uuid`/`actor_uuid` (`:88,95`) are officer; `account_id` (`:77,95`) is citizen). A def whose `visibleTo` includes a citizen role **may not** carry any officer column (hard reject, design §3a step 4 + §5). This same `officerColumns` set drives the `_schema` elision (D.4a).
5. **Immutable, versioned publish — enforced by the pipeline, NOT by `x-unique`.** `x-unique:["id","version"]` only guarantees the composite key `(id,version)` is unique on create (`CompositeUniqueIdentifierGenerationUtil.java:23-44`); MDMS v2 will still happily mutate a published record through `_update/{schemaCode}` (`MDMSControllerV2.java:56-59` → `MDMSServiceV2.java:99-114`). Immutability is therefore a **pipeline invariant**, not a platform guarantee: (a) the `version` field is part of the id/composite key; (b) on approval the pipeline writes a **new** `(id,version)` record `status:"published"` with `version` bumped — it **never** calls `_update` against an already-published `(id,version)`; (c) supersession is a forward-only **status transition** — the prior version is moved `published`→`archived` (a new state, the body is left byte-for-byte intact) and the new version becomes "latest". Audit who/when/diff. **Rollback = re-point "latest"** by publishing a new version equal to a prior body, or by archiving the bad version — prior records are never mutated. (The publish endpoint is the *only* sanctioned writer; a raw `mdms_create`/`_update` bypassing it is an authoring violation, Open Q2.)

Net: the no-deploy convenience (design §3) is preserved; the served catalog only ever holds catalog-valid, cost-bounded, PII-reviewed, versioned defs.

### D.6 Errors (design §11)

| HTTP | code | When (this part) |
|---|---|---|
| 403 | `kpi_forbidden` | `visibleTo ∩ roles = ∅` (incl. null/empty roles), or a `requiresAttributes` attr is unresolved/empty for the caller |
| 403 | `inline_forbidden` | non-analyst/admin token sends inline `measures`/`dimensions`/`filters` — at **either** arm (gate installed here; policy = Part F) |
| 403 | `tenant_mismatch` | body `tenantId` not within principal's allowed tenants (guard owned by A; D asserts it ran before `store.load`) |
| 404 | `kpi_not_found` | `kpiId` unknown at tenant (+root fallback) |
| 404 | `kpi_version_not_found` | `kpiVersion` pinned but absent |
| 422 | `param_not_allowed` | runtime param value ∉ def's `params[*].allowed` |
| (publish) 400 | `kpi_invalid` | publish-pipeline step 1-4 rejection (catalog/grain/cost/PII, incl. missing explicit `grain` and citizen-visible daily def) |

---

## Interfaces with other parts

**Consumes (inputs):**
- **From Part A (trust foundation):** a trustworthy `principal.roles` and `principal.type`. *Contract:* `RequestInfo.userInfo` is token-derived and coercive — a spoofed `userInfo` is rejected/ignored before it reaches `AnalyticsService`. D's `visibleTo`/`inline` checks are theater without this (00-requirements §7.1). Additionally D **asserts** A's tenant cross-check ran (`Principal.of` → `tenant_mismatch`) before reading defs at the body tenant, rather than assuming the controller rejected the mismatch (A.4 `10-auth-foundation.md:207` owns the policy and is conservative cross-state). **Hard dependency.**
- **From Part B (attribute resolution):** `principal.hasResolvedAttribute(attr)` and the resolved `{boundaryPrefixes, departmentCodes}`. *Contract:* `requiresAttributes:["department"]` passes iff Part B resolved a non-empty department for the caller; a missing HRMS row → fail-closed (attr absent → `kpi_forbidden`), never open (00-requirements §6). **Events-grain dept gap (D→B):** a def with `requiresAttributes:["department"]` whose declared grain is `events` would pass D's presence gate but **Part C cannot scope it** (the events MV has no `department_code` — README §3, 00-requirements §7.4). So publish step-1 must additionally require that a def's `requiresAttributes` ∩ its **declared grain's** scopable columns is satisfiable; otherwise reject at publish (`kpi_invalid`), never mint a def that fails open at runtime.
- **From Part C (attribute-scope engine):** the injected `WHERE` via `AnalyticsScope`/`applyScope`. *Contract:* materialization runs **before** scope injection; D never touches `applyScope`. The `boundaryScope`/`departmentScope` runtime params D validates are *declared narrowings* C ANDs **under** the injected scope. C also owns the **daily-grain citizen-leak fix** (`citizenColumn` null at `AnalyticsCatalog.java:108`); D refuses to publish a citizen-visible daily def until C lands it (D.5 step 2).
- **From `AnalyticsCatalog` (existing):** the column/agg whitelist (`AnalyticsCatalog.java:54-116`) — the publish pipeline's step-1 source of truth, plus the new minimal `officerColumns`/`citizenColumns` sets this part adds.

**Produces (outputs):**
- **To Part E (dashboard packs):** the per-def **security ceiling** `visibleTo`. *Contract:* a pack listing a KPI whose `visibleTo` excludes the role gets `403 kpi_forbidden` on that tile at invocation (D's re-check via the shared `disjoint`), never a leak — "packs are assembly, the ceiling is the engine" (design §5a). E references `dss.KpiDefinition.id`; D guarantees the re-check. E reuses the same tenant guard (`50-packs-config-ownership.md:292`).
- **To the FE:** `catalog/_search` tiles (id/title/viz/params) and, on `_query`, the echoed `kpiId`/`kpiVersion`/`viz`/`freshness`. *Contract:* FE filtering is cosmetic; the engine re-checks every invocation, on both arms (00-requirements §1, §5a).
- **To the cache layer (NFR, 00-requirements §6):** the resolved `{kpiId, kpiVersion, materialized params}` that, together with **resolved scope** (Part C) and `asOf` (`AnalyticsService.asOf()` `:104-107`), form the cache key. D must surface `kpiVersion` so a published edit (new version) is a new cache bucket.

---

## Sequencing & migration steps

1. **Block on Part A.** No D enforcement is real until `userInfo` is trustworthy (00-requirements §8: "A blocks all of B–F"). Land A first; add A's spoof negative-test.
2. **Register `dss.KpiDefinition` schema** at the state root via `mdms_schema_create` (D.1), with **required explicit `grain`**. Idempotent (`alreadyExists` handled, `mdms_schema_create.md:44-52`). Validate on ovh-cloud-dev (bomet repro) first.
3. **`KpiDefinitionStore` + MDMS v2 search** (D.2). Add a v2 `/v2/_search` client path (the shipped `MDMSUtils` is v1, `MDMSUtils.java:103-118`). Unit-test the **explicit city + root two-read merge** (NOT a platform fallback — MDMS v2 search is first-hit, `MDMSServiceV2.java:83-89`) and `createdBy` read.
4. **Seed the existing FE KPIs as defs.** Port each hardcoded `frontend/micro-ui/web/src/dashboard/config/kpiQueries.js` body (00-requirements §1) into a `dss.KpiDefinition` record with an **explicit grain** and a conservative `visibleTo`. Run each through the publish pipeline.
5. **Wire `runEntry` into BOTH arms** of `AnalyticsService.query` (D.3, B1 fix): replace `runOne(...)` at the batch loop (`AnalyticsService.java:45`) **and** the single arm (`:51`) with `runEntry(q, scope, principal)`. Inline path stays fully functional for analyst/admin (no regression — current callers are all inline). **Negative test:** a citizen token sending `{"queries":{"x":{...inline measures...}}}` → `inline_forbidden` (proves the batch arm is gated).
6. **Add `POST /catalog/_search`** (D.4) and **role-filter `_schema`** (D.4a).
7. **Build the publish endpoint + pipeline** (D.5), incl. the minimal `AnalyticsCatalog` `officerColumns`/`citizenColumns` markers (step 4 reality gap), explicit-grain enforcement, single global cost threshold, and the citizen-visible-daily reject.
8. **FE cutover** (coordinated with Part E): FE fetches `catalog/_search`, stops shipping query bodies. Cosmetic tile-hiding may stay; the engine is now authoritative.
9. **PR-per-step against egov/CCRS develop**, emitted SQL reviewed in tests (plan §6.5), validated on ovh-cloud-dev before live bomet (which redeploys nightly from develop — memory [Bomet nightly cron re-scope]).

---

## Risks, edge cases, failure modes

- **Fail-closed everywhere.** Missing/forged principal → A's job, but D also fails-closed: empty/null `roles` → `disjoint` is true → `kpi_forbidden` (never default-visible); `Principal.of` sets `roles=∅` when `userInfo.getRoles()` is null (D.3). An unresolved `requiresAttributes` attr → `kpi_forbidden`. A `dss.KpiDefinition` that fails to load (MDMS down) → `query_failed`/deny, **never** an FE-style open default. `_schema` with null roles → most-restricted view (D.4a).
- **Both-arm gating (the original leak, B1).** The single arm AND the batch-dict arm route through `runEntry`; the batch path can no longer smuggle inline grammar. Negative test in step 5.
- **Discovery/invocation drift (the classic leak).** `catalog/_search` and `_query` call the **one** `disjoint(visibleTo, roles)` method (D.4 + D.3). Test: a KPI absent from a role's catalog returns `403` when that role POSTs its `kpiId`.
- **`_schema` side door (M2).** Officer/PII columns are elided from `_schema` for non-analyst callers (D.4a) so the def ceiling has no reconnaissance side door.
- **HRMS role pollution** (00-requirements §7.2, memory [HRMS role pollution]). Every real `GRO` also carries `PGR_LME`; author/test all `visibleTo` against clean single-role `RBAC_TEST_*` users, never real provisioned accounts. Data hazard, not a code bug — but a polluted test account gives false confidence.
- **`visibleTo` is a ceiling, not a grant via empty scope.** A supervisor whose row scope returns zero rows for an officer-leaderboard KPI is still **forbidden** the KPI if `visibleTo` excludes them — Layer 2 and Layer 1 are independent (design §5a). Never infer "empty result ⇒ safe to show."
- **Daily-grain citizen leak (cross-cutting, Part C owns the fix).** `complaint_open_state_daily` has `citizenColumn = null` (`AnalyticsCatalog.java:108`); the self-scope predicate is skipped (`AnalyticsPlanner.java:246`). A citizen-visible daily def would return tenant-wide rows. D's mitigation: publish-pipeline **hard-rejects** any citizen-visible `grain:"daily"` def (D.5 step 2) until C adds `account_id` to the daily grain.
- **PII/officer leak through a citizen-visible def.** Publish step 4 hard-rejects a citizen-visible def carrying any officer column (`officerColumns` set). Without that marker the gate can't fire — hence this part adds it.
- **`inferGrain` never returns daily (m2).** A daily def without explicit `grain` would run on `facts` with wrong semantics. Mitigation: `grain` is **required** in the schema and re-checked at publish; `inferGrain` (`AnalyticsPlanner.java:267-275`) is never relied on for daily.
- **Cost cap has no per-grain budget (m3).** Only the global `MAX_LIMIT=1000` exists (`AnalyticsPlanner.java:24,110-111`). The cost gate uses a single global threshold; per-grain `maxRows` is deferred (Open Q1).
- **Stale catalog cache vs publish.** The `KpiDefinitionStore` TTL cache can serve a just-archived/edited def. Bust on publish-endpoint write; bound TTL short. A pinned `kpiVersion` is immutable so never stale; only "latest" resolution is.
- **Param injection via materialization (m1).** `dimensionFilter`/`boundaryScope` params validate against `params[*].allowed` (`422`) and the filter **column is def-fixed** (caller supplies only the bound value); values flow as **bound params** through the planner (`AnalyticsPlanner.java:183-194`), never string-concatenated. The planner also rejects any non-`filterable` column (`:174-175`). A param value not in `allowed` is rejected pre-plan; an `allowed` list referencing a non-existent value is a publish-time authoring error caught by step-1 dry-validate.
- **Tenant/jurisdiction/department isolation.** Defs are read tenant + root-fallback (D.2); a city must not see another city's private def. `Principal.of` asserts the body `tenantId` is within the principal's allowed tenants **before** `store.load` (`tenant_mismatch`), rather than assuming the controller already rejected it (A.4 owns the policy, `10-auth-foundation.md:207`). `requiresAttributes` isolation is Part B's resolution; D only gates on presence + grain-scopability.
- **Op-set divergence (reality gap 2).** The pipeline validates against the **shipped** planner op-set (`AnalyticsPlanner.java:182-197`: `eq,ne,gt,gte,lt,lte,in,isnull`), not design §10's `eq,in,nin,range,null`. Pin to `AnalyticsCatalog`/planner; reconcile the two op-sets as a separate cleanup.

---

## Open questions for review

1. **Per-column op-sets / per-grain `maxRows`: extend `Grain` now or defer?** The design's §10 catalog (per-column `returnable`/`sortable`/`roleAllowed`/`minGroupSize`/`pii` + per-grain `maxRows`) is richer than the shipped `Grain` (`AnalyticsCatalog.java:25-48`). This part adds only the **minimal** `officerColumns`/`citizenColumns` sets (PII gate + `_schema` elision) and uses a single global cost threshold. Full model = a separate catalog-modernization PR (touches `/_schema`). Recommendation: minimal now, full model later.
2. **Publish endpoint vs raw `mdms_create`.** D.5 proposes a dedicated `POST /kpi/_publish` running the pipeline then writing MDMS. Alternative: raw `mdms_create` + a Kafka/validating-interceptor on the write. Dedicated endpoint keeps cost/dry-run next to the planner; interceptor is more "MDMS-native." Which?
3. **Where does the inline gate's *policy* live — D or F?** This part installs the branch point at **both arms** and a simplest `canInline()` check; Part F owns full Layer-3 policy (incl. `_schema` officer-column policy). Confirm the split: D ships the gate + minimal `_schema` elision, F refines.
4. **`requiresAttributes` semantics — presence vs value match.** `requiresAttributes:["department"]` = "caller must have *any* resolved department" (presence, current design) — simplest, composes with Part C row scope; a value match would duplicate Layer-1 logic. Recommendation: presence-only, **plus** the new publish-time grain-scopability check (D→B) so events-grain dept defs are rejected.
5. **Draft visibility / `createdBy` read path.** D.4 filters drafts to author+analyst/admin via the def's `auditDetails.createdBy`. Confirm MDMS v2 `/v2/_search` surfaces `createdBy` reliably so `KpiDef.createdBy` (D.2) is populated.
6. **Reconciling `asOf` for cache vs def `freshness`.** D surfaces `kpiVersion`+`freshness`; the cache key needs `asOf` (`AnalyticsService.asOf()` `:104-107`). Confirm the cache layer (not owned here) reads both, so a published edit *and* a refresh both bust correctly.
7. **Daily-grain fix coordination (C).** D currently rejects citizen-visible daily defs at publish. Once Part C adds `account_id` self-scope to the daily grain (`AnalyticsCatalog.java:108`), D should relax that reject. Confirm the hand-off so the reject is lifted exactly when C lands, not before.

---

## v2 revision log (pass-1 findings → resolution)

- **Blocker B1 — batch-dict arm bypasses kpiId re-check AND inline gate (silent leak).** The batch arm (`AnalyticsService.java:38-49`, loop body calling `runOne` at `:45`) and single arm (`:50-51`) both hit `runOne` (`:58-69`) straight; v1 only rewired the single arm. **Resolved:** D.3 now routes **both** arms through a single gated `runEntry(q, scope, principal)` — the revised `query()` replaces `runOne` at `:45` *and* `:51`; step 5 mandates the both-arm wiring plus a citizen `{"queries":{...inline...}}` → `inline_forbidden` negative test. Risks-§ and the responsibilities list both restate "gate installed at every arm."
- **Major M1 — `GET /catalog` with a RequestInfo body is not a DIGIT idiom and is fragile through Kong.** Verified: shipped siblings are POST (`AnalyticsController.java:40`,`:57`); the only `@GetMapping` in pgr-services takes `@RequestParam` only, no body (`RequestsApiController.java:107-111`). **Resolved:** discovery is now `POST /v2/analytics/catalog/_search` (D.4) carrying `RequestInfo` like its siblings; goal #3 and the FE-cutover step updated. Eliminates the GET-body-stripped → empty-catalog failure.
- **Major M2 — `_schema` stays unauthenticated and leaks officer/PII columns past the def ceiling.** Verified: `schema()` is zero-arg (`AnalyticsController.java:57-60`, `AnalyticsService.java:72-94`) and returns `current_assignee_uuid`/`assignee_uuid`/`actor_uuid` (`AnalyticsCatalog.java:59,77,88,95,103,107`) as groupable/distinctable to anyone. **Resolved:** new D.4a role-filters `_schema` — non-analyst callers get officer columns elided (driven by the same `officerColumns` set as D.5 step 4); null/empty roles → most-restricted view. Side door closed before Part F lands; full `_schema` policy noted as F's.
- **Minor m1 — `materialize` pins the filter value but not the filter column.** **Resolved:** D.1 `params` description, D.3 `materialize` spec, and the risks-§ now state the `dimensionFilter` **column is def-fixed** (the JSON key) and the caller supplies only the bound value; planner backstop cited (`AnalyticsPlanner.java:174-175,183-194`).
- **Minor m2 — `inferGrain` never resolves `daily`; an implicit-grain daily def runs on `facts`.** Verified `inferGrain` returns only `events`/`facts` (`AnalyticsPlanner.java:267-275`). **Resolved:** `grain` is now a **required** top-level field (must equal `query.grain`) in D.1; publish step 1 rejects defs missing explicit `grain` and never relies on `inferGrain`. Restated in risks-§.
- **Minor m3 — step-3 cost cap referenced a non-existent per-grain `maxRows`.** Verified only the global `MAX_LIMIT=1000` exists (`AnalyticsPlanner.java:24`, applied `:110-111`); `Grain` has no `maxRows`. **Resolved:** D.5 step 3 now uses a **single global** cost/row threshold (config, default tied to `MAX_LIMIT`); per-grain `maxRows` deferred to Open Q1. Design no longer assumes a `Grain.maxRows` field.
- **Mis-citations — none found in v1, but line refs tightened to the real file.** v1's coarse ranges are corrected to verified anchors: batch arm `AnalyticsService.java:38-49` (loop `:42-47`), single arm `:50-51`, `schema()` `:72-94`, `asOf()` `:104-107`; `AnalyticsController` `_query` `:40-41/:47`, `_schema` `:57-60`; `AnalyticsScope` `:31-48` (roles read `:38-42`, discarded — see Gaps); planner `plan` `:37`, op switch `:182-197`, `applyScope` `:241-251`, `inferGrain` `:267-275`, `MAX_LIMIT` `:24`/`:110-111`; catalog grains `:54-108`, officer cols `:59,77,88,95,103,107`, citizen col `account_id` `:77,95`, daily `citizenColumn` null `:108`, `AGG_FNS` `:115-116`; `RequestsApiController.java:107-111`. The `kpiQueries.js` path is given fully (`frontend/micro-ui/web/src/dashboard/config/kpiQueries.js`).
- **Interface D→A (tenant cross-check caveat).** A.4 is conservative and defers sub-tenant policy to C; v1 just "deferred" the body-tenant check. **Resolved:** `Principal.of` now **asserts** the tenant guard ran (`tenant_mismatch`, D.6) before any `store.load(scope.tenantId, …)`, rather than trusting body `tenantId`. D still does not re-implement A.4's policy (`10-auth-foundation.md:207`).
- **Interface D→B (events-grain dept gap).** A `requiresAttributes:["department"]` def on the events grain passes presence but can't be scoped (events MV lacks `department_code`, README §3 / 00-req §7.4). **Resolved:** publish step 1 + the D→B contract now require `requiresAttributes ∩ declared-grain scopable columns` be satisfiable, rejecting such defs at publish (`kpi_invalid`) — fail-closed, never unscoped at runtime.
- **Interface D→F (inline gate incomplete).** F can't refine a gate the batch arm never reaches. **Resolved:** B1 fix makes the branch point reach both arms; D→F contract and Open Q3 updated so F refines a complete gate (and D ships the minimal `_schema` elision F later owns).
- **Interface D→E (ceiling).** Sound in v1; retained. E re-checks `visibleTo` via the same `disjoint` and reuses the tenant guard (`50-packs-config-ownership.md:292`).
- **Gap — `queries` batch arm not stated as gated.** **Resolved:** explicitly stated in D.3, the current-reality table, step 5, and risks-§ (B1).
- **Gap — `Principal` extraction path unspecified; `AnalyticsScope` discards roles.** Verified `AnalyticsScope` keeps only `tenantId/tenantStateLevel/citizenUuid/boundaryPrefix` (`:21-28,47`) and drops roles after `:38-42`. **Resolved:** D.3 defines `Principal.of(requestInfo, scope)` re-reading `userInfo` for `roles/type/canInline/hasResolvedAttribute`, with null/empty roles → `∅` → fail-closed, and the tenant-guard assert.
- **Gap — step-1 dry-validate conflates "admin scope" with "safe for citizen scope".** **Resolved:** D.5 step 1 now states grain/column/op validation is a **scope-independent** property run against the def's **declared grain** regardless of scope; the three-scope dry-run (step 2) is a separate concern, and PII/dept-scopability (step 4 + D→B) are scope-independent def properties checked at publish.
- **Cross-cutting — daily-grain citizen leak (README §1, found by reviewers A+C).** **Acknowledged; not fixable in Part D.** The fix (add `account_id` self-scope to the daily grain at `AnalyticsCatalog.java:108`, or reject citizen daily queries in the planner) is owned by **Part C** (`30-row-scope-enforcement.md`). D's containment: publish step 2 **hard-rejects** any citizen-visible `grain:"daily"` def until C lands; Open Q7 tracks lifting the reject when C ships.

### v3 corrections (pass-3 codex fact-check, 2026-06-23)

Two genuine MDMS-behavior errors caught by the pass-2 codex review, verified against the real `Digit-Core/core-services/mdms-v2` source and corrected with minimal edits:

- **MDMS v2 search is first-hit, not a tenant→root merge.** `MDMSServiceV2.search()` loops the fallback tenant list and `break`s on the **first non-empty** result (`MDMSServiceV2.java:83-89`), so a city-local def set suppresses the root set rather than augmenting it. The design previously implied an automatic platform merge. **Corrected:** D.1 note and D.2 `publishedFor` now state defs are resolved by **two explicit reads** (city tenant + state root via `getStateLevelTenant`) merged in-process by the store (city wins per `id`); sequencing step 3 unit-tests that explicit merge, not a platform fallback.
- **`x-unique` enforces composite-key uniqueness only, not immutability/versioning.** `CompositeUniqueIdentifierGenerationUtil.getUniqueIdentifier` (`CompositeUniqueIdentifierGenerationUtil.java:23-44`) concatenates the x-unique fields into one identifier at create time; MDMS v2 still mutates existing records via `_update/{schemaCode}` (`MDMSControllerV2.java:56-59` → `MDMSServiceV2.java:99-114`). The design previously claimed `x-unique:["id","version"]` gives "immutable versioned publish for free." **Corrected:** D.1 note and D.5 step 5 now make immutable versioning an **explicit pipeline invariant** — `version` in the composite key, write-new-`(id,version)`-never-`_update`-a-published-version, and a forward-only `published`→`archived` status transition; `x-unique` is described as only a duplicate-create backstop.

## Codex review (pass 2 — gpt-5.5, verdict: needs-rework)

> External adversarial review via `codex exec`, read-only, verifying the v2 revision log against the actual code. **Note:** codex evaluated "resolved" as "patched in code"; this is a *design* doc (no code changed yet), so most `actuallyResolved:false` items mean "design specifies it, code not yet written," not "design wrong." Read the findings for genuine design errors vs. implementation-status notes.


**Summary:** The revision log mostly fixes prose, not actual code. Current analytics code still has no KpiDefinitionStore, Principal, runEntry, catalog endpoint, publish pipeline, officerColumns/citizenColumns, or schema role filtering. Several citations are accurate, but at least one M1 claim misstates _schema as carrying RequestInfo.


### Resolution check (0/15 confirmed in code)

- ❌ **Blocker B1 — batch-dict arm bypasses kpiId re-check AND inline gate.** — Actual AnalyticsService still calls runOne directly in both arms: batch at AnalyticsService.java:45 and single at :51; runOne plans directly at :58-59. No runEntry exists.
- ❌ **Major M1 — GET /catalog with RequestInfo body is fragile.** — Design now says POST /catalog/_search, but actual AnalyticsController has only /_query and /_schema mappings at AnalyticsController.java:40 and :57. No catalog endpoint exists.
- ❌ **Major M2 — _schema unauthenticated leaks officer/PII columns.** — Actual _schema is still zero-arg and unauthenticated at AnalyticsController.java:57-59 and AnalyticsService.schema() returns full catalog at :72-94, including PII/officer columns from AnalyticsCatalog.java:59,77,88,95,103,107.
- ❌ **Minor m1 — materialize pins value but not filter column.** — No materialize implementation or saved-KPI path exists. Actual query path passes raw q to planner.plan at AnalyticsService.java:58-59. Planner binds filter values and rejects non-filterable columns at AnalyticsPlanner.java:173-197, but there is no def-fixed param materialization.
- ❌ **Minor m2 — inferGrain never resolves daily.** — Actual inferGrain still returns only events/facts at AnalyticsPlanner.java:267-275. No dss.KpiDefinition schema or publish enforcement exists in code to require explicit grain.
- ❌ **Minor m3 — cost cap referenced non-existent per-grain maxRows.** — Actual code still only has MAX_LIMIT at AnalyticsPlanner.java:24 and applies it at :110-111. There is no publish cost gate or config-backed global threshold implementation.
- ❌ **Mis-citations — line refs tightened.** — Most anchors are accurate, but M1 says both shipped siblings carry RequestInfo over POST; _schema is POST but carries no body/RequestInfo: AnalyticsController.java:57-59.
- ❌ **Interface D→A — tenant cross-check caveat.** — No Principal.of or tenant_mismatch path exists. Actual controller reads tenantId from body at AnalyticsController.java:45 and service builds scope from it at AnalyticsService.java:30-32.
- ❌ **Interface D→B — events-grain department gap.** — No publish check exists. Events grain has no department_code in groupable/filterable/distinctable at AnalyticsCatalog.java:84-96, and AnalyticsScope has no department attributes at :20-28.
- ❌ **Interface D→F — inline gate incomplete.** — No inline gate exists. Both actual arms still invoke runOne directly, AnalyticsService.java:45 and :51.
- ❌ **Interface D→E — ceiling.** — No visibleTo re-check or KpiDefinitionStore exists in actual analytics package; rg found no Principal/KpiDefinitionStore/KpiDef in CCRS/backend/pgr-services/src/main/java/org/egov/pgr.
- ❌ **Gap — queries batch arm not stated as gated.** — The design states it, but actual batch arm remains ungated at AnalyticsService.java:38-46.
- ❌ **Gap — Principal extraction path unspecified; AnalyticsScope discards roles.** — AnalyticsScope indeed discards roles after reading them at AnalyticsScope.java:38-42 and returns only tenant/citizen/boundary fields at :47; no replacement Principal code exists.
- ❌ **Gap — step-1 dry-validate conflates admin scope with safe citizen scope.** — No dry-validate or publish pipeline exists. Actual planner always applies supplied scope during planning at AnalyticsPlanner.java:97-99.
- ❌ **Cross-cutting — daily-grain citizen leak.** — Actual daily grain still has citizenColumn null at AnalyticsCatalog.java:108, and applyScope silently skips citizen predicate when g.citizenColumn is null at AnalyticsPlanner.java:246. No publish-time reject exists.

### Findings

- **[BLOCKER] All claimed enforcement remains bypassable in actual code** — The v2 log claims both-arm runEntry gating, kpiId re-check, and inline_forbidden. None exists in the Java. A caller can still submit inline query bodies through either single or batch path and reach planner.plan directly.  
  _evidence:_ `AnalyticsService.java:45 calls runOne(e.getValue(), scope); :51 calls runOne(body.get("query"), scope); :58-59 runOne calls planner.plan(q, scope).`
- **[BLOCKER] Identity and tenant are still body-spoofable** — D claims Principal.of consumes a trusted principal and asserts tenant guard. Actual controller converts RequestInfo from the request body and reads tenantId from the same body, then AnalyticsScope derives citizen/employee posture from that body userInfo.  
  _evidence:_ `AnalyticsController.java:43-47; AnalyticsScope.java:34-44; AnalyticsService.java:30-32.`
- **[MAJOR] _schema side door is still open** — The M2 fix is not implemented. _schema accepts no RequestInfo and schema() returns full grain metadata, including officer UUID fields, to any caller.  
  _evidence:_ `AnalyticsController.java:57-59; AnalyticsService.java:72-94; AnalyticsCatalog.java:59,77,88,95,103,107.`
- **[MAJOR] No catalog discovery or saved KPI APIs exist** — The design relies on POST /v2/analytics/catalog/_search, KpiDefinitionStore, KpiDef, materialize, and /kpi/_publish, but the analytics package contains none of those classes or mappings.  
  _evidence:_ `AnalyticsController.java:40-60 only maps /_query and /_schema; AnalyticsService.java:21-27 injects only planner/catalog/jdbc.`
- **[MAJOR] MDMS root-fallback merge claim conflicts with MDMS v2 search behavior** — D.2 says tenant and root defs are root-fallback merged. MDMS v2 native search iterates fallback tenants and breaks on first non-empty result, so a city-local record set would suppress root records unless KpiDefinitionStore performs separate explicit searches and merges itself.  
  _evidence:_ `MDMSServiceV2.java:80-88.`
- **[MAJOR] x-unique does not provide immutable publish by itself** — D.1 says x-unique gives immutable versioned publish for free. MDMS v2 has an update endpoint and update service path; x-unique generates a uniqueIdentifier on create but does not prevent mutation of an existing version through update.  
  _evidence:_ `MDMSControllerV2.java:56-59; MDMSServiceV2.java:99-112; CompositeUniqueIdentifierGenerationUtil.java:23-44.`
- **[MAJOR] Daily citizen leak is acknowledged but still exploitable through inline path** — D contains publish-time containment for citizen-visible daily KPI defs, but actual inline queries remain available to spoofed or ungated callers. Since daily has no citizenColumn, citizen self-scope is skipped for daily.  
  _evidence:_ `AnalyticsCatalog.java:108; AnalyticsPlanner.java:246; AnalyticsService.java:45,51.`
- **[MINOR] M1 revision log misstates _schema RequestInfo behavior** — The log says shipped siblings carry RequestInfo over POST. _query does; _schema is POST but has no request body and cannot carry RequestInfo in the current signature.  
  _evidence:_ `AnalyticsController.java:40-47 versus :57-59.`

### Mis-citations

- 40-kpi-catalog-governance.md M1: '_schema' is cited as a POST sibling carrying RequestInfo, but AnalyticsController.java:57-59 has public ResponseEntity<Map<String,Object>> schema() with no @RequestBody.
- 40-kpi-catalog-governance.md D.2 implies MDMS v2 tenant/root fallback merge; actual MDMSServiceV2.java:80-88 stops at first non-empty fallback tenant.

### Gaps

- No actual ForbiddenException mapping for 403 in AnalyticsController; all non-IllegalArgumentException failures currently become 500 at AnalyticsController.java:51-53.
- No tests cited or present for citizen batch inline -> inline_forbidden, hidden kpiId -> kpi_forbidden, null roles fail-closed, or _schema elision.
- No code-level contract for PrincipalAttributes from Part B in analytics package; requiresAttributes cannot be enforced today.
- No implemented officerColumns/citizenColumns metadata in AnalyticsCatalog; current Grain only has groupable/filterable/measurable/distinctable and scope columns at AnalyticsCatalog.java:25-48.
