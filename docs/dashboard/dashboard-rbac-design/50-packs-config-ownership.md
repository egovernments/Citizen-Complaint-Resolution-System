# Part E — Dashboard Packs & Config Ownership

**Status:** v2 (pass-1 findings folded in), 2026-06-23 · **Maps to:** plan §Phase 5 (`rbac-kpi-access-implementation-plan.md`), design §5a "Dashboard packs — the curation layer above individual KPIs."
**Depends on:** Part A (trust foundation — the `Principal{uuid,type,roles[],tenantId}` contract this part consumes; A.4 tenant cross-check) and Part D (KPI catalog access — the `dss.KpiDefinition` + `rbac.visibleTo` contract this part curates over). **Blocked by:** Part A — packs assembled for a spoofable principal are theater, and the per-user store this part leans on (`digit-user-preferences-service`) has its OWN identity gap (E.3) that only a trusted, gateway-coerced uuid closes.
**Reads (grounded):** `dashboard-query-api-design.md` §3/§5/§5a; `00-requirements.md` §3/§5/§8; `rbac-kpi-access-implementation-plan.md` §0/Phase 4/Phase 5; and the real trees below.

> **Grounding rule (inherited from Part 00):** every "exists today" claim is anchored to a file:line actually read. Where something is *missing*, that is stated as missing with the anchor that shows the gap. Part E touches three real surfaces — the analytics service (`CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/`), the **fully-vendored** user-preferences-service (`CCRS/backend/digit-user-preferences-service/` — Go/Gin, source in-tree), and the configurator admin (`CCRS/configurator/src/admin/` + the vendored registry in `CCRS/configurator/packages/data-provider/`). None of the three has a line of pack/layout code today; this part designs all of it.

---

## Goal & responsibilities

### What this part owns

