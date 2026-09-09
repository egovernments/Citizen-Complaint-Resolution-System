# Masters & Configurator Access Policy — Design

**Author:** Vinoth Rallapalli · **Date:** 2026-07-13 · **Status:** Implemented per §5 rollout order — see `docs/design/masters-configurator-access-policy-design.md` history; live in `ACCESSCONTROL-ACTIONS-TEST` seed data + `configurator/`
**Scope:** accesscontrol MDMS data (`ACCESSCONTROL-ACTIONS-TEST`, `ACCESSCONTROL-ROLEACTIONS` — no new master), and `configurator/` (react-admin admin console + onboarding wizard).
**Builds on:** [`accesscontrol-policy-conditions-design.md`](accesscontrol-policy-conditions-design.md) and [`field-level-attribute-access-design.md`](field-level-attribute-access-design.md) — same JsonLogic condition vocabulary and `Action.resource` structured-object shape, extended here to a new subject (masters/admin-console capability) and a new runtime (the configurator SPA, not `pgr-services`).

---

## 1. Problem

The prior two docs cover **complaint transaction** access: row-level (department, jurisdiction, citizen-ownership scoping) and column-level (per-field masking). This doc covers the remaining three asks, which are about **masters (reference/config data)** and the **configurator admin console**, not complaint transactions:

5. **Master edit/visibility restriction by role** — `MDMS_ADMIN` can create/edit any master; `SUPERVISOR` can view but not edit/create; some masters should be hidden entirely from some roles, or shown only to specific roles.
6. **Configurator masters list restriction** — the admin console's nav/resource list itself must reflect (5), optionally combined with the user's department.
7. **Onboarding wizard restriction by role** — the 4-phase onboarding flow (`Phase1-4Page`) should be visible/actionable only to specific roles; management-type actions restricted to specific roles, independent of or combined with (5)/(6).

### 1.1 A constraint items 1-4 didn't have — and a firm scope line drawn here

`pgr-services` is source we own, so the row/column policy docs could add a Tier-2 (body/resource-aware, server-side JsonLogic) interceptor directly in the service. **`egov-accesscontrol` and `mdms-v2` are external prebuilt Docker images in this stack** (`egovio/egov-accesscontrol:v2.9.2-4a60f20`, `egovio/mdms-v2:v2.9.2-4a60f20` per `local-setup/docker-compose.db-migrations.yml`) — there is no in-repo service to drop a Tier-2 PDP into for MDMS traffic:
- `mdms-v2`'s create/`_update` endpoints carry **`schemaCode` in the URL path** (e.g. `/mdms-v2/v1/_create/{schemaCode}`) → the existing gateway URL+role match (Tier 1, already live) **can** distinguish per-master write access today. Pure MDMS-data change, no new code.
- `mdms-v2`'s search/list endpoint carries `schemaCode` **in the request body**, one shared URL for every master → the gateway **cannot** distinguish "hide master X from role Y" at the URL level, and there's no service-side hook to inspect the body.

**Confirmed scope line (author direction):** Tier-2, server-side, body/resource-aware policy evaluation stays **`pgr-services`-only**. It is not extended to MDMS traffic in any form, including as a new interceptor, sidecar, or proxy. For masters, all visibility/action restriction is **UI-level**: the configurator reads the **existing** accesscontrol MDMS action data it already fetches (see §1.2) and evaluates JsonLogic conditions **client-side**, purely to decide what to render. This is a firmer, simpler version of the "UI-only hiding" decision from the original proposal — it also rules out folding masters into a server-evaluated `Action.resource` block the way field-level masking did for `pgr-services`.

### 1.2 Current state of the configurator

Confirmed by direct inspection this session — the `configurator/` react-admin app has **no RBAC today**:
- `DigitLayout.tsx:46-94` renders a static `navGroups` array for every authenticated user.
- `App.tsx:121-156` registers every `<Resource>` (departments, boundaries, employees, access-roles, mdms-schemas, generic MDMS masters, …) unconditionally.
- `Phase1-4Page` routes (`App.tsx:476-487`) are gated only on `state.isAuthenticated`.
- `packages/data-provider/src/providers/authProvider.ts:37-41` already implements `getPermissions()` (returns `user.roles.map(r => r.code)`), but **nothing calls it** — it's dead plumbing.
- `LoginPage.tsx:66-75` does a single coarse check: login succeeds if the user has *any* of `MDMS_ADMIN`, `SUPERUSER`, `LOC_ADMIN`, or plain `EMPLOYEE`. Past that gate, every role sees the identical console.
- The `access-roles`/`access-actions`/`role-actions` resources (`configurator/src/resources/role-actions`, `access-actions`) **already fetch and display** `egov-accesscontrol`'s action + role-action data — this is the exact data source §3.2 below reuses; no new MDMS round trip is being added.

