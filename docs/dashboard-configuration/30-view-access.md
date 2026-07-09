# 30 — Making the Dashboard View Reachable in digit-ui

`20-packs-and-rbac.md` governs what renders *inside* the dashboard. This doc covers the separate,
older DIGIT access-control surface that decides whether a user can *get to* it at all: the home
card, the module mount, and the sidebar entry. All of it is MDMS data — no rebuild — but it has
sharp edges (§5) and a multi-layer cache (§4).

## 1. `tenant.citymodule` — home card + module mount

File (seed): `ansible/nairobi-mdms/mdms/tenant/citymodule.json`

```jsonc
{ "tenantId": "ke",                       // MDMS owning tenant (state root)
  "data": {
    "code": "PGR",                        // module code — must match the FE module registration
    "module": "PGR",
    "order": 2,                           // home-card sort order
    "active": true,
    "tenants": [ { "code": "ke" }, { "code": "ke.nairobi" } ]   // tenants the module is on for
  } }
```

How digit-ui consumes it:

- Fetched during app init (`digit-ui-esbuild/packages/libraries/src/services/elements/MDMS.js`,
  master list includes `citymodule`).
- Filtered into `initData.modules` by
  `digit-ui-esbuild/packages/libraries/src/services/molecules/Store/service.js`:
  `active === true` AND `code ∈ enabledModules` (the build's enabled-module list), sorted by
  `order`.
- The employee home (`digit-ui-esbuild/packages/modules/core/src/components/Home.js`) renders one
  card per module by looking up the component registered as `` `${code}Card` `` in the component
  registry; the module's routes mount under the same code.

So: **no `citymodule` row (or `active:false`, or your tenant missing from `tenants[]`) = no home
card**, regardless of roles.

### 1a. Post-#1062 nuance: the dashboard route does NOT need a citymodule row

The general rule above is the *card* rule. The dashboard is special because #1062 embedded it as a
first-class product with an **always-on route fallback** (`70-esbuild-embedding.md` §3):

- The **route** `/employee/dashboard` is mounted by `AppModules.js` from the registered
  `DashboardModule` **whether or not** a `Dashboard` citymodule row exists — so the dashboard is
  always reachable by **deep link**. Role-gating is inside `DashboardModule`
  (`DASHBOARD_ROLES`, `70` §4).
- The **home card** *does* follow the citymodule rule: the employee home renders one card per
  entry in `initData.modules`, so the card appears only when a `Dashboard` citymodule row is
  present **and** `"Dashboard"` is in the build's `enabledModules` (it is — `App.js`).

Net: to give a role the dashboard **card**, add a `Dashboard` `tenant.citymodule` row (code
`Dashboard`, tenant in `tenants[]`, `active:true`). The **deep link** already works without it.
Neither depends on the sidebar (§2), which is a third, independent surface.

## 2. Actions + roleactions — the sidebar and role gating

Two masters in module scope `ACCESSCONTROL-*`:

**`ACCESSCONTROL-ACTIONS-TEST` / master `actions-test`** — the universe of navigable actions.
Seed: `ansible/nairobi-mdms/mdms/ACCESSCONTROL-ACTIONS-TEST/actions-test.json`. Entry shape:

```jsonc
{ "tenantId": "ke",
  "data": {
    "id": 1958,                            // numeric id — the cross-reference key
    "name": "rainmaker-common-dashboard",
    "url": "url",                          // "url" = sidebar link; "card" = home card entry
    "displayName": "Supervisor Dashboard",
    "orderNumber": 2,
    "enabled": true,
    "path": "Dashboard.PGR",               // dot-path builds the sidebar tree
    "navigationURL": "/dashboard",         // where clicking goes
    "leftIcon": "action:dashboard", "rightIcon": "",
    "serviceCode": "PGR", "parentModule": "", "queryParams": ""
  } }
```

**`ACCESSCONTROL-ROLEACTIONS` / master `roleactions`** — role → action grants.
Seed: `ansible/nairobi-mdms/mdms/ACCESSCONTROL-ROLEACTIONS/roleactions.json`. Entry shape:

```jsonc
{ "tenantId": "ke",                        // outer/MDMS record tenant
  "data": { "id": 1083, "actionid": 1958, "rolecode": "PGR_SUPERVISOR",
            "tenantId": "ke", "actioncode": "" } }   // INNER tenantId — see §5
```

**Server-side role intersection**: the FE never filters actions itself. On login it POSTs the
user's role codes to `/access/v1/actions/mdms/_get` (egov-accesscontrol) — see
`digit-ui-esbuild/packages/libraries/src/services/elements/Access.js`:
`{ roleCodes, tenantId: <stateId>, actionMaster: "actions-test", enabled: true }` — and the
service returns the intersected, enabled action list. The sidebar
(`digit-ui-esbuild/packages/modules/core/src/components/TopBarSideBar/SideBar/SideBar.js`)
builds its tree from each action's dot-`path` and labels every node with
`t(getTransformedLocale("ACTION_TEST_" + <name segment>))`.

**To give role R a "Dashboard" sidebar entry**: (1) ensure the action exists (or create one with
a fresh id — §5), (2) `_create` a roleactions row `{rolecode: R, actionid: <that id>, tenantId:
<state root>}`, (3) bust the caches (§4). No restart.

> **ⓘ bomet sidebar note (fixed 2026-07-09).** The sidebar had been empty for every role because
> `tenant_bootstrap` seeded the ACCESSCONTROL actions under `ACCESSCONTROL-ACTIONS-TEST.actions-test`
> instead of the standard `ACCESSCONTROL-ACTIONS.actions` that `egov-accesscontrol` reads (the
> ACTIONS-bridge step failed on a schema race — egovernments/CCRS#1106; **not** the mdms image, which
> an early RCA wrongly blamed). The actions were bridged on bomet, so `/access/v1/actions/mdms/_get`
> now returns actions and the sidebar renders. Durable bootstrap fix: `fix/mcp-actions-bridge-schema-wait`
> (unmerged → a fresh box still needs the bridge). It was never a dashboard-RBAC problem; the home card
> + deep link (§1a) remain valid. Full detail: `80-live-bomet-state.md` §5.

## 3. Localization keys

- **`ACTION_TEST_DASHBOARD`** — the sidebar/menu label for a node whose transformed path/name
  segment is `DASHBOARD` (the `ACTION_TEST_<X>` pattern in §2; keys are generated at runtime,
  UPPER_SNAKE). Module: **`rainmaker-common`**. Upsert it via
  `/localization/messages/v1/_upsert` for every enabled locale (see
  `common-masters.StateInfo.languages` — that list is the only source of enabled locales).
- **`DASHBOARD_CARD_HEADER`** — home-card header key. **Confirmed** (post-#1062): the card
  component `digit-ui-esbuild/products/dashboard/DashboardCard.js` requests it twice —
  `t("DASHBOARD_CARD_HEADER")` for both the `EmployeeModuleCard` `moduleName` and its single
  link label. Module scope: `rainmaker-common`. Upsert it for every enabled locale or the card
  renders the raw `DASHBOARD_CARD_HEADER` string. (The citizen home derives `ACTION_TEST_<code>`
  instead — `Home.js` — but the employee dashboard card uses this explicit key.)

Missing keys render as the raw UPPER_SNAKE code in the UI — that is a localization gap, not a
routing failure.

## 4. The FULL cache-bust story

Localization and init data are cached at **three** layers. After editing actions, roleactions,
citymodule, or localization messages, work through all of them top-down:

1. **Server — redis**: the localization service caches messages in the `digit-redis` hash
   `messages`. Bust with: `redis-cli DEL messages` (inside the redis container). Until then,
   `_search` keeps serving the old messages regardless of what's in Postgres.
2. **Client — sessionStorage `Digit.initData`**: tenant/module/citymodule init payload is cached
   per-tab (`Store/service.js` `Storage.set("initData", …)`; keys are prefixed `Digit.` by
   `digit-ui-esbuild/packages/libraries/src/services/atoms/Utils/Storage.js`). A normal reload
   reuses it; close the tab or clear sessionStorage (or log out/in) to refetch.
3. **Client — localStorage `Digit.Locale.*`**: localization messages are cached **persistently**
   with a TTL — keys `Digit.Locale.<locale>.<module>` and `Digit.Locale.<locale>.List`
   (`digit-ui-esbuild/packages/libraries/src/services/elements/Localization/service.js`).
   **These survive a hard refresh and even a browser restart.** For a deterministic result have
   the user run `localStorage.clear()` (or clear site data) — switching languages back and forth
   also repopulates.

Symptom table: stale label after `_upsert` → redis (1); new sidebar entry missing but API shows
it → initData (2); label fixed for new users but not existing ones → `Digit.Locale.*` (3).

## 5. Operational gotchas (all learned the hard way)

- **mdms-v2 has no `_delete`.** Retire records by `_update` with `isActive: false`. This applies
  to actions, roleactions, citymodule, KpiDefinition — everything.
- **Deactivate roleactions BEFORE their action.** `roleactions.actionid` cross-references the
  action's `data.id` and mdms-v2 validates the reference; deactivating an action that live
  roleactions still point at fails validation. Order: roleactions rows first, then the action.
  (Reference: the ordering comments in `digit-mcp/src/tools/mdms-tenant.ts` — "actions-test must
  land before roleactions (the latter x-refs action ids)".)
- **Allocate new action ids from a live max-id scan.** Action `data.id` must be unique across
  the master. The seed files carry thousands of ids from multiple sources; don't pick "a nice
  round number" — query the live master for `max(id)` and go above it, or you will collide with
  a bootstrapped record.
- **Mirror the live inner-`tenantId` convention.** Roleaction records carry an *inner*
  `data.tenantId` distinct from the MDMS record tenant. On MCP-bootstrapped tenants the copied
  rows keep the inner tenantId of the *source* root (e.g. `pg`) — check what the live rows on
  your instance use and match it exactly; a mismatched inner tenantId makes the grant silently
  inapplicable.
- **ACTIONS bridge for MCP-bootstrapped tenants.** egov-accesscontrol reads
  `ACCESSCONTROL-ACTIONS.actions`, but the shipped seeds only define
  `ACCESSCONTROL-ACTIONS-TEST.actions-test`. `tenant_bootstrap` (Step 3c in
  `digit-mcp/src/tools/mdms-tenant.ts`) clones the schema + rows to the non-TEST code,
  preserving `data.id` so roleaction cross-refs resolve. If you hand-add actions on such a
  tenant, add them to **both** masters or the menu will not appear ("no actions → blank menu").
- **`dss.*` is NOT copied by tenant_bootstrap** — a fresh tenant has actions but no
  KpiDefinition/DashboardPack. See `60-operations.md` §tenant-bootstrap.