1. **`dss.DashboardPack` — the role→pack binding.** A named, ordered bundle of `kpiId`s plus a *default* tile layout, keyed by role, stored as an MDMS master (design §5a; plan §3 row "Dashboard packs", Phase 5). This is the **curation layer**: it answers "what does a role *get by default*," sitting **above** per-KPI `visibleTo` (which answers "what a role *may ever* see" — owned by Part D).
2. **The pack-serving read path.** A discovery surface (`POST …/packs`, resolved against the caller's roles) that returns the assembled, *ceiling-filtered* pack — so the FE never has to know which `kpiId`s a role may see; the backend tells it.
3. **The default-layout vs per-user-override split.** Pack `layout` is a tenant-authored *default*. A user's personal re-ordering/resize is **preference state**, owned by `digit-user-preferences-service`, NOT by MDMS and NOT by the pack (00-requirements §5 "Layout/personalization → user-preferences-service, not MDMS"). This part defines the `preference_code` namespace, the payload shape, the *merge contract* (default ⊕ override), **and the identity-binding precondition that store requires to be safe** (E.3).
4. **The configurator admin surface for packs.** Registering `dss.DashboardPack` (and, as Part D's consumer, `dss.KpiDefinition`) as a managed resource in the configurator so a tenant admin edits packs without a deploy.

### What this part explicitly does NOT own

- **`visibleTo` / the KPI security ceiling** — owned by **Part D**. A pack *references* `kpiId`s; it never declares or widens their visibility. The pack is assembly; the ceiling is the engine (design §5a "Packs are assembly; the ceiling is the engine").
- **Row scope** (Layer 1) — owned by **Parts B/C**. Packs do not scope rows. A pack tile that resolves to zero rows under the caller's `attrScopes` is still a *valid* tile; emptiness is never a pack concern.
- **Inline-query grammar gating** (Layer 3) — owned by **Part F**. Packs only ever name published `kpiId`s; they cannot carry inline query bodies.
- **Trustworthy identity** — owned by **Part A**. Part E *consumes* the Part A `Principal{roles}` to pick a pack and `Principal.uuid` to key preferences; it never re-derives either from raw `RequestInfo`.
- **The tenant cross-check** — owned by **Part A.4** (`10-auth-foundation.md` §A.4, `:231`). Part E *relies on* A.4 having rejected a body `tenantId` outside the principal's allowed tenants before any pack/preference read; Part E does not re-implement token-vs-tenant validation (and must NOT assume it exists today — see E.2/Risks).
- **Identity itself** (roles, jurisdiction, department, user record) — consumed read-only from DIGIT (00-requirements §5 "consume identity, don't rebuild it"). Packs are keyed *by role*, a value that already exists in the validated principal.

The one-line test for "is this Part E": *does it decide which already-permitted tiles a role sees by default, or where a user dragged a tile?* If yes, Part E. If it decides **whether** a caller may see a KPI at all, or **which rows**, it is Part D / Parts B-C respectively.

---

## Current code reality (file:line — exists vs missing)

| Capability | State today | Evidence |
|---|---|---|
| Analytics endpoints | `POST /v2/analytics/_query` + `POST /v2/analytics/_schema` **only** | `AnalyticsController.java:40,57` — `@RequestMapping("/v2/analytics")` (`:27`), two `@PostMapping`s. **No** `/catalog`, **no** `/packs`. |
| Tenant authorization on `_query` | **MISSING** — body `tenantId` is trusted | `AnalyticsService.query()` resolves scope from body `tenantId` + `requestInfo` with no membership check (`AnalyticsService.java:30-32`); `AnalyticsScope.resolve()` sets only state-vs-city + citizen self-scope, never validates tenant membership (`AnalyticsScope.java:31-48`). 00-requirements §7.1 documents the spoofability. The cross-check is a **future Part A.4 deliverable** (`10-auth-foundation.md` §A.4, `:231`), not a reusable guard today. |
| KPI defs in MDMS (`dss.KpiDefinition`) | **Missing** (Part D builds) | plan §0 "no saved KPI defs in MDMS yet"; `AnalyticsService`/`AnalyticsCatalog` never read MDMS (only hardcoded grain catalog at `AnalyticsCatalog.java:54–108`). |
| Dashboard packs (`dss.DashboardPack`) | **Missing entirely** | plan §0 row "Dashboard packs (role→tiles) … Missing". No schema, no read path, no FE consumer. |
| Role accessor on `AnalyticsScope` | **MISSING** — no public role getter | `AnalyticsScope` exposes only `tenantId`/`tenantStateLevel`/`citizenUuid`/`boundaryPrefix` (`AnalyticsScope.java:21–24`); roles are consumed inside the private `resolve()` loop (`:38–44`) and discarded. There is **no `rolesOf()`** to reuse — Part E (like Part D) must read roles off the Part A `Principal`, not re-derive from `ri`. |
| user-preferences-service data model | **EXISTS** — generic `user_preference` table | `V20260205120000__create_user_preference.sql:6–16`: `(id, user_id, tenant_id, preference_code, payload JSONB, audit cols)`; unique on `(user_id, COALESCE(tenant_id,''), preference_code)` (`:20–21`). |
| user-preferences-service Java/API | **VENDORED IN-TREE (Go/Gin)** — source present | full Go source under `backend/digit-user-preferences-service/`: routes `POST {ctx}/v1/_upsert` + `POST {ctx}/v1/_search` (`internal/routes/routes.go:33–34`); request envelopes `{RequestInfo, preference:{userId,tenantId,preferenceCode,payload}}` / `{RequestInfo, criteria:{userId,tenantId,preferenceCode,limit,offset}}` (`internal/model/models.go:127–137`); `SERVER_CONTEXT_PATH=/user-preference` (`docker-compose.yml:12`). API shape is **confirmed from source**, not deferred to the image. |
| Upsert idempotency on the key | **CONFIRMED — yes** | `Upsert` does `FindByKey(userId, tenantId, preferenceCode)` → update-or-create (`internal/service/preference_service.go:107`; `internal/repository/preference_repository.go:54–76`). One idempotent `_upsert` call per save. |
| **Identity binding in user-preferences** | **MISSING — keys on BODY `userId`, IDOR** | `Upsert` writes `req.Preference.UserId` straight from the body (`preference_service.go:107`); the token uuid (`GetUserIDFromRequestInfo`, `internal/enrichment/preference_enricher.go:74–87`) is used **only** for audit `createdBy`/`lastModifiedBy` (`preference_service.go:104,115,119`). `Search` filters by body `criteria.UserId` (`internal/repository/preference_repository.go:86–87`); validation only requires *some* criterion present (`internal/validation/preference_validation.go:81–86`). `test_apis.sh:226–239` ("Test 7", `another-user-456`) shows cross-user writes are accepted. **This store is user/tenant-spoofable as shipped** — E.3 must front it with a trusted-uuid coercion or it is an IDOR. |
| Per-user layout preference code | **Missing** — no `PGR_DASHBOARD_LAYOUT` namespace | the table is generic (`preference_code VARCHAR(128)`, comment `:53` example `USER_NOTIFICATION_PREFERENCES`); no analytics layout code is seeded anywhere. |
| Separate physical datastore | **EXISTS — own Postgres** | the vendored compose runs the service against its **own** `postgres:15-alpine`, `DB_NAME=user_preferences`, own volume (`docker-compose.yml:13–17,27–36`) — NOT the shared DIGIT DB. "No DDL" still requires this service to be deployed and reachable in the target env. |
| Configurator generic MDMS resource registration | **EXISTS** — declarative registry | `resourceRegistry.ts:21` `export const REGISTRY: Record<string, ResourceConfig>`; e.g. `'auto-escalation-ignore': { type:'mdms', schema:'Workflow.AutoEscalationStatesToIgnore', idField:'businessService', nameField:'businessService' }` (`:121`). `getGenericMdmsResources()` returns every `type==='mdms' && !dedicated` entry (`:150–156`). `AdvancedPage` enumerates them via `getGenericMdmsResources()` (`CCRS/configurator/src/resources/advanced/AdvancedPage.tsx:7`) then `resources.map` (`:20`). **No `dss.*` entry exists.** |
| Configurator per-schema rich form descriptor | **EXISTS** — additive descriptor pattern | `schemaDescriptors/index.ts:12` `DESCRIPTORS` map; e.g. `autoEscalationIgnoreDescriptor` (`auto-escalation-ignore.ts:15`) wires a `string[]` field to the `chip-array` widget (`:26`). `MdmsResourceEdit` mounts a `customEditor` when set (`types.ts:51–55`). |
| Generic form for object-array fields (`tiles[]`) | **MISSING widget** | the bare form "silently skip[s] object/array fields" (`types.ts:6–7`); `WidgetKind` has `chip-array` for `string[]` only — **no object-array widget** (`types.ts:11–21`). So `tiles[]`/`layout` are **unauthorable** in the generic form; they need a `customEditor` (`types.ts:51–55`). |
| FE KPI catalog today | **client-side, authoritative** | design §5a "Today the dashboard FE *is* the KPI catalog … `kpiQueries.js`"; the FE decides which tiles render. This is what Part E + Part D invert. |

**Reading:** the MDMS-master plumbing (configurator registry + descriptor) and the preferences *table* both already exist and are generic enough to host packs/layout with **zero schema-engine changes** — only new declarative entries + one new `preference_code`. The genuinely new code is (a) the server-side pack read endpoint that ceiling-filters against Part D's `visibleTo`, (b) the `dss.DashboardPack` MDMS schema + seed, (c) a **custom editor** for the `tiles`/`layout` object fields (the generic form cannot author them), and (d) closing the **user-preferences IDOR** by fronting the store with a trusted-uuid path. The first two are additive over surfaces that already work; (c) and (d) are the load-bearing new work this revision surfaces.

---

## Design

### E.1 Data model — `dss.DashboardPack` (MDMS master)

One record per `(tenantId, role)`. MDMS v2 keys it by a unique identifier; we use `role` as the `x-unique` field (mirroring `auto-escalation-ignore`'s `businessService` being both unique and the record id — `auto-escalation-ignore.ts:22`).

```jsonc
// schemacode: dss.DashboardPack   (one record per role, per tenant; soft-deletable, versioned by MDMS)
{
  "role": "GRO",                       // x-unique → the record's identifier; matches a DIGIT role CODE
  "title": "Supervisor dashboard",     // localization code, resolved at edge (like KpiDefinition.title)
  "tiles": [                           // ordered list — order IS the default reading order
    { "kpiId": "open_backlog",     "kpiVersion": null },   // null ⇒ latest published (design §2 kpiVersion default)
    { "kpiId": "sla_compliance",   "kpiVersion": null },
    { "kpiId": "aging_trend",      "kpiVersion": null },
    { "kpiId": "my_ward_inflow",   "kpiVersion": null }
  ],
  "layout": {                          // DEFAULT grid only; per-user overrides live in preferences (E.3)
    "version": 1,                      // layout-schema version, for forward-compat of the grid shape
    "grid": [                          // OPAQUE to the backend (see Open Q5) — FE owns coordinate meaning
      { "kpiId": "open_backlog",   "x": 0, "y": 0, "w": 6, "h": 4 },
      { "kpiId": "sla_compliance", "x": 6, "y": 0, "w": 6, "h": 4 },
      { "kpiId": "aging_trend",    "x": 0, "y": 4, "w": 12, "h": 4 },
      { "kpiId": "my_ward_inflow", "x": 0, "y": 8, "w": 6, "h": 4 }
    ]
  }
}
```

Design choices, each load-bearing:

- **Keyed by role, not by user.** Packs are *role* config (curation), so a tenant authors O(roles) packs, not O(users) (design §5a). Per-user state is the *override* in E.3.
- **`tiles` is the authority for membership; `layout.grid` is presentation.** A `kpiId` present in `layout.grid` but absent from `tiles` is ignored (defensive — drift); a `kpiId` in `tiles` but missing from `grid` is auto-placed by the FE at the end (append). This mirrors the query/viz split the KPI def already uses ("Query-shape is what to fetch; viz-config is how to draw" — design §0.6).
- **`kpiVersion: null ⇒ latest`** matches the runtime default at `dashboard-query-api-design.md:58` (`kpiVersion … default = latest published`). A pack MAY pin a version so a curated dashboard doesn't drift when a KPI is re-published (design §3a immutable versioning).
- **`layout.grid` is an opaque JSON blob to the backend.** The backend stores and serves it; it does not parse `{x,y,w,h}` or assume a 12-column grid library. This keeps the backend free of a specific FE grid-library coordinate system (see Open Q5, leaning resolved-opaque).
- **No `visibleTo` on the pack.** Deliberately absent. Visibility is Part D's ceiling; a pack listing an out-of-ceiling `kpiId` is not an error at author time and not a leak at read time — it is *dropped* at serve time (E.2 step 4) and yields `403 kpi_forbidden` if invoked directly (Part D's `disjoint(visibleTo, roles)` re-check, `40-kpi-catalog-governance.md:142`). This is the "mis-authored pack → no leak" guarantee (design §5a).

**Role-union for multi-role users (incl. HRMS pollution).** A real principal often holds several roles — and on real tenants *every* `GRO` also carries `PGR_LME` (memory [HRMS role pollution]; 00-requirements §7.2). The serve path therefore resolves **the union of the caller's role-packs**, then ceiling-filters per tile against Part D's published defs. Pack *membership* can never be wider than the union of what each role's pack lists, and ceiling-filtering closes the visibility door regardless. **Union ordering is made deterministic by a config-driven role priority** (resolving pass-1 Open Q3 — see E.2). Authoring/testing of packs must still use **clean single-role `RBAC_TEST_*` users** (plan §5; 00-requirements §7.2) so a pack's intent is provable without pollution noise.

### E.2 Pack read path — `POST /v2/analytics/packs` (new, server-side, ceiling-filtered)

A new endpoint on the same controller. It is **read-only**, returns the *resolved* pack for the caller, and is where Part E meets Part D: it imports D's `disjoint(visibleTo, roles)` check and applies it **per tile** so the FE only ever receives tiles the caller may actually invoke. `POST` (not `GET`) so `RequestInfo` rides in the body, consistent with `_query` (`AnalyticsController.java:41`) and with the existing pgr-services POST convention; this also matches Part D's recommendation to land discovery as a POST (`40-kpi-catalog-governance.md` M1, `:285`) rather than GET-with-body, which Kong can strip.

```java
// AnalyticsController.java — NEW endpoint, alongside _query (L40) and _schema (L57)
@PostMapping("/packs")   // POST to carry RequestInfo, matching _query's body convention (L41)
public ResponseEntity<Map<String,Object>> packs(@RequestBody JsonNode body){
    try {
        RequestInfo requestInfo = body.has("RequestInfo")
                ? mapper.convertValue(body.get("RequestInfo"), RequestInfo.class) : null;
        String tenantId = body.hasNonNull("tenantId") ? body.get("tenantId").asText() : null;
        // Part A precondition: requestInfo.userInfo is token-derived & trustworthy here,
        // AND A.4 (10-auth-foundation.md §A.4, :231) has already 403'd a body tenantId outside the
        // principal's allowed tenants. Until A lands, this endpoint is as spoofable as _query
        // (AnalyticsService.java:30-32) — it MUST NOT ship before A.
        Principal principal = principalOf(requestInfo);          // Part A Principal{uuid,type,roles,tenantId}
        Map<String,Object> resolved = packService.resolveForCaller(principal, tenantId);
        return ResponseEntity.ok(resolved);
    } catch (IllegalArgumentException e) {
        return ResponseEntity.badRequest().body(error(e));      // reuse existing error() L62
    } catch (Exception e) {
        log.error("pack resolve failed", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error(e));
    }
}
```

`principalOf(...)` is the **same Part A `Principal` builder Part D uses** (`40-kpi-catalog-governance.md:165,175`), reading `{uuid, type, roles[]}` off the trusted post-A `userInfo` — NOT a re-derive from raw `requestInfo`, and NOT a (nonexistent) `AnalyticsScope.rolesOf(ri)`. Part E and Part D share one principal-extraction path so both gate on the identical trusted role set.

`PackService.resolveForCaller` (new class; the orchestration this part owns):

```java
Map<String,Object> resolveForCaller(Principal principal, String tenantId){
    // 0. Part A: the principal is trustworthy (else fail-closed → empty pack, never a default-admin pack).
    Set<String> roles = principal.roles;                      // off the Part A Principal, not raw ri
    if (roles == null || roles.isEmpty()) return emptyPack(tenantId);  // FAIL-CLOSED: no roles ⇒ no tiles

    // 1. MDMS: fetch dss.DashboardPack for each role at this tenant (cached, short TTL — E.6).
    List<DashboardPack> packs = packRepo.byRoles(tenantId, roles);   // mdms v2 _search per role-code

    // 2. Union the tiles in a DETERMINISTIC order: iterate roles by config-driven rolePriority
    //    (Open Q3 resolved), de-dup by kpiId (first occurrence in priority order wins for ordering).
    LinkedHashMap<String,Tile> union = unionTiles(packs, rolePriority);

    // 3+4. Load each referenced KPI def from Part D's store (latest|pinned) and CEILING FILTER.
    //    Drop a kpiId that resolves to no published def (drift); drop a tile out of ceiling.
    List<ResolvedTile> tiles = new ArrayList<>();
    for (Tile t : union.values()){
        KpiDef def = catalogD.load(tenantId, t.kpiId, t.kpiVersion);    // Part D: KpiDefinitionStore.load (40-...:116)
        if (def == null) continue;                                      // drift: KPI gone → drop tile
        if (Collections.disjoint(def.visibleTo, roles)) continue;       // OUT OF CEILING → drop tile (40-...:142)
        tiles.add(ResolvedTile.of(t, def.viz, def.title));              // carry FULL viz JsonNode + title for FE
    }

    // 5. Default layout = merge of the surviving role-packs' opaque layout blobs, restricted to surviving tiles.
    Object defaultLayout = mergeLayouts(packs, tiles, rolePriority);    // deterministic, ordering from step 2

    return shape(tenantId, roles, tiles, defaultLayout);               // { tiles[], defaultLayout }
}
```

Why this shape:

- **Reuses Part D's *real* surface.** `KpiDefinitionStore.load(tenantId, kpiId, version)` returns a `KpiDef` whose public fields are `visibleTo`, `viz`, `title`, `params`, `freshness` (`40-kpi-catalog-governance.md:114,116,118–122`). There is **no `published(...)` method and no `vizSummary()`** — the tile carries `def.viz` (the full viz JsonNode D returns whole in `/catalog`, `40-…:186–187`) and `def.title`. The names now link against D as written.
- **Discovery is filtered, but invocation is still re-checked (defence in depth).** The served pack is `disjoint(visibleTo,roles)`-filtered (UX: don't show a tile you can't open), but Part D **still** re-checks the same predicate on the subsequent `POST /_query?kpiId=…` (design §5a "this re-check is the whole ballgame"; `40-…:142`). Pack filtering is *not* the security boundary; it is the curation surface. A caller who hand-crafts a `_query` for a tile the pack hid still hits Part D's `403 kpi_forbidden`.
- **Deterministic union order (Open Q3 resolved).** When a user holds `GRO` + `PGR_LME` and both packs list overlapping `kpiId`s in different orders, the union iterates roles by a **config-driven `rolePriority`** (an MDMS/`globalConfigs` ordered list), so the served default order — and the `mergeLayouts` output that keys off it — is stable across requests for a multi-role user. This is decided **before** step-6 seeds, not deferred.
- **Drop-not-error on drift.** A pack that references a since-archived KPI (Part D rolled "latest" back) drops that tile silently rather than failing the whole dashboard. A dashboard that 500s because one KPI was renamed is a worse failure than a missing tile.

### E.3 Per-user layout override — `digit-user-preferences-service` (with the identity-binding fix)

The pack's `layout` is a **default**. A user's personal arrangement is stored as a single preference record, using the **existing generic table unchanged**.

**New `preference_code`: `PGR_DASHBOARD_LAYOUT`.** No DDL — the table accepts any `preference_code VARCHAR(128)` (`V20260205120000__create_user_preference.sql:10`), keyed unique on `(user_id, COALESCE(tenant_id,''), preference_code)` (`:20–21`). One row per `(user, tenant)` holds the override payload in `payload JSONB` (`:11`). The API is the vendored Go service: write via `POST /user-preference/v1/_upsert`, read via `POST /user-preference/v1/_search` (`internal/routes/routes.go:33–34`), envelopes per `internal/model/models.go:127–137`; one idempotent `_upsert` per save (`preference_service.go:107`).

```jsonc
// user_preference row:
//   user_id = principal.uuid (coerced from token — see "Identity binding" below),
//   tenant_id = "ke.bomet", preference_code = "PGR_DASHBOARD_LAYOUT"
//   payload =
{
  "version": 1,                         // matches pack layout.version; bump → ignore stale overrides
  "packRoleKey": "GRO|PGR_LME",         // which role-union this override was authored against (drift guard)
  "overrides": {                        // SPARSE — only tiles the user actually moved/resized/hid
    "open_backlog":   { "x": 6, "y": 0, "w": 6, "h": 4 },
    "aging_trend":    { "hidden": true }     // user hid a tile they're still permitted to see
  }
}
```

**Identity binding (BLOCKING precondition — the store is IDOR-prone as shipped).** The user-preferences-service keys records on the **body** `userId`, not the token uuid: `Upsert` persists `req.Preference.UserId` (`preference_service.go:107`) and uses the token uuid only for audit `createdBy`/`lastModifiedBy` (`preference_service.go:104,115,119` via `preference_enricher.go:74–87`); `Search` filters on body `criteria.UserId` (`preference_repository.go:86–87`); validation merely requires *some* criterion (`preference_validation.go:81–86`). `test_apis.sh:226–239` shows a cross-user write (`another-user-456`) is accepted. **As-is, any caller can `_search`/`_upsert` another user's `PGR_DASHBOARD_LAYOUT` — and the same store also holds `USER_NOTIFICATION_PREFERENCES` consent, so the gap is broader than packs.** Part E therefore mandates one of two bindings, and the FE MUST NOT call `_search`/`_upsert` with an attacker-chosen `userId`:

- **(a) Gateway coercion (preferred).** The Kong route fronting `/user-preference` overwrites `preference.userId` and `criteria.userId` with the token-introspected uuid (the same coercion Part A applies to analytics `userInfo`). This is the cleanest: the store stays generic, every consumer benefits, and the IDOR closes for consent too.
- **(b) Backend-for-frontend.** The dashboard FE never talks to user-preferences directly; it reads/writes layout through a thin analytics-side passthrough that injects `principal.uuid` from the trusted `Principal` (E.2) before calling `_upsert`/`_search`. Narrower (covers only `PGR_DASHBOARD_LAYOUT`) but does not require a Kong change.

Either way, **the `userId` that reaches the store is the token uuid, never the body value.** This precondition is the reason E's "subtract-only" guarantee actually holds: without it, the personalization layer is an open IDOR. (Filed as a cross-cutting issue; the Kong-coercion option is owned jointly with Part A's gateway work.)

**Merge contract (default ⊕ override), computed FE-side after two reads:**

1. FE calls `POST /v2/analytics/packs` → `{ tiles[], defaultLayout }` (E.2).
2. FE reads its `PGR_DASHBOARD_LAYOUT` preference (`POST /user-preference/v1/_search`, `userId` coerced to the token uuid per binding above).
3. Effective grid = `defaultLayout.grid` with each entry **overlaid** by `overrides[kpiId]` when present; `hidden:true` removes the tile from render (but NOT from `tiles` — it can be un-hidden).
4. **Override is filtered through `tiles` (the ceiling-filtered set), never the other way.** An override referencing a `kpiId` no longer in `tiles` (lost the pack, lost the ceiling, KPI archived) is **dropped** — a stale personal layout can never resurrect a tile the backend already withheld. This is the fail-closed guarantee at the personalization layer: **preferences can subtract and rearrange, never add.** It is only sound *given the identity binding above*; a spoofable store would let a user read/seed someone else's layout, but even then the ceiling filter at serve time means it cannot widen *visibility* — the binding closes the privacy/integrity leak, the ceiling closes the access leak.

**Why preferences, not MDMS (the ownership line):** layout overrides are (a) per-user (O(users)), (b) high-churn (every drag), (c) not security-relevant, and (d) not config a tenant admin curates. MDMS is for *governed, audited, versioned tenant config* (design §3a publish pipeline); routing per-drag writes through that pipeline would be absurd. 00-requirements §5 fixes this: "Layout/personalization → user-preferences-service, **not** MDMS." Part E honours that line by storing **only the default** in MDMS and **only the delta** in preferences.

### E.4 Configurator admin surface — registering the masters

Both new masters become managed resources with **declarative-only** registry changes (no engine code). The `tiles`/`layout` *fields*, however, are object/object-array shapes the generic form cannot author — they need a `customEditor` from day one (see below).

**(a) Registry entries** — append to `REGISTRY` in `configurator/packages/data-provider/src/providers/resourceRegistry.ts:21` (the file that holds `auto-escalation-ignore` at `:121`):

```ts
'dashboard-pack':   { type: 'mdms', label: 'Dashboard Packs',
                      schema: 'dss.DashboardPack',   idField: 'role',  nameField: 'role' },
'kpi-definition':   { type: 'mdms', label: 'KPI Definitions',     // (Part D's master; registered here as its admin surface)
                      schema: 'dss.KpiDefinition',   idField: 'id',    nameField: 'title' },
```

Because neither carries `dedicated: true`, both flow automatically through `getGenericMdmsResources()` (`resourceRegistry.ts:150–156`) and appear on `AdvancedPage` (which enumerates via `getGenericMdmsResources()` at `CCRS/configurator/src/resources/advanced/AdvancedPage.tsx:7`, then `resources.map` at `:20`) and the generic list/show/create/edit pages (`MdmsResourcePage.tsx`).

**(b) Rich-form descriptor + customEditor (required, not optional).** Add `dashboard-pack.ts` to `configurator/src/admin/schemaDescriptors/` and register it in `index.ts:12` (the `DESCRIPTORS` map). Critically, **`tiles[]` is an array of *objects* (`{kpiId, kpiVersion}`), and `WidgetKind` has no object-array widget** — `chip-array` is `string[]`-only (`types.ts:11–21`), and the bare form "silently skip[s] object/array fields" (`types.ts:6–7`). So the generic registry entry alone yields CRUD over **`role`/`title` only**; `tiles`/`layout` are **unauthorable** until the `customEditor` ships. The `dashboardPackEditor` is therefore part of the **MVP**, not a deferred nicety (this corrects the prior plan, where step 2 was wrongly called a "usable interim" for the parts that matter):

```ts
// configurator/src/admin/schemaDescriptors/dashboard-pack.ts
export const dashboardPackDescriptor: SchemaDescriptor = {
  schema: 'dss.DashboardPack',
  groups: [
    { title: 'Binding', fields: ['role', 'title'] },
    { title: 'Tiles',   fields: ['tiles'] },
    { title: 'Default layout', fields: ['layout'] },
  ],
  fields: [
    { path: 'role',  widget: 'text', required: true,
      help: 'Must match a DIGIT role CODE (e.g. GRO). Becomes the record identifier.' },
    { path: 'title', widget: 'text' },
    // tiles[] is object-array; layout is a nested object — neither is expressible in the generic
    // form (no object-array WidgetKind; types.ts:11-21). Both are handled by the customEditor below.
  ],
  customEditor: 'dashboardPackEditor',   // registered like the ThemeConfig editor (types.ts:51-55) — drag-grid + KPI picker
};
```

The `customEditor` escape hatch (`types.ts:51–55`) is the right and *necessary* call for `tiles`/`layout` — exactly the "JSON Schema alone can't express richly" case the descriptor system documents (`types.ts:1–8`), matching how `ThemeConfig` opted into its editor (memory [ThemeConfig v1/v2/v3]). The KPI picker inside it is **fed by Part D's discovery endpoint** (the catalog `_search` Part D lands per `40-…` M1) so an admin can only add `kpiId`s that exist and are visible at the editing tenant — closing the "pack references a non-existent KPI" drift at author time (still drop-safe at serve time per E.2).

### E.5 Control flow (end-to-end)

```
Admin (configurator)                 Citizen/Supervisor (dashboard FE)
─────────────────────                ──────────────────────────────────
edit dss.DashboardPack    ┐          POST /v2/analytics/packs  (RequestInfo)
  (customEditor — REQUIRED│            └─► [Part A.4: tenant cross-check, 403 on mismatch]
   for tiles/layout; KPI  │            └─► principalOf(ri)  ← SAME Part A Principal as Part D
   picker from D's catalog│            └─► PackService.resolveForCaller(principal, tenant)
   _search)               │                 1. roles ← Principal.roles (empty ⇒ empty pack, fail-closed)
   → mdms_create/_update  │                 2. mdms v2 _search dss.DashboardPack by each role
                          ▼                 3. union tiles by rolePriority (deterministic), de-dup
              MDMS (dss.DashboardPack,       4. per tile: KpiDefinitionStore.load (Part D, 40-...:116),
               dss.KpiDefinition)               keep iff !disjoint(visibleTo, roles)  ← CEILING (40-...:142)
                                             5. mergeLayouts (opaque blobs) → defaultLayout
                                          ◄── { tiles[]:{kpiId,version,title,viz}, defaultLayout }
                                          POST /user-preference/v1/_search (PGR_DASHBOARD_LAYOUT)
                                              userId COERCED to token uuid (gateway/BFF — E.3)
                                          ◄── { overrides }  (or empty ⇒ {})
                                          FE: effective = defaultLayout ⊕ overrides
                                              (overrides filtered through tiles — subtract only)
                                          per tile → POST /v2/analytics/_query?kpiId=…
                                              └─► Part D re-checks disjoint(visibleTo,roles) (403 if forbidden)
                                              └─► Parts B/C inject row scope (attrScopes)
       user drags a tile ──────────────► POST /user-preference/v1/_upsert (sparse overrides)
                                              userId COERCED to token uuid (gateway/BFF — E.3)
```

The pack endpoint resolves **catalog membership**; `_query` resolves **data + ceiling re-check + row scope**; preferences resolve **personal arrangement**. Three reads, three owners, no layer doing another's job.

---

## Interfaces with other parts

**Inputs consumed:**

| From | Contract consumed | Used for |
|---|---|---|
| **Part A** (trust foundation) | the `Principal{uuid, type, roles[], tenantId}` (A.5, `10-auth-foundation.md:225–230`), token-derived & vouched; **A.4 tenant cross-check** (`:207`) having already 403'd an out-of-tenant body | picking which role-packs to union (off `Principal.roles`, NOT raw `ri` and NOT a nonexistent `AnalyticsScope.rolesOf`); keying preferences by the real `Principal.uuid`. If A is not in, `/packs` is as spoofable as `_query` (`AnalyticsService.java:30-32`) and MUST NOT ship; it fails closed to an empty pack on empty roles, never a default. |
| **Part D** (KPI catalog access) | `KpiDefinitionStore.load(tenantId, kpiId, version)` → `KpiDef{visibleTo, viz, title, params, freshness}` (`40-kpi-catalog-governance.md:116,118–122`); the shared `disjoint(visibleTo, roles)` predicate (`:142`); D's catalog discovery endpoint for the picker (D's POST `_search` per `:285`) | per-tile ceiling filter (E.2 steps 3–4) carrying `def.viz`/`def.title`; the configurator KPI picker (E.4b). **Tightest coupling in Part E — E reuses D's *exact* `load`/`KpiDef`/`disjoint` surface; there is no `published()` or `vizSummary()`.** |