## 2. Scope decisions (confirmed)

1. **Doc-first, same as items 1-4**: this doc is a proposal; implementation follows once directed.
2. **No new MDMS master.** Everything is expressed in the **existing** `ACCESSCONTROL-ACTIONS-TEST` action records (the same ones `AccessPolicyRegistry` already fetches/caches for `pgr-services`), read as-is by the configurator.
3. **Tier-2 server-side JsonLogic evaluation is `pgr-services`-only**, full stop. Masters restriction is UI-level: read the existing action data, evaluate conditions in the browser (`json-logic-js`), decide what to render. Not a hard data-security boundary — real write security is the gateway's existing URL+role match (§3.1).
4. **Role-only for v1.** Department-scoped masters visibility is out of scope for this pass (§7) — confirmed not needed now; everything here is role-driven UI restriction only.
5. **Backward-compat rule** (mirrors docs 1-2): if a master has **no** matching action entry, or an action's `resource`/`condition` is null/empty, it behaves exactly like **today** — visible, and editable by whoever the gateway already lets write to it. Nothing regresses for a master that hasn't been configured yet.

## 3. Design

### 3.1 Master write-authorization (item 5, "can edit") — data-only, no new code

Define one `Action` entry per (master `schemaCode`, operation) in `ACCESSCONTROL-ACTIONS-TEST`, the same way it already defines the PGR search action (`utilities/default-data-handler/src/main/resources/mdmsData/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json`):

```jsonc
{ "id": 3101, "url": "/mdms-v2/v1/_create/{schemaCode=Department}", "name": "Create Department Master", "method": "POST" }
{ "id": 3102, "url": "/mdms-v2/v1/_update/{schemaCode=Department}", "name": "Update Department Master", "method": "POST" }
```

Map these action ids in `ACCESSCONTROL-ROLEACTIONS` to whichever roles should be able to write that master. **By default, every master's create/update actions are mapped to `MDMS_ADMIN`** — this is an authoring convention (§3.2), not a hardcoded bypass in code: when a new master is added, its create/update actions get added to `MDMS_ADMIN`'s mapping as a matter of course, the same way every other master already is today. A role like `SUPERVISOR` gets no entry for these action ids by default → the existing gateway Tier-1 mechanism (`RbacFilterHelper`, external image) already denies a request whose URL+role has no matching action. Closes item 5's "can view but can't edit" with **zero new code** — purely data, and purely `MDMS_ADMIN`-vs-everyone-else unless a master is explicitly opened up to another role.

No JsonLogic `condition` is needed for write authorization — plain URL+role matching is sufficient because `schemaCode` is in the path.

### 3.2 Master visibility — reuse the existing shared search `Action`'s `resource` field, evaluated in the UI only

`mdms-v2`'s search/list endpoint is one shared URL for every master (`schemaCode` in the body), so it already has (or gets, mirroring the PGR search action already registered) **one** `Action` entry in `ACCESSCONTROL-ACTIONS-TEST`. Extend that single entry's `resource` field — the exact same structured-object shape `field-level-attribute-access-design.md` §4.1 introduced for `resource.complaint.attributes` — with a `masters` key, keyed by `schemaCode`:

```jsonc
{
  "id": 2100,
  "url": "/mdms-v2/v1/_search",
  "name": "Search MDMS Masters",
  "resource": {
    "masters": {
      "AccessRole": {
        "condition": { "in": [ "MDMS_ADMIN", { "var": "user.roles" } ] }
      },
      "Department": {
        "condition": { "or": [
          { "in": [ "MDMS_ADMIN", { "var": "user.roles" } ] },
          { "in": [ "SUPERVISOR", { "var": "user.roles" } ] }
        ] }
      }
    }
  }
}
```

