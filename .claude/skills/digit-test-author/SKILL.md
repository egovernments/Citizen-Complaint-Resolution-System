---
name: digit-test-author
description: Use when a tester or developer wants to add or extend Playwright tests in tests/integration-tests for DIGIT's PGR (complaint) platform — describes a scenario in plain language ("test that a citizen can...", "add a case for...", "what happens if..."), asks how the test folder/framework is structured, or asks to port/run the suite against a different deployment or tenant (a different environment, workflow, or master data than the one the tests were authored on). Covers scenario intake, spec authoring against the existing helper layer, deployment portability triage, and skip-vs-fail discipline.
---

# DIGIT Integration Test Authoring

Turns a scenario described in plain language into a Playwright spec inside
`tests/integration-tests/`, and turns a "run this against tenant X" request into a
triage pass over what the deployment does and doesn't have seeded. Both jobs lean on
the same portability machinery, so they're one skill, not two.

Ground truth lives in the suite itself, not here — this file is a map, not a copy.
Before relying on a claim below about a helper's signature or an env var's default,
open the file it points at; the suite evolves and this skill can drift. The two
canonical documents are `tests/integration-tests/README.md` (what the suite covers,
how to run it) and `tests/integration-tests/WRITING-TESTS.md` (the pipeline, the
portability tiers, the checklist). Read the relevant section of WRITING-TESTS.md
before writing a spec if anything below feels underspecified — don't guess.

## Orientation — three subtrees, one is canonical

| Path | Status |
|---|---|
| `tests/integration-tests/` | **Canonical — work here.** Persona-organized Playwright suite, env-driven, deployment-agnostic by design. |
| `tests/integration-tests/dashboard-react-admin/` | Catalog/results viewer for the suite above. Only touch if asked to change reporting. |
| `tests/playwright/` | Legacy, bomet-only, frozen. Don't add here — it's being retired as coverage lands in the canonical suite. |

`local-setup/tests/` and `digit-ui-v2/tests/` are separate suites for different
concerns (local dev-stack bring-up, a v2 UI stub) — out of scope for this skill unless
the scenario is explicitly about local-stack bring-up.

## Mental model

1. **The run pipeline** (`playwright.config.ts` projects, in dependency order):
   `profile-setup` (interrogates the *live* deployment once, writes
   `deployment-profile.json`) → `setup`/`api-setup`/`citizen-setup` (auth, one fresh
   citizen) → `lifecycle-setup` (seeds a few complaints in known states) → the spec
   projects (`chromium`, `api`, `smoke`).
2. **`tests/utils/env.ts`** is the only place a spec should read deployment-shaped
   values from. Every value resolves `explicit env var → deployment-profile.json →
   legacy hardcoded default` — the hardcoded floor is bomet/nairobi literals and must
   never be treated as "the default deployment."
3. **`tests/utils/personas.ts`** resolves *who* can drive a given workflow action by
   logging into candidate credentials and joining against live HRMS data — it does not
   assume a fixed username owns a fixed role. This is what makes a persona-driving spec
   portable across tenants with different HRMS layouts.
4. **`tests/utils/seed.ts`** builds on personas.ts to file/assign/resolve/rate a
   complaint end-to-end using whatever real triple the deployment actually supports.

## IRON LAWS

```
NEVER hardcode a deployment literal (tenant id, service/complaint-type code, boundary
code, phone prefix, postal pattern, tenant label, username) in a spec. Resolve it via
tests/utils/env.ts, or discover it live via probes.ts/personas.ts.

NEVER let a test pass by asserting nothing, and NEVER weaken a real failure into a
skip. A skip needs a precise, checkable reason ("no PGR_LME in dept X on tenant Y");
a fail must be a genuine regression or deployment defect.

NEVER run two `npx playwright test` invocations against the same stack concurrently.
The profile/auth/seed fixture files are shared and written to the suite root
(workers: 1 exists because of this) — a second concurrent run clobbers the first's
state mid-test.
```

## Part A — Turning a scenario into a spec

### Step 1: Intake the scenario