**Outputs produced:**

| To | Contract produced |
|---|---|
| **Dashboard FE** | `POST /v2/analytics/packs` → `{ tiles[]:{kpiId, version, title, viz}, defaultLayout }`, already ceiling-filtered (`viz` is D's full viz JsonNode; `defaultLayout` is an opaque FE-owned blob). The FE becomes a thin renderer (design §5a "authority moves to the backend"); it no longer decides tile membership. |
| **Dashboard FE** | `PGR_DASHBOARD_LAYOUT` preference namespace, the **subtract-only merge contract** (E.3), and the rule that all preference calls go through the token-uuid-coerced path (gateway or BFF), never with a body `userId`. |
| **Part A / gateway** | a requirement: **coerce `preference.userId`/`criteria.userId` to the token uuid** on the `/user-preference` route (the IDOR fix, E.3 option (a)). Owned jointly — Part A's gateway-coercion machinery, Part E's preference route. |
| **Part F** (inline gating) | *No coupling.* Packs only ever name published `kpiId`s; F gates inline grammar, which packs never carry. Listed for completeness: a pack can never be a vector for inline queries. |
| **Configurator admin** | two new `REGISTRY` entries + one descriptor + the **required** `dashboardPackEditor` customEditor (for `tiles`/`layout`). |

**Non-interfaces (explicit):** Part E does **not** consume Parts B/C `attrScopes` — packs are scope-blind; a tile is included/excluded by *visibility*, never by whether its rows are empty under the caller's jurisdiction/department. (A `GRO` for an empty ward still gets the `open_backlog` tile; it just renders zero.)

---

## Sequencing & migration steps

Strict order — each step is independently shippable as a one-concern PR against egov/CCRS `develop`, validated on ovh-cloud-dev (bomet repro) before live (plan §5/§6.5).

1. **(blocked on Part A + Part D)** Land the `dss.DashboardPack` MDMS **schema** (`mdms_schema_create`) with `role` as `x-unique`, `tiles`/`layout` typed objects. No serving code yet.
2. **Register both masters in the configurator** (`resourceRegistry.ts` entries + `dashboard-pack.ts` descriptor + `index.ts` wiring) **together with the `dashboardPackEditor` customEditor**. The generic form authors only `role`/`title` (no object-array widget for `tiles[]` — `types.ts:11–21`), so the editor is part of this step, not a later one. After this, admins have full pack CRUD via `AdvancedPage`/`MdmsResourcePage`.
3. **Build `POST /v2/analytics/packs`** + `PackService.resolveForCaller`, consuming the shared Part A `Principal` and Part D's `KpiDefinitionStore.load` / `disjoint(visibleTo,roles)`. Ceiling-filter per tile. Deterministic union ordering via `rolePriority`. Cache (E.6).
4. **Define `PGR_DASHBOARD_LAYOUT`** preference usage — no DDL (table exists, `V20260205120000__…sql`). **Prerequisites for this step:** (i) confirm the `digit-user-preferences-service` is **deployed and reachable** in the target env — it runs against its *own* Postgres `DB_NAME=user_preferences` (`docker-compose.yml:13–17,27–36`), a distinct datastore from the shared DIGIT DB and per memory historically thin on live boxes; (ii) **land the identity-binding coercion** (E.3 option (a) gateway, or (b) BFF) so the store keys on the token uuid, not the body `userId` (`preference_service.go:107`). Only then wire the FE read/merge/write against `_upsert`/`_search` (`routes.go:33–34`).
5. *(folded into step 2 — the customEditor is MVP, not a late add).*
6. **Seed default packs** per role (`CITIZEN`, `GRO`, `PGR_ADMIN`, `SUPERADMIN`) as MDMS records, via tenant_bootstrap (memory [MCP is the bootstrap layer] — seeding owns tenant content; do NOT write ansible tasks for pack content). Decide `rolePriority` (E.2) **before** seeding so default ordering is stable. Author/test with `RBAC_TEST_*` single-role users (plan §5).
7. **Flip the FE** from client-side `kpiQueries.js` tile selection to the `packs` endpoint. The inversion (design §5a "Today vs Moves to") lands only after steps 1–4, 6 are green so the FE never has a window with no server-side packs to read.

**Migration of existing dashboards:** the current FE hardcodes tiles per role (design §5a). Step 6's seeds must reproduce *today's* per-role tile sets exactly (a faithful port, not a redesign — memory [Feliciano] "codify the proven flow, never the aspirational one"), so the step-7 flip is behaviour-preserving. Any *new* curation is a follow-up after parity is proven.

---

## Risks, edge cases, failure modes

- **Fail-closed on no/forged roles.** If Part A is absent or the principal carries no roles, `resolveForCaller` returns an **empty pack** (E.2 step 0), never a default/admin pack. A pack endpoint that defaulted to `PGR_ADMIN`'s pack on an unauthenticated call would be a catalog-disclosure leak. Negative test (mirroring plan §5 spoof test): a forged-admin body returns an empty or citizen pack, never the admin tile set. **And `/packs` MUST NOT ship before Part A** — until A lands, the body `userInfo`/`tenantId` are trusted exactly as `_query` trusts them today (`AnalyticsService.java:30-32`).
- **user-preferences IDOR (the load-bearing store gap).** The preference store keys on body `userId` (`preference_service.go:107`; `preference_repository.go:86–87`), not the token uuid — `test_apis.sh:226–239` proves cross-user writes are accepted. Part E's subtract-only/privacy guarantees are real only **after** the E.3 identity-binding coercion (gateway or BFF). This is called out as a blocking precondition of step 4 and as an output requirement to Part A/gateway, not buried. The same store holds consent (`USER_NOTIFICATION_PREFERENCES`), so the fix benefits more than packs.
- **Mis-authored pack referencing an out-of-ceiling KPI → no leak.** The per-tile ceiling filter (E.2 step 4) drops it at serve via `disjoint(visibleTo,roles)`; Part D re-checks the same predicate at invocation (`40-…:142`). Two independent gates; a pack edit can never widen access. Test: author a pack listing `officer_leaderboard` (visibleTo excludes `GRO`) into the `GRO` pack → `GRO` caller's `/packs` omits it, and a direct `_query` for it returns `403 kpi_forbidden`.
- **HRMS role pollution inflating the union.** Because every `GRO` also holds `PGR_LME` (00-requirements §7.2), the role-union pulls in `PGR_LME`'s pack tiles. This is *contained* by the ceiling filter (a tile survives only if `!disjoint(visibleTo, {GRO,PGR_LME})`, correct — the user genuinely holds both), but a pack authored for "pure GRO" is not what a polluted GRO sees. Mitigation: author/test against clean `RBAC_TEST_*` users; pollution is a provisioning bug to fix in HRMS, not in packs.
- **Nondeterministic default order (resolved).** A multi-role user's union order is now fixed by config-driven `rolePriority` (E.2 step 2), so the served `defaultLayout` and `mergeLayouts` output are stable across sessions. The decision lands before step-6 seeds. Pass-1 flagged this as an unresolved open question; it is now a design decision, not a deferral.
- **Stale per-user override resurrecting a withheld tile — prevented.** Overrides are filtered through the ceiling-filtered `tiles` set (E.3 step 4): preferences **subtract and rearrange, never add**. A user who lost a role and kept a stale `PGR_DASHBOARD_LAYOUT` cannot see the tile — its key isn't in `tiles`, so it's dropped. `packRoleKey`/`version` let the FE detect a role-set change and reset.
- **Tenant isolation — owned by Part A.4, not assumed here.** Packs are MDMS records at a tenant; `mdms_search` is per-tenant. The body `tenantId` is cross-checked against the principal's allowed tenants by **Part A.4** (`10-auth-foundation.md` §A.4, `:231`) — this guard does **not** exist on `_query` today (`AnalyticsService.java:30-32` does no membership check), so Part E *depends on* A.4 landing and does not present the check as already-true. Preferences are keyed `(user_id, tenant_id, preference_code)` (`V20260205120000__…sql:20`) so a `ke.bomet` layout never bleeds into `ke.nairobi`. **Gotcha:** the unique index uses `COALESCE(tenant_id,'')` — a NULL-tenant layout collides across tenants; **always write `PGR_DASHBOARD_LAYOUT` with an explicit `tenant_id`**, never global. (Note A.4's own pass-1 caveat: its `startsWith` prefix check is un-anchored — `10-auth-foundation.md:337`; Part E inherits whatever final policy A.4 ships and does not widen it.)
- **Jurisdiction/department isolation is NOT a pack concern — and must not become one.** Packs are role-keyed and scope-blind by design. Row isolation is Parts B/C's `attrScopes`. The risk to guard against is "optimizing" by hiding tiles whose rows are empty for a caller's jurisdiction — that would leak *which* jurisdictions have data via tile presence. Tiles are included by visibility only; emptiness is rendered, never hidden.
- **Drift between `tiles` and `layout.grid`.** Authoring lets the two diverge. Serve-time reconciliation (E.1: `tiles` is authority, `grid` is overlay, missing grid → append) degrades gracefully to "tile shows, default-placed," never a crash. A configurator validation warning (not a hard block) on save is a nice-to-have.
- **Cache-key correctness.** The resolved pack is cacheable, but the cache key **must include the role-set** (and tenant), exactly as the `_query` cache key includes resolved scope (00-requirements §6 "Resolved scope is part of the cache key … never serve a cached row across scope boundaries"). A pack cached under `{tenant, GRO}` must never be served to `{tenant, PGR_ADMIN}`. Short TTL because `visibleTo`/pack edits are no-deploy and should propagate quickly (MDMS edits can desync caches — memory [localization redis cache]).
- **user-preferences-service availability.** If the preferences read fails, the FE falls back to `defaultLayout` (treat as "no overrides") — degraded but functional. A preferences outage must never blank the dashboard; the pack endpoint (the authority) is independent of preferences — and, per step 4, that service runs in a *separate* container/DB that must actually be deployed in the target env.