- A `schemaCode` with **no entry** under `resource.masters` is visible to everyone logged into the configurator — today's behavior, unchanged (§2.5). Only masters that actually need restricting get an entry — most masters need none.
- `condition` is the same JsonLogic vocabulary from doc 1's `user`/`action`/`env` input document, evaluated **client-side** via `json-logic-js` against `{ user: { roles: [...] } }` built from the already-fetched login/session user — no server round trip beyond the MDMS fetch the configurator already does today for `access-actions`/`role-actions`.
- **Editability** is a separate, simpler check from visibility: a master is editable by a role if that role has the master's create/update action id mapped in `ACCESSCONTROL-ROLEACTIONS` (§3.1) — the configurator already fetches this role-action list for its `role-actions` resource; reuse it as a lookup (`hasAction(role, createActionId(schemaCode))`) rather than duplicating the write policy as a second JsonLogic condition. One source of truth for "can write," matching what the gateway will actually enforce.
- **Onboarding a new role**: if a new role needs restricted masters access, (a) map that role to the relevant per-master create/update action ids in `ACCESSCONTROL-ROLEACTIONS` for masters it should edit, and (b) add/extend a `condition` under `resource.masters.<schemaCode>` on the shared search action for masters whose *visibility* should be restricted for that role. Both are pure data changes against the one existing master.

### 3.3 Configurator wiring (items 6-7)

- **Fetch once at login**: the configurator already fetches accesscontrol's action + role-action data for its `access-actions`/`role-actions` resources (§1.2) — extend that existing fetch path to also parse the search action's `resource.masters` block, and build one client-side capability lookup: `canView(schemaCode)` (evaluates the JsonLogic `condition` via `json-logic-js` against the logged-in user's roles) and `canEdit(schemaCode)` (looks up whether the create/update action id is in the user's mapped role-actions). No new endpoint.
- **Nav + resource registration**: `DigitLayout.tsx`'s `navGroups` and `App.tsx`'s `<Resource>` list both filter through `canView(schemaCode)` before rendering — a master the role can't see doesn't appear in nav *or* get routed. Closes item 6.
- **Edit/create affordances**: `DigitEdit`/`DigitCreate`/`MdmsResourceEdit`/`MdmsResourceCreate` check `canEdit(schemaCode)` and render read-only (no Save/Create button) when false — this matches the real gateway-enforced capability from §3.1, so there's no "button shown that just 403s."
- **Onboarding wizard (item 7)**: confirmed simplification — **actionability equals visibility**. A role can act on (use/select/assign via) whichever masters `canView` returns true for during the wizard; `MDMS_ADMIN` can additionally add/edit any master anywhere, including inline from within a wizard step. There is no separate "wizard phase" capability axis in v1 — a `Phase*Page` step that touches only masters visible to the current role behaves normally; a step touching a master the role can't see should skip/hide that step's affected fields rather than blocking the whole phase, using the same `canView`/`canEdit` checks already built for §3.2-3.3, not a new mechanism.

## 4. What stays as today (explicit non-goals)

- No new MDMS master, no new backend service, no proxy in front of `mdms-v2`.
- Tier-2 server-side JsonLogic evaluation is not extended beyond `pgr-services` — confirmed firmly in §1.1/§2.3.
- No department-scoped masters visibility (§2.4) — confirmed not needed now; purely role-driven UI restriction.
- No change to `pgr-services`' existing row/column policy engine — this doc is purely additive, a new subject area, reusing the same `Action.resource` shape and JsonLogic vocabulary but a different (client-side) evaluator.

## 5. Rollout

1. Author the schemaCode-scoped `Action` + `ACCESSCONTROL-ROLEACTIONS` entries for each master that needs a write restriction (§3.1) — data only, verify via direct API call (`MDMS_ADMIN` succeeds, `SUPERVISOR` gets 403) before touching the UI.
2. Extend the one existing shared search `Action`'s `resource.masters` block (§3.2) with an initial `AccessRole`/`Department`-style pair to prove the shape — most masters get no entry (visible to all, per §2.5).
3. Wire the configurator's capability lookup (`canView`/`canEdit`) into the existing action/role-action fetch path (§3.3) — ship with every current master unrestricted (no entries yet) so nothing regresses.
4. Wire nav/resource filtering, then edit/create gating, then onboarding-step field-level gating — each independently testable.
5. Expand `resource.masters` and `ACCESSCONTROL-ROLEACTIONS` data role-by-role as needed.

## 6. Testing plan

Mirrors `accesscontrol-policy-conditions-testing-plan.md`'s format — a parity table exercised both ways:

| Role | Master | Gateway write test (real API) | Configurator UI test |
|---|---|---|---|
| MDMS_ADMIN | Department | `_create`/`_update` → 200 | visible, edit/create shown |
| SUPERVISOR | Department | `_create`/`_update` → 403 | visible (per `resource.masters.Department.condition`), read-only (no edit/create buttons) |
| SUPERVISOR | AccessRole | n/a (no role-action mapping) | absent from nav/routes (`resource.masters.AccessRole.condition` evaluates false) |
| Any role | a master with no `resource.masters` entry | governed only by existing gateway RoleAction config | visible, editable iff the role has the write action mapped — unchanged from today |
| CITIZEN | any master | n/a | login gate already excludes citizens from configurator |