Get (or infer, then confirm) these facets before writing anything:

- **Persona**: citizen / employee / admin / cross-persona lifecycle / system (keycloak, onboarding). Drives which folder the spec lands in.
- **Layer**: UI (drives a browser) or API (fetch-only, faster, no screenshots). Prefer API unless the scenario is explicitly about what renders.
- **Kind**: happy-path / edge-case / regression (referencing a ticket) / validation / smoke / lifecycle.
- **Area**: pgr / hrms / configurator-manage / localization / theme / dashboard / auth / mdms-schema / proxy / keycloak / onboarding / manage-boundaries.

If the scenario is vague ("test complaint escalation"), ask one clarifying question
covering all four rather than guessing the persona/layer split — a UI escalation test
and an API escalation test exercise completely different code paths and helpers.

### Step 2: Check for existing coverage first

`grep -ril <keyword> tests/integration-tests/tests/` before writing anything new.
Extending an existing spec's `test.describe` block (per WRITING-TESTS.md's guidance on
`*-fixes-YYYY-MM-DD.spec.ts` naming) is often more correct than a new file — a new
dated file is for a *fix wave*, not for every new case.

### Step 3: Classify the portability tier the new test should target

Write for **Tier 1** whenever possible: assert behavior/shape, self-seed the data you
need (`seedComplaintAsCitizen`, `provisionFreshCitizen`, create-your-own throwaway
tenant/master). Only fall to **Tier 2** (needs a specific pre-seeded persona/entity)
when the scenario is inherently about that entity (e.g. ward-jurisdiction filtering) —
and then the spec MUST `test.skip(reason)` when the precondition is missing, never
fail. Never write a **Tier 3** spec (a literal that only matches one deployment's
data) — if a value seems unavoidable to hardcode, that's the signal to resolve it from
`env.ts`/the profile instead.

### Step 4: Reuse the helper layer — don't hand-roll auth or workflow calls

| Need | Helper |
|---|---|
| Deployment values (tenant, service code, locality, locales, postal/mobile pattern) | `tests/utils/env.ts` |
| Who can act as GRO / PGR_LME / ward-CSR / inbox-viewer on this deployment | `tests/utils/personas.ts` → `getPersona()`, `resolveSeedPlan()` |
| File/assign/resolve/rate a complaint end-to-end | `tests/utils/seed.ts` → `seedComplaintAsCitizen`, `driveToPendingAtLme`, `driveToResolved` |
| Employee UI login, inbox rows, service fetch | `tests/utils/employee-ui.ts` |
| Citizen OTP login (UI) | `tests/utils/citizen-login.ts` |
| A fresh/shared provisioned citizen | `tests/utils/citizen-provision.ts` |
| MDMS/PGR/HRMS search calls for admin specs | `tests/utils/manage/api.ts` |
| Test-record naming + cleanup | `tests/utils/manage/codes.ts` (`testCode`, `PW_` prefix), `tests/utils/manage/teardown.ts` |
| Deployment capability probes (does keycloak exist, is X seeded) | `tests/utils/probes.ts`, `tests/utils/capabilities.ts` |

Read the target helper file before calling it — several (`personas.ts`, `seed.ts`)
have load-bearing comments explaining why a shortcut that looks obviously correct
(e.g. "just use ADMIN") breaks on a real second deployment.

### Step 5: Write the spec

- File location: `tests/<persona>/<descriptive-name>.spec.ts` (or `tests/lifecycle/`
  for cross-persona flows). Filename drives the default dashboard tag.
- Tag every `test()`:
  ```ts
  test('citizen cannot rate an unresolved complaint', {
    tag: ['@persona:citizen', '@area:pgr', '@layer:api', '@kind:edge-case'],
  }, async ({ page }) => { … });
  ```
  Add `@ccrs:NNN` / `@pr:NNN` when the scenario traces to a ticket.
- Prefer an `annotation: { type: 'description', description: '...' }` block spelling
  out the steps and the *why* (see any spec under `tests/citizen/` for the pattern) —
  the dashboard surfaces this, and it's what lets someone unfamiliar with the spec
  understand what it proves without reading the assertions line by line.
