# Jurisdiction-Based Access Control — Complaint Search & Employee Inbox

*Who this is for: anyone who needs to understand or configure who can see which complaints — city administrators, program managers, and engineers alike. Plain-language explanation first; exact technical detail at the end for whoever implements it.*

## In plain terms

When a staff member searches for complaints, or opens their inbox, the system can limit what they see based on **where they work** (their assigned area — a ward, a city, a district, etc.) and **which department they belong to**. This is called jurisdiction-based (and department-based) access control.

The idea is simple: a field officer assigned to one neighborhood shouldn't need to wade through complaints from the entire city to find their own. A city-wide supervisor, on the other hand, should be able to see everything. This feature lets each **role** (not each individual person) be configured for either view — and it applies identically to complaint search and to the employee inbox, since they're the same underlying feature.

**Important: this is safe by default.** A city that hasn't configured anything for this gets the old, fully-open behavior — nobody's search results shrink by accident just because this feature exists in the software. It only starts restricting what people see once someone deliberately configures it for a role.

## How it works, with an example

Say a city has three roles: **Field Officer**, **Grievance Officer**, and **Supervisor**. The city administrator can decide, separately for each role:

- **Jurisdiction:** should this role see complaints only from **their own assigned area** ("Own"), or from **anywhere in the city** ("All")?
- **Department:** should this role see complaints only **for their own department** ("Own"), or **for every department** ("All")?

These two settings are independent — a role can be "Own" on one and "All" on the other. For example, a Grievance Officer might be set to see complaints from **any department** (they route complaints to the right team) but only within **their own area** — while a city-wide Supervisor might see **every area** but only **their own department's** complaints.

"Own area" isn't just the one exact spot an employee is assigned to — it automatically includes everywhere *underneath* that area too. If someone is assigned at the city level, "own area" means the whole city, every neighborhood included. If someone is assigned to one neighborhood, it means just that neighborhood.

This same rule applies in exactly the same way whether the staff member is running a search or looking at their inbox — there's only one setting to configure, and it governs both.

## How to turn it on, off, or adjust it

There is one place this is configured per city: a single setup record for the complaint-search feature, edited by a technical administrator via the MDMS/Admin Console.

- **To leave it off (fully open, current default):** don't configure anything. Every role sees every complaint, everywhere, in every department — exactly like before this feature existed.
- **To turn it on for specific roles:** add an entry for that role specifying `Own` or `All` for jurisdiction and for department. Any role you don't mention falls back to whatever the record's own default says.
- **To turn it off again for a role:** remove that role's entry (or set both settings to `All`, which has the same practical effect of "no restriction").

*Technical detail:* the record lives in the `ACCESSCONTROL-ACTIONS-TEST.actions-test` MDMS master, as the row whose `id` is `2008` and whose `url` is `/pgr-services/v2/request/_search` (one such row per tenant). The scope configuration sits at `resource.complaint.scope`:

```json
"scope": {
  "axes": ["department", "jurisdiction"],
  "roleScopes": {
    "GRO":        {"department": "ALL", "jurisdiction": "OWN"},
    "PGR_LME":    {"department": "OWN", "jurisdiction": "OWN"},
    "SUPERVISOR": {"department": "OWN", "jurisdiction": "ALL"}
  },
  "default": {"department": "ALL", "jurisdiction": "OWN"}
}
```

Only two levels exist today for each axis: `OWN` and `ALL` — there is no intermediate "my region but not my whole state" level yet. If a role isn't listed in `roleScopes`, it gets whatever `default` says. If an employee holds more than one role, they get the most generous (most open) of the settings across their roles. Removing the entire `scope` block (not just emptying it) is what makes the tenant behave as "off" — this is a deliberate backward-compatibility default, not an oversight.

There is also a separate, stricter mode a tenant can opt into once its roles are fully configured: `pgr.abac.strict-mode` (off by default). While off, a role nobody has configured — or a search request the system can't confidently classify — is allowed through, so a half-finished setup never accidentally locks people out. Once a city has deliberately configured every role it cares about, turning this on makes anything *not* explicitly configured get denied instead of allowed — a "no more guessing" mode for teams that want stricter guarantees. Most cities will never need to touch this.

## What a staff member needs for this to work correctly

Jurisdiction- and department-based scoping both read directly from the employee's HR record:

- **Jurisdiction** needs a current, active area/boundary assignment in HR.
- **Department** needs a current, active department assignment in HR.

If either is missing, out of date, or the employee has since been transferred without HR being updated, that axis has nothing to go on.

