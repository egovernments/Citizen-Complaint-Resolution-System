# Dashboard & KPIs — product brief

*For product review ahead of implementation. Describes what we're building, the experience, the decisions we've made, and what's in/out of scope. No engineering detail — the technical spec lives on CCRS #631 and the accompanying design docs.*

---

## Summary

We're turning the PGR dashboard into a **configurable, role-aware analytics surface**. The same set of KPIs is shown to many different people, but each person automatically sees only the data they're entitled to — a citizen sees their own complaints, a ward supervisor sees their ward, a department head sees their department, an admin sees everything, and the public sees aggregate stats only. KPIs are configured centrally (adding or changing one doesn't need an app release), and one designated person per tenant controls which KPIs each role sees.

The work is as much about **trust and governance** as it is about charts: today the dashboard decides access in the browser and trusts whatever the client claims about who's logged in. We're moving all of that to the server so access is actually enforced.

---

## Why now

Three problems with the current dashboard:

- **Access isn't really enforced.** What you see is decided by the frontend, and the system trusts the browser's claim about your identity. That's fine for a demo, not for real role-based data.
- **The frontend owns the KPIs.** Metrics are hard-coded into the app, so adding or changing a KPI means a code release, and there's no way to vary what different roles see.
- **No scoping.** Everyone with access sees the whole tenant. A ward supervisor can't get a clean "just my ward" view.

This brief covers fixing all three, plus the new capabilities that follow once access is trustworthy (public dashboards, per-role curation, department views).

---

## What we're building

**One dashboard, many audiences.** A user opens the dashboard and immediately sees the KPIs configured for their role, with the data already filtered to their scope — no manual filtering, no setup. The scoping is automatic and derived from who they are.

Importantly, **the roles, the KPI mix each one sees, and the scoping rules are all configuration — none of it is fixed in the product.** The list below is an illustrative PGR setup, not a hard-coded set; a deployment can define different roles, a different KPI selection per role, and different scoping:

- **Citizens** — e.g. their own complaints, plus public aggregate stats.
- **Supervisors** — e.g. their area: their boundary and everything beneath it. A county-level supervisor automatically covers every ward under the county, including wards added later; there's no list to maintain.
- **Department heads** — e.g. their department's complaints across the areas they cover.
- **Admins** — e.g. the whole tenant.
- **The public** (no login) — e.g. an aggregate dashboard: counts and rates, never individual records.

These are building blocks; what a given tenant actually shows to whom is set in configuration, not shipped in code.

**KPIs are configured, not coded.** Metrics live in central configuration. An admin can define a new KPI (its measure, grouping, default chart) and publish it without an app release. KPIs are versioned and have a draft/published state, so work-in-progress stays hidden and live dashboards don't break when a KPI is edited.

**One person curates per tenant.** A designated tenant role (think "dashboard owner") decides which KPIs each role sees, tenant-wide, and the default layout. They work within a platform-set ceiling that prevents them from, say, exposing staff-identifying KPIs to the public. They control *which KPIs a role sees* — never *which data rows*, which stays automatic per user.

**Users can personalize.** Individuals can rearrange and resize their own tiles; the arrangement is saved per user, on top of the role default. Switching a KPI between table, bar, line, and map is instant.

---

## Key product decisions (worth confirming in review)

These are the choices we've already made and the reasoning, so product can sanity-check them before we build:

**1. Scope is decided by *who's asking*, not by the KPI.** A KPI like "complaints by ward" is defined once and returns different rows to a citizen, a supervisor, an admin, and the public — because the system filters by the viewer's identity. We deliberately did *not* make separate "citizen version" and "supervisor version" KPIs. One definition, many audiences.

**2. Public dashboards are supported, and what they may expose is a configurable policy — not a hard rule.** A published public dashboard can be viewed with no login. What's allowed on it isn't baked into the product: the platform tags which data is sensitive (personal / staff-identifying) and which audiences may see what, and the system enforces *that policy* at publish time — a KPI that would expose data its audience isn't permitted to see can't be published to that audience. The sensible default for "public" is aggregate-only with no personal or staff data, but what counts as sensitive and what each audience may see are configuration, changeable per deployment, not constants in code. (This is also why a "tenant-wide" view isn't a leak when it's an intentional, configured public aggregate.)

**3. When the system can't tell who you are, it fails *safe*, not open and not blank.** Supervisors' areas and department heads' departments come from the HR/staff system, and that data sometimes drifts. If we can't resolve a user's area or department, we show them the **public (aggregate) view** with a clear "showing public view" notice — never everyone's detailed data, and never an empty screen. We also surface how often this happens, because it's a useful data-quality signal for the org.

**4. Curation is one tier per tenant.** A single designated role curates for the whole tenant. There's no delegated, per-ward or per-team curation in this version — that kept the model simple and is the main thing to confirm product is comfortable with.

**5. Area scoping lands a step before department scoping.** Both are first-class and work identically (scope follows who you are). Area scoping goes first only because department scoping needs a little more groundwork in one of the underlying metric sources — a build-order point, not a difference in capability or a per-tenant caveat.

---

## Scope & phasing

Roughly in build order; each phase is independently useful:

1. **Verified identity** — make access and scope trustworthy and server-enforced. Foundation for everything else; no visible feature on its own, but everything depends on it.
2. **Scoped views** — supervisors see their area, citizens see their own complaints, admins see all.
3. **Department views** — department heads see their department.
4. **Central KPI catalog + curation** — add/assign KPIs without a release; the tenant curator sets per-role visibility.
5. **Public dashboards** — published, aggregate, no-login.
6. **Personalization** — per-user layout.

**Explicitly out of scope (this version):** delegated/per-team curation; real-time (live) data; per-record public views.

---

## Dependencies, limitations & risks

Things product and the org should go in with eyes open:

- **Data refreshes on a schedule, not live.** Metrics are precomputed and refreshed on a **configurable interval** — currently about every 5 minutes for the live metrics, with the backlog/aging snapshot taken daily. Numbers carry an "as of" time: near-real-time reporting on a set cadence, not a live operational stream. *(Build note: the newer metric grains this design introduces still need to be wired into the refresh job — they aren't auto-refreshing yet.)*
- **If a user's staff record is incomplete, scoping degrades safely.** A supervisor's area and a department head's department come from the staff/HR system. If that information is missing for a user, the system shows them the public (aggregate) view with a clear notice — never everyone's detailed data, never a blank screen — and surfaces how often this happens so the gap can be fixed at source. This is designed fallback behavior, not a failure mode.
- **Area scope follows the official boundary hierarchy.** If areas are reorganized, scopes follow the new structure once the hierarchy is updated.
- **Public surfaces never carry personal data** — by design and enforced, but worth setting expectations: the public dashboard is intentionally limited to aggregates.

---

## Open questions for product

1. Comfortable with **one curation tier per tenant** (no per-ward/per-team delegation) for v1?
2. For **public dashboards**, what's the default — opt-in per tenant, or off everywhere until explicitly enabled?
3. The **degrade-to-public-view** behavior on unresolved staff data: is the "showing public view" notice enough, or do we want supervisors actively alerted (and a path to flag their own missing data)?
4. Is **near-real-time** (periodic refresh) acceptable for the launch use cases, or is anyone expecting live numbers?

---

*Companion — full technical design (engineering audience): [CCRS #631 design comment](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/631#issuecomment-4775492466).*