- Follow the gotchas in `WRITING-TESTS.md` §6: assert on a write's response, not an
  immediate re-search (index lag); wait for the XHR before asserting on a UI save;
  default to `mode: 'default'` not `'serial'`; locate custom controls by role+name,
  not `getByLabel`.
- **Clean up what you create**: track created records/tenants and tear them down in
  `afterAll` via `utils/manage/teardown.ts`, using the `PW_` code prefix so leftovers
  are identifiable and never collide with real data.

### Step 6: Run and triage

```bash
cd tests/integration-tests
set -a; source .env; set +a          # or deploy/<tenant>.env
npx playwright test tests/<persona>/<file>.spec.ts --project=chromium --workers=1
```

Read the result against §8 of `WRITING-TESTS.md`: pass = correct behavior on this
deployment; fail = real regression or genuine defect (don't weaken the assertion to
go green); skip = a precisely-stated, legitimate absence of data/capability.

## Part B — Porting the suite to a different environment

Do **not** treat this as a rewrite. The suite already discovers deployment shape at
runtime (`profile-setup` → `deployment-profile.json`); porting is mostly *running it
and triaging what doesn't discover cleanly*, following the tier rules above.

1. **Gather the target's coordinates**: `BASE_URL`, `DIGIT_TENANT` (+ `ROOT_TENANT` if
   it's a two-level tenant like `mz.maputo`), an admin login, and — if there's already
   an env file for a similar deployment — copy the pattern from `deploy/bomet.env` /
   `deploy/maputo-local.env` rather than starting from the full `.env.example` table.
2. **Discover before assuming.** Run just profile discovery first and read the
   output:
   ```bash
   npx playwright test --project=profile-setup
   cat deployment-profile.json | python3 -m json.tool | less
   ```
   Check it against the "data a deployment must have" table in `WRITING-TESTS.md` §3
   (tenant hierarchy, ≥2 boundary levels, a PGR business service, complaint types, a
   working GRO+assignee pair, mobile/postal patterns, locales). Anything missing there
   is a **seed gap on the target deployment**, not a test bug — if it needs fixing,
   that's a job for the onboarding skills (`digit-ansible-onboard`,
   `digit-xlsx-onboard`), not this one.
3. **Run a persona/area slice, not the whole suite**, and expect Tier 2 skips:
   ```bash
   npx playwright test tests/admin --project=chromium --workers=1
   ```
4. **Triage every red and every skip**:
   - Fail + the assertion pins a literal (`ke.nairobi`, `sw_KE`, a fixed complaint id,
     a specific workflow shape) → **Tier-3 bug in the test**, fix it to read from
     `env.ts`/the profile (e.g. the ESCALATE model differs — Kenya self-loops on
     `PENDINGATLME`, Maputo forward-transitions to `PENDINGATSUPERVISOR`; read the
     configured `nextState` rather than assuming one shape).
   - Fail + the platform genuinely misbehaves → real bug, leave it red, report it.
   - Skip + the reason names a specific missing entity (persona, master, business
     service action) → confirm the reason is accurate, then decide with the user
     whether to seed that gap on the target or accept the skip.
5. **Persist what's new** as `deploy/<tenant>.env` (mirroring the existing files) once
   the target's values are known-good, and only add new `.env.example` rows /
   `README.md` table entries for genuinely new variables — don't invent a fallback
   default that isn't already a real deployment's value (see the `env.ts` header
   comment on why nairobi/bomet floors already caused a silent-wrong-tenant bug once).

## Working with the user

The user is a tester, not necessarily fluent in this codebase's internals — they'll
hand you scenarios in plain language and expect you to map them to persona/tier/tags
and produce a runnable spec, and to explain *why* a given case ended up skip vs fail
rather than just reporting a status. When a scenario implies a capability the current
deployment profile doesn't have, say so explicitly and offer the seed-it-or-accept-it
choice rather than silently downgrading the test's rigor.