## What can go wrong, and how to recognize it

This feature is deliberately **fail-closed, not fail-open** — if it can't figure out an employee's area or department, it shows them **nothing** for that axis, not everything. This is the single most important thing to understand about it, because it explains almost every support ticket this feature will ever generate.

| What you'll notice | What's actually happening | What to check |
|---|---|---|
| A staff member sees **zero complaints** in search or their inbox, when they used to see some | Their role requires "Own" for jurisdiction or department, but their HR record has no active assignment for that axis right now | Check the employee's current jurisdiction/area and department assignment in HR — a stale or missing assignment (common after a transfer) is the usual cause |
| A staff member sees **complaints from the whole city/state**, when you expected them to only see their own area | Their role is configured as "All" for jurisdiction, or nobody's configured "Own" for that role yet (it fell to a permissive default) | Check the role's configured jurisdiction setting; add an explicit "Own" entry if that's what you intended |
| Search results and the employee's inbox used to disagree with each other for the same person | This was a real, now-fixed defect: search and inbox previously calculated "own area" slightly differently. As of this fix, they always agree | No action needed on an up-to-date deployment; if you still see this, confirm you're on a version that includes the jurisdiction-cascade fix |
| One role seems completely unrestricted even though you configured scopes for other roles | That role may not actually have permission to use the search/inbox feature at all yet (separate from the scope setting) — a role needs to be granted the feature before its scope setting matters | Confirm the role has been granted access to the search/inbox action, not just a scope entry |
| The **filter panel** (the dropdown lists of jurisdictions/departments to filter by) shows every jurisdiction and department in the tenant, even though the actual search results a staff member gets back are correctly limited to their own scope | A known, currently open UI defect: the filter panel's option lists aren't scoped the same way search results are — the enforcement described in this document is still working correctly, only the picker's contents are wrong | Confirmed and tracked as [issue #1984](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1984); no configuration fixes this today — it needs a code fix. Don't mistake it for the scoping itself being broken |

## A related, but different, feature: "My Complaints / All Complaints" inbox tabs

Some cities also use a separate optional feature that adds "My Complaints" and "All Complaints" tabs to the employee inbox, based on who a complaint is *assigned to* and the manager/reportee structure in HR — not on geography or department at all. A complaint has to pass **both** this feature (if it's turned on) *and* the jurisdiction/department scoping described above to show up in an inbox tab. Don't confuse the two: turning one on or off has no effect on the other.

---

## Technical reference

- **Where it's enforced:** `PGRService.search()` (`backend/pgr-services/.../service/PGRService.java`) is the single code path for both the general search API and the employee inbox — `RequestsApiController.inboxSearchPost()` delegates straight into it after applying the separate "My/All" visibility layer described above. Scope is resolved via `SearchAccessPolicyService.resolveScope()` and applied as a SQL filter, then re-checked per row via a JsonLogic condition (`AccessPolicyRegistry`) as defense in depth — both are generated from the same authored policy, so they can't disagree with each other.
- **Where "jurisdiction" comes from:** `PolicyDrivenScopeResolver.extractJurisdictions()` reads the employee's active `jurisdictions[].boundary`/`.hierarchy` from HRMS; "own area" is expanded to every boundary beneath the assigned one via `BoundaryHierarchyExpander` (boundary-service `boundary-relationships/_search?includeChildren=true`, cached 30 minutes, degrading gracefully to the unexpanded boundary if that lookup fails).
- **The two levels:** `ScopeLevel` supports exactly `ALL` and `OWN`; `ScopePolicy.SUPPORTED_AXES` is exactly `{"department", "jurisdiction"}` — nothing else is enforceable today.
- **Fail-closed sentinel:** an unresolvable axis (no active HRMS assignment) resolves to `ScopePolicyEngine`'s internal deny-all sentinel, which matches no real row — this is what produces the "sees nothing" symptom above, by design.
- **The rollout flag:** `pgr.abac.strict-mode` (Spring property, default `false`) — while false, an unconfigured role or action is allowed (logged as a warning); once true, the same case is denied (logged as an error). Affects both search's SQL-level check and the per-row JsonLogic re-check identically.
- **Multiple roles:** `ScopePolicyEngine.effectiveLevel()` — the most permissive level across an employee's roles wins.
- **Related, separate feature:** "My/All" inbox visibility is `pgr.visibility.enabled` + `RAINMAKER-PGR.InboxVisibilityConfig`, implemented in `VisibilityService`. It narrows by assignee/HRMS-reportee-hierarchy and stacks with, but is independent of, the scope engine described above.