---

### Open questions for review

1. **Identity-binding ownership split.** E.3 mandates coercing `preference.userId`/`criteria.userId` to the token uuid (closing the `preference_service.go:107` IDOR). Option (a) gateway-coercion is cleaner and fixes consent too, but it lives in Part A's gateway surface; option (b) BFF is self-contained to analytics but narrower. Confirm whether the Kong `/user-preference` coercion is taken on by Part A's gateway work (preferred) or Part E ships the BFF as a stopgap.
2. **MDMS key for the pack — `role` alone, or `(module, role)`?** Using `role` as `x-unique` assumes one PGR pack per role per tenant. If packs ever span modules, the key needs `(module, role)`. Lock PGR-only scope now or future-proof the key?
3. **`rolePriority` source.** The deterministic union ordering (E.2) needs an ordered role list. MDMS master vs `globalConfigs` ordered array vs a per-tile `order` int on the pack — pick the source before step-6 seeds. (Direction set: deterministic ordering is required; only the *source* is open.)
4. **Should `/packs` and Part D's catalog discovery be one endpoint or two?** D's catalog returns *all* visible KPIs (the picker source); `/packs` returns the *curated default* subset + layout. They share the `disjoint` filter. Two endpoints keep responsibilities clean but double round-trips; a combined `POST /v2/analytics/dashboard/_bootstrap` is the alternative. Confirm split vs combined (and align both on POST, per Part D M1).
5. **Layout grid opacity (leaning resolved-opaque).** E.1 treats `layout.grid` as an opaque blob the backend round-trips; the FE owns `{x,y,w,h}` meaning. Confirm the backend should not encode a grid-library coordinate system. Leaning yes (opaque).
6. **KPI-picker def-resolution tenant.** KPI defs may resolve at the state root (like ServiceDefs — memory [PGR onboarding tenant gotchas]) while packs are authored at a city. The configurator picker must query D's catalog at the tenant where defs actually resolve, or it shows an empty KPI list. Confirm the def-resolution tenant for the picker.