Plus: a regression check that a master/action with **null or empty** `resource`/`condition` behaves exactly like today (§2.5) — this is the single most important test given how much of this design is additive.

## 7. Open questions — resolved

- ~~Should masters-visibility be its own new MDMS master, or folded into `Action.resource`?~~ **Resolved: neither a new master nor server-side evaluation — reuse the existing shared search `Action`'s `resource` field, evaluated client-side only (§1.1, §3.2).**
- ~~Should the "tenant-wide bypass" role set for masters be `PrincipalScopeResolver.TENANT_WIDE_ROLES` or its own list?~~ **Resolved: no hardcoded bypass list at all.** `MDMS_ADMIN`'s full access is just the (tenant-scoped) `ACCESSCONTROL-ROLEACTIONS` mapping covering every master's write actions by convention (§3.1) — a data-authoring practice, not a role-set special-cased in code. `MDMS_ADMIN` is tenant-scoped (does not imply cross-tenant access).
- ~~Exact phase-by-phase "visible" vs "actionable" breakdown for the onboarding wizard?~~ **Resolved: actionability = visibility (§3.3)** — `SUPERVISOR` can act on whatever masters are visible to them; `MDMS_ADMIN` can add/edit/view everything. No separate wizard-phase capability data.
- **Still open (fast-follow, not now):** department-scoped masters visibility. Confirmed not needed in this pass — everything here is role-only UI restriction. When it is picked up, it likely mirrors how `jurisdictionCodes`/`departmentCodes` were added to `AnalyticsScope` as a second axis on top of the base engine, but that's its own short design pass later.

## 8. Implementation notes (what actually shipped)

- **MDMS data**: `resource.masters` added to the existing shared search `Action` (id 2513, `ACCESSCONTROL-ACTIONS-TEST.actions-test`), with `AccessRole`/`role-actions`/`action-mappings` restricted to `MDMS_ADMIN` and `Department` opened to `MDMS_ADMIN` + `SUPERVISOR` — a minimal illustrative set, not an exhaustive pass over every master. Write authorization needed **no data change**: cross-checking `ACCESSCONTROL-ROLEACTIONS` showed every master's dedicated create/update action ids were already `MDMS_ADMIN`-only by omission (no other role had a mapping) — §3.1's mechanism was already live, just unexploited for visibility.
- **Configurator**: `packages/data-provider/src/providers/accessPolicy.ts` (`loadMastersCapability`, using `json-logic-js`) + `authProvider.getPermissions()` now returns `{ roles, masters }` instead of a bare role array. `src/hooks/useMastersCapability.tsx` provides `canViewResource`/`canEditResource` (resolved via each resource's `schema` in the registry — `access-roles`/`access-actions` got a policy-only `schema` field added since they don't fetch via raw schemaCode search). Wired into `DigitLayout` (nav), `App.tsx` (`<Resource>` registration), and `DigitEdit`/`DigitCreate` (Save/Create button + read-only notice) — the last of these is the single choke point for every dedicated **and** generic MDMS edit/create screen, so no per-resource duplication was needed.
- **Onboarding wizard**: implemented at **phase granularity, not per-field**. Each phase (`Layout.tsx`) is tagged with its dominant master (Phase 1→`tenants`, 2→`boundaries`, 3→`departments`, 4→`employees`); a role lacking `canEditResource` for that master sees a read-only notice banner instead of a field-by-field lockdown. The doc's §3.3 aspiration of skipping only the *specific fields* tied to a restricted master inside a phase was judged too large/risky to retrofit into the ~4,100 lines across the four phase pages in this pass — real write security for these actions is unaffected (already gateway-enforced per §3.1), so this is a UX-completeness gap, not a security one. Flagged here as the concrete follow-up if finer-grained onboarding gating is wanted later.
- **Tests**: `accessPolicy.test.ts` (new) covers canView/canEdit/fail-open-on-malformed-condition/no-entry-defaults-visible. `authProvider.test.ts` updated for the new `getPermissions()` return shape. Full existing `configurator` vitest suite (44 tests) and `data-provider` unit tests pass unchanged; the pre-existing `dataProvider.integration.test.ts` failures (needs a live DIGIT backend) are unrelated and unaffected.

---

This doc is ready to move into implementation per the rollout order in §5.