---

## v2 revision log (pass-1 findings → resolution)

- **[blocker] user-preferences-service is fully user/tenant-spoofable (IDOR), undermining E.3's "subtract-only" guarantee at the store it depends on.** Confirmed against source: `Upsert` keys on body `req.Preference.UserId` (`preference_service.go:107`), token uuid used only for audit (`preference_service.go:104,115,119`; `preference_enricher.go:74–87`); `Search` filters on body `criteria.UserId` (`preference_repository.go:86–87`); validation requires only *some* criterion (`preference_validation.go:81–86`); `test_apis.sh:226–239` shows cross-user writes accepted. **Resolved:** E.3 now carries a **blocking identity-binding precondition** — the `userId` reaching the store MUST be the token uuid via (a) Kong gateway coercion (preferred, also fixes `USER_NOTIFICATION_PREFERENCES` consent) or (b) an analytics BFF; the FE is forbidden from calling `_search`/`_upsert` with a body `userId`. Added as a step-4 prerequisite, a Risks bullet, an Outputs requirement to Part A/gateway, and Open Q1. The gateway option is **co-owned with Part A**; Part E owns the route requirement and the BFF fallback.
- **[blocker] E.2/Risks cited a `_query` tenant-cross-check that does not exist.** Confirmed: `AnalyticsService.query()` (`AnalyticsService.java:30–32`) and `AnalyticsScope.resolve()` (`AnalyticsScope.java:31–48`) do no tenant-membership validation. **Resolved:** re-anchored throughout — the tenant cross-check is now attributed to **Part A.4** (`10-auth-foundation.md:207`), explicitly stated as *not present today*, and listed as a "Current code reality" MISSING row. Part E depends on A.4 and does not present isolation as already-true. (A.4's own un-anchored-`startsWith` caveat, `10-auth-foundation.md:337`, is noted; Part E inherits A.4's final policy, does not widen it.) **Owner for the actual check: Part A.4.**
- **[major] `AnalyticsScope.rolesOf(ri)` does not exist; the "reuse" was overstated.** Confirmed: `AnalyticsScope` exposes only `tenantId`/`tenantStateLevel`/`citizenUuid`/`boundaryPrefix` (`AnalyticsScope.java:21–24`); roles are consumed in the private `resolve()` loop (`:38–44`) and discarded. **Resolved:** removed all `rolesOf(ri)` references. Part E now reads `{roles}` off the **Part A `Principal`** via the *same* `principalOf(...)` builder Part D uses (`40-kpi-catalog-governance.md:165,175`), off trusted post-A userInfo — never re-derived from raw `ri`. Added a MISSING row documenting the absent accessor.
- **[major] Open Question 1 was answerable from the tree — the service is vendored, not "not in this tree."** Confirmed full Go source in-tree. **Resolved:** the design now answers it from source — routes `_upsert`/`_search` (`routes.go:33–34`), envelopes (`models.go:127–137`), idempotent upsert on `(userId,tenantId,preferenceCode)` (`preference_service.go:107`; `preference_repository.go:54–76`). The "Current code reality" table row now reads VENDORED with confirmed verbs (DIGIT `_upsert`/`_search`, not REST `PUT`); the old blocking Open Q1 is replaced by the (different) ownership-split Open Q1.
- **[major] Separate physical database / deployment surface unaddressed.** Confirmed: own `postgres:15-alpine`, `DB_NAME=user_preferences`, own volume (`docker-compose.yml:13–17,27–36`). **Resolved:** added a "Current code reality" row and a **step-4 prerequisite** that the `digit-user-preferences-service` (distinct datastore, historically thin on live boxes) must be deployed and reachable; the availability Risks bullet now references the separate container/DB.
- **[minor] `AdvancedPage.tsx:20` citation is the `.map`, not the data source.** Confirmed: `getGenericMdmsResources()` is at `AdvancedPage.tsx:7`, `resources.map` at `:20`. **Resolved:** all references now cite `:7` for the data source (with `:20` noted as the map), in both the table and E.4(a).
- **[minor] Generic create form cannot author `tiles`/`layout`; step 2's "usable interim" was overstated.** Confirmed: `tiles[]` is an object-array, `WidgetKind` has `chip-array` (`string[]`) only and no object-array widget (`types.ts:11–21`), bare form skips object/array fields (`types.ts:6–7`). **Resolved:** the `dashboardPackEditor` customEditor is now **MVP, folded into step 2** (old step 5 removed); E.4(b) states the generic form authors only `role`/`title` and the editor is required for `tiles`/`layout`. Added a MISSING row.
- **[interface] Part D coupling assumed APIs D hasn't committed to (`published(...)`, `vizSummary()`).** Confirmed D's real surface: `KpiDefinitionStore.load(tenantId, kpiId, version)` → `KpiDef{visibleTo, viz, title, params, freshness}` (`40-kpi-catalog-governance.md:114,116,118–122`), `viz` returned whole (`:186–187`), shared `disjoint(visibleTo, roles)` (`:142`). **Resolved:** E.2 now calls `catalogD.load(...)`, reads `def.visibleTo`/`def.viz`/`def.title` (no `vizSummary` projection), and uses `Collections.disjoint`; the Interfaces table reflects D's `load`/`KpiDef`/`disjoint` exactly. The picker is fed by D's POST catalog `_search` (per D's M1, `:285`).
- **[interface] Union-then-ceiling-filter is sound, but the ordering question was real and unresolved.** Confirmed two-gate soundness vs D's per-invocation `disjoint` (`40-…:142`). **Resolved:** E.2 now fixes union order via a config-driven `rolePriority` (decided before step-6 seeds); the nondeterminism Risks bullet records it as resolved; Open Q3 narrows to only the *source* of `rolePriority`.
- **[interface] Empty-pack fail-closed read roles off `ri`, not a `Principal`, bypassing the trust boundary.** Confirmed Part D wires roles into a `Principal` off trusted post-A userInfo (`40-kpi-catalog-governance.md:165`). **Resolved:** `resolveForCaller` now takes the Part A `Principal` and fails closed on `principal.roles` empty; the controller builds it via the shared `principalOf(...)`, not raw `ri`. Inputs table cites the A.5 `Principal` contract (`10-auth-foundation.md:225–230`).

*Not fixable inside Part E (named for the owner):* the **actual** Kong-coercion implementation for the preference-route IDOR and the **tenant cross-check** are Part A / gateway deliverables (Part A.4, `10-auth-foundation.md:207`) — Part E specifies the requirement and the contract it consumes but cannot land the gateway change here; the BFF fallback (option (b)) is the only piece Part E can ship unilaterally.

### v3 corrections (pass-3 codex fact-check, 2026-06-23)

Two mis-citations caught by the pass-2 codex review, corrected in place (live design body only; the v2-log and codex-review blocks above are left as historical record):

- **`AdvancedPage.tsx` cited without its real path.** The real file is `CCRS/configurator/src/resources/advanced/AdvancedPage.tsx` (not under `src/admin`); `getGenericMdmsResources()` is at `:7`, `resources.map` at `:20`. Corrected the full repo-relative path in the "Current code reality" table and in E.4(a). Line numbers were already right; only the path prefix was missing.
- **Part A.4 cross-reference pointed at `10-auth-foundation.md:207`.** File 10 was revised in pass-2 and line numbers shifted: `:207` is now the controller's `UnauthenticatedException`/401 catch, while the **A.4 tenant cross-check** section heading (`### A.4 — Tenant cross-check`) is at `:231`. Re-pointed the live references (Depends-on, the `_query` MISSING row, the E.2 controller comment, and the tenant-isolation Risks bullet) to `10-auth-foundation.md` §A.4 (`:231`), preferring the section name over the brittle line number.

## Codex review (pass 2 — gpt-5.5, verdict: needs-rework)

> External adversarial review via `codex exec`, read-only, verifying the v2 revision log against the actual code. **Note:** codex evaluated "resolved" as "patched in code"; this is a *design* doc (no code changed yet), so most `actuallyResolved:false` items mean "design specifies it, code not yet written," not "design wrong." Read the findings for genuine design errors vs. implementation-status notes.


**Summary:** Most v2 citations are grounded, but the user-preferences fix is only a userId precondition and leaves tenant-scoped preference access spoofable. Several claimed interfaces are still design-only and do not exist in the actual analytics package.


### Resolution check (8/10 confirmed in code)

- ❌ **[blocker] user-preferences-service is fully user/tenant-spoofable IDOR.** — UserId spoofing is correctly evidenced and called out, but the proposed binding only coerces userId. Actual code still accepts body tenantId on upsert/search, so the tenant half remains unresolved.
- ✅ **[blocker] E.2/Risks cited a _query tenant-cross-check that does not exist.** — Actual code has no tenant membership validation: AnalyticsController reads body tenantId and AnalyticsService passes it to AnalyticsScope. v2 now treats A.4 as future/blocking, not present.
- ✅ **[major] AnalyticsScope.rolesOf(ri) does not exist.** — Actual AnalyticsScope only exposes tenantId, tenantStateLevel, citizenUuid, boundaryPrefix, and discards roles after local inspection. v2 no longer relies on rolesOf.
- ✅ **[major] user-preferences-service was treated as not in-tree.** — Actual Go/Gin source is in-tree, with POST /v1/_upsert and /v1/_search plus the documented request envelopes.
- ✅ **[major] Separate physical DB/deployment surface unaddressed.** — Actual docker-compose uses a separate postgres:15-alpine service and DB_NAME=user_preferences; v2 now documents this as a deployment prerequisite.
- ✅ **[minor] AdvancedPage.tsx:20 citation is the map, not the data source.** — Actual data source is getGenericMdmsResources at AdvancedPage.tsx:7 and resources.map at :20. v2 cites both roles correctly, though it omits the real path prefix src/resources/advanced.
- ✅ **[minor] Generic form cannot author tiles/layout; usable interim overstated.** — Actual descriptor types only have chip-array for string arrays and MdmsResourceEdit skips unhandled object values. v2 makes dashboardPackEditor required in step 2.
- ✅ **[interface] Part D coupling assumed uncommitted APIs published(...) and vizSummary().** — v2 now references the Part D design surface KpiDefinitionStore.load, KpiDef.visibleTo/viz/title, and disjoint. Caveat: none of these classes exist yet in actual analytics code.
- ❌ **[interface] Union-then-ceiling-filter ordering was unresolved.** — v2 requires config-driven rolePriority but still leaves its source open. That is not an implementable interface yet and no rolePriority config/code exists.
- ✅ **[interface] Empty-pack fail-closed read roles off ri, bypassing Principal.** — v2 changes the proposed PackService signature to accept Part A Principal and fail closed on principal.roles empty. Caveat: Principal/PackService are not present in actual code.

### Findings

- **[BLOCKER] Preference tenant spoofing remains unresolved** — The v2 log frames the user-preferences IDOR as user/tenant spoofing, but the proposed fix only coerces userId. Actual upsert/search still use tenantId supplied in the request body, so a caller can target another tenant's PGR_DASHBOARD_LAYOUT for the same coerced user unless the gateway/BFF also validates or overwrites tenantId.  
  _evidence:_ `CCRS/backend/digit-user-preferences-service/internal/model/models.go:76-78 exposes body userId/tenantId; CCRS/backend/digit-user-preferences-service/internal/service/preference_service.go:107 keys upsert with req.Preference.TenantId; CCRS/backend/digit-user-preferences-service/internal/repository/preference_repository.go:89-93 filters search by body criteria.TenantId/preferenceCode.`
- **[MAJOR] Preference search can enumerate by tenant or code without user binding** — Search validation allows any one of userId, tenantId, or preferenceCode. Combined with repository filters, a caller can search tenant-wide or preference-code-wide records unless a fronting layer injects both userId and tenant constraints. v2 forbids attacker-chosen userId but does not require rejecting userId-less searches.  
  _evidence:_ `CCRS/backend/digit-user-preferences-service/internal/validation/preference_validation.go:81-85 accepts criteria with only tenantId or preferenceCode; CCRS/backend/digit-user-preferences-service/internal/repository/preference_repository.go:83-94 applies only the provided filters.`
- **[MAJOR] Pack/KPI interfaces are still design-only, not actual analytics code** — The design now names Principal, PackService, KpiDefinitionStore, /packs, and catalog load/disjoint APIs, but the actual analytics package contains only AnalyticsCatalog, AnalyticsController, AnalyticsPlanner, AnalyticsScope, and AnalyticsService. Treat these as new implementation work, not verified reusable code.  
  _evidence:_ `CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsController.java:40-58 only maps /_query and /_schema; actual file list under CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics contains no Principal, PackService, or KpiDefinitionStore.`
- **[MAJOR] Actual analytics tenant trust gap still blocks /packs shipment** — v2 correctly reclassifies tenant cross-check as a Part A precondition, but the actual service still trusts body tenantId. Any pack endpoint implemented before A.4 would read tenant-scoped MDMS/preferences for an attacker-chosen tenant.  
  _evidence:_ `CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsController.java:43-47 converts body RequestInfo and tenantId directly; CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsService.java:30-32 resolves scope from that tenantId without membership validation; CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsScope.java:31-48 performs no tenant cross-check.`
- **[MAJOR] Layer-1 grain leaks remain in actual code and packs must not mask them** — Part E is scope-blind by design, but actual row-scope code still has known gaps: daily has no citizenColumn, so citizen self-scope is skipped, and events lacks department_code. Any citizen/department-visible KPI or pack tile over those grains must be blocked by Parts C/D before E ships.  
  _evidence:_ `CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsPlanner.java:246 only applies citizen scope when g.citizenColumn != null; CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsCatalog.java:98-108 defines daily citizenColumn as null; CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsCatalog.java:80-96 events grain has no department_code.`
- **[MINOR] AdvancedPage path is mis-cited/incomplete** — The line numbers are correct after v2, but the file is not under src/admin as implied by the reviewed surface. The actual file is under src/resources/advanced.  
  _evidence:_ `CCRS/configurator/src/resources/advanced/AdvancedPage.tsx:7 defines resourceMap from getGenericMdmsResources; CCRS/configurator/src/resources/advanced/AdvancedPage.tsx:20 maps resources.`

### Mis-citations

- db-inventory/rbac-deep-design/50-packs-config-ownership.md cites AdvancedPage.tsx without the real path; actual path is CCRS/configurator/src/resources/advanced/AdvancedPage.tsx.
- db-inventory/rbac-deep-design/50-packs-config-ownership.md references Part A.4 at 10-auth-foundation.md:207, but the A.4 section starts at line 231; line 207 is the controller catch for UnauthenticatedException.

### Gaps

- No requirement to coerce or validate preference.tenantId/criteria.tenantId on the /user-preference route.
- rolePriority is required for deterministic ordering, but its source/schema is still open and no implementation/config exists.
- No actual /v2/analytics/packs endpoint, PackService, Principal, KpiDefinitionStore, dss.DashboardPack registry entry, dashboard-pack descriptor, or dashboardPackEditor exists yet.
