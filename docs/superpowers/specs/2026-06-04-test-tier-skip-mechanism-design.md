# Test-tier skip mechanism — design

**Date:** 2026-06-04
**Status:** SUPERSEDED by `2026-06-04-tenant-bootstrap-and-smoke-pipeline-design.md`. The skip mechanism survives as Phase 7 of the new spec, with much-reduced scope (~15-25 tests, not 96). Kept here for the design rationale.
**Owner:** Subhashini Srinivasan

## Summary

Add a context-aware skip mechanism to the Playwright integration test suite at `tests/integration-tests/` so each test declares its **tier** (1/2/3) and **requires** (personas, locales, overlays, etc.) inline, and the runner skips tests whose requirements the target deployment can't satisfy. Replaces the implicit "this test only works on naipepea" assumption that today produces noisy failures instead of clean skips.

Sibling work item (out of this spec's code scope but tracked as Phase 1): refactor 8 tests that hardcode `T = 'ke.nairobi'` to read `process.env.DIGIT_TENANT` instead. Promotes them from Tier 3 → Tier 1.

## Goals

- Each test declares its tier + requirements in one line at the top of `beforeAll`.
- Each deployment is described by a YAML profile listing what it has seeded.
- Tests skip cleanly (with a descriptive reason) when the profile doesn't satisfy their requirements — they do not fail.
- Reporter produces per-tier pass/skip/fail counts so we can answer "how many Tier 1 tests pass against fresh-ci?".
- The mechanism is extensible: new persona names, new overlay names, new pinned fixtures can be added without changing the framework.

## Non-goals

- Auto-discovering deployment state (no runtime probe). Profile is authoritative.
- Fixing the ~52 misclassified tests beyond the 8 trivial cases — that's a separate decision the user parked.
- Tightening the Tier 1 vs Tier 2 definitional ambiguity ("skips cleanly when absent" can belong to both). Out of scope; flagged for follow-up.
- Phase 3 "run + measure" reporting — designed separately once this mechanism lands.

## Architecture

```
tests/integration-tests/
├── tests/utils/context.ts          ← new: assertContext() + loadProfile()
├── profiles/                        ← new dir
│   ├── naipepea.yaml               ← current live deployment
│   ├── fresh-ci.yaml               ← clean DIGIT install (no KC, no sw_KE)
│   └── kenya-dev.yaml              ← Kenya tenant + admin only
├── playwright.config.ts             ← add 3 projects: tier1, tier2, tier3
└── tests/**/*.spec.ts               ← each test gets one assertContext() in beforeAll
```

Operator runs:
```
CONTEXT_PROFILE=profiles/naipepea.yaml npx playwright test --project tier1
```

The Playwright `tier1` project greps for `@tier:1` in test titles (belt-and-suspenders alongside `assertContext`). `assertContext` is the source of truth — the title tag is for fast filtering and report grouping.

## API

```ts
// tests/utils/context.ts
export function assertContext(spec: {
  tier: 1 | 2 | 3;
  requires?: {
    personas?: string[];          // role-in-context, e.g. 'gro-in-pgr-dept', 'ward-scoped-csr'
    tenants?: string[];           // e.g. 'ke.nairobi' for tests that pin to a sub-tenant
    locales?: string[];           // e.g. 'sw_KE'
    overlays?: string[];          // 'keycloak', 'temporal', 'novu'
    scheduler?: boolean;
    pinnedFixtures?: string[];    // SRIDs, theme IDs, named seeds
  };
}): void;
```

**Call site convention:** inside `test.beforeAll` (or `test.describe.configure`) at the top of each spec.

**Behavior:**
1. On first call, load `CONTEXT_PROFILE` YAML (default `profiles/fresh-ci.yaml`), validate against a zod schema, cache the parsed profile.
2. If `spec.tier > profile.maxTier` → `test.skip(true, 'profile not provisioned for tier N')`.
3. For each `requires` array, compute set-difference against the profile's corresponding array. First non-empty difference → `test.skip(true, 'missing <field>: <missing-values>')`.
4. For `requires.scheduler === true` and `profile.scheduler !== true` → `test.skip(true, 'profile lacks scheduler')`.
5. All checks pass → no-op, test runs normally.

Examples:

```ts
// Tier 1 — no requires
test.beforeAll(async () => {
  assertContext({ tier: 1 });
});

// Tier 2 — needs GRO + LME personas seeded
test.beforeAll(async () => {
  assertContext({
    tier: 2,
    requires: { personas: ['gro-in-pgr-dept', 'lme-in-pgr-dept'] }
  });
});

// Tier 3 — needs sw_KE locale + a specific pinned complaint
test.beforeAll(async () => {
  assertContext({
    tier: 3,
    requires: {
      locales: ['sw_KE'],
      pinnedFixtures: ['NCCG-PGR-2026-04-28-011862'],
    },
  });
});
```

## Profile format

```yaml
# profiles/naipepea.yaml
maxTier: 3
tenant: ke.nairobi
tenants: [ke, ke.nairobi]
locales: [en_IN, sw_KE]
personas:
  - gro-in-pgr-dept
  - lme-in-pgr-dept
  - ward-scoped-csr
  - two-level-reportingto-chain
  - system-auto-escalate-role
overlays: [keycloak]
scheduler: true
pinnedFixtures:
  - NCCG-PGR-2026-04-28-011862
  - kenya-green-theme
  - mobile-rule-9-digit-kenya
  - country-prefix-+254
```

```yaml
# profiles/fresh-ci.yaml — clean DIGIT install
maxTier: 1
tenant: pb
tenants: [pb]
locales: [en_IN]
personas: []
overlays: []
scheduler: false
pinnedFixtures: []
```

```yaml
# profiles/kenya-dev.yaml — Kenya tenant + admin only
maxTier: 1
tenant: ke
tenants: [ke]
locales: [en_IN]
personas: []
overlays: []
scheduler: false
pinnedFixtures: []
```

Validated with a zod schema. Unknown top-level fields warn but don't fail (forward compatibility). Missing required field (`maxTier`, `tenant`) → throw on load.

## Data flow

1. Operator: `CONTEXT_PROFILE=profiles/naipepea.yaml npx playwright test --project tier1`
2. Playwright loads `playwright.config.ts`; the `tier1` project filters test titles by `@tier:1` grep.
3. For each spec, Playwright calls `beforeAll`, which invokes `assertContext({ tier, requires })`.
4. First `assertContext` call loads + validates + caches the profile.
5. `assertContext` runs the skip checks (tier first, then each requires field).
6. First miss → `test.skip(true, '<descriptive reason>')`. All checks pass → no-op.
7. Reporter outputs per-project pass/skip/fail counts.

## Error handling

| Condition | Behavior |
|-----------|----------|
| `CONTEXT_PROFILE` unset | Default to `profiles/fresh-ci.yaml`. Print warning. |
| Profile file missing | Throw on first `assertContext` call with the path it tried. |
| YAML parse error | Throw on first call with line/col. |
| Schema validation fails | Throw on first call with which field failed. |
| `maxTier` field missing | Throw — required field. |
| `assertContext` called with `tier` outside 1..3 | Throw (programmer error). |
| `assertContext` called outside `beforeAll` | Works but test has already started; we accept this for now. Future: lint rule. |
| Operator passes both `--project tier1` and a spec that calls `assertContext({ tier: 3 })` | Test never executes (project grep doesn't match), so `assertContext` doesn't fire. Expected. |

## Testing the mechanism itself

Three layers:
1. **Unit tests** for `assertContext`: feed mock profiles + mock spec objects, assert correct skip behavior across each field. Lives at `tests/utils/__tests__/context.spec.ts` using `@playwright/test` (already in devDependencies; no new test runner).
2. **Integration sanity**: a one-off canary spec that asserts:
   - Loading `profiles/fresh-ci.yaml` skips Tier 2 and Tier 3 tests.
   - Loading `profiles/naipepea.yaml` skips nothing on tier alone.
3. **Profile audit** (optional, future): a `CONTEXT_PROFILE_VERIFY=1` mode that probes each declared overlay/persona endpoint before tests run and warns if reality diverges from the profile.

## Migration plan

234 tests across ~60 spec files. Within most files, tests share a tier — so one `assertContext` in the describe-level `beforeAll` covers all tests in that file. Files with mixed tiers (a minority) get per-`test.describe` calls.

Execution: **all 6 buckets in parallel via Explore agents**. Each agent receives the verification data from Phase 1 (knows the corrected tier per test) and the API spec. ~30–60 min wall time.

Per-agent task: for each spec file in their bucket:
1. Add `import { assertContext } from '../utils/context';` at top.
2. Add `@tier:N` to the outer `test.describe` title (drives the Playwright project grep).
3. Add `assertContext({ tier, requires })` at the top of each `beforeAll`. Translate the CSV's freeform Prereqs column into the structured `requires` shape using this guide:

| CSV Prereq fragment | Structured field |
|---------------------|------------------|
| "BASE_URL reachable; ADMIN configurator login; headless browser; UI served" | (none — Tier 1 baseline, no `requires` needed) |
| "GRO persona (ASSIGN)" | `personas: ['gro-in-pgr-dept']` |
| "PGR_LME in the service-code department (assignee)" | `personas: ['lme-in-pgr-dept']` |
| "ward-scoped CSR + ADMIN boundary hierarchy seeded" | `personas: ['ward-scoped-csr', 'admin-boundary-hierarchy']` |
| "reportingTo HRMS chain" | `personas: ['reportingto-chain-2-level']` |
| "SYSTEM/AUTO_ESCALATE roles" | `personas: ['system-auto-escalate-role']` |
| "+ scheduler" | `scheduler: true` |
| "PINNED: sw_KE Swahili locale + en_IN labels seeded" | `locales: ['sw_KE']` (en_IN is baseline, omit) |
| "PINNED: a real city sub-tenant present in the tenants list" | `tenants: ['ke.nairobi']` |
| "PINNED: country prefix / profile field-set for the tenant" | `pinnedFixtures: ['country-prefix-+254']` |
| "PINNED: specific mobile-validation rule shape (9-digit)" | `pinnedFixtures: ['mobile-rule-9-digit-kenya']` |
| "PINNED: a seeded complaint in the expected state" + a hardcoded SRID in code | `pinnedFixtures: ['<SRID>']` |
| "Keycloak/OIDC overlay enabled (self-skips otherwise)" | `overlays: ['keycloak']` |
| "configurator + create-tenant capability (self-seeds ke.pwt* tenants; MUTATES)" | (none — already self-seeding) |
| "both citizen + employee personas" / "citizen OTP login" / "employee login (EMPLOYEE_USER)" | (none — env-var-driven login, not a requires) |

After migration, **the test files are the source of truth.** The colleague's CSV stays as a historical reference, not a runtime input. All 6 buckets land as one bundled PR (per `feedback_pm_style` — single PR for refactors in the same area).

## Phase 1 sibling work (tracked separately)

Refactor 8 tests that hardcode `T = 'ke.nairobi'` to use `process.env.DIGIT_TENANT || 'ke.nairobi'`:
- `tests/admin/configurator-mdms-fixes-2026-04-29.spec.ts` — lines 10, 38, 70, 112, 143
- `tests/employee/pgr-fixes-2026-04-29.spec.ts` — lines 5, 31, 52

Mechanical 1-line change per file. ~1–2h. Promotes 8 tests from Tier 3 → Tier 1. Can land before or alongside the skip mechanism.

## Out of scope

- **Phase 3 "run + measure"** — once this mechanism lands, design a separate spec for: which profiles to maintain, how often CI runs each, where the per-tier pass/skip/fail dashboard lives. Will reference this spec.
- **Reclassifying the other ~44 misclassified tests** beyond the 8 trivial cases — user parked this decision.
- **Tightening the Tier 1 / Tier 2 definitional overlap** — flagged for follow-up.
- **SRID-refactoring `pgr-details.spec.ts`** to self-seed terminal states — real engineering, separate decision.

## Open risks

- **Profile drift.** A profile claims `personas: [gro-in-pgr-dept]` but the deployment lost that employee. Tests run, then fail mid-flight. Mitigation: the optional `CONTEXT_PROFILE_VERIFY=1` probe (future enhancement).
- **String typos in personas/overlays.** Open strings are flexible but easy to mis-spell. Mitigation: a CI script that diffs all `requires.personas` across the test tree against the union of profiles and warns on orphans.
- **Mixed-tier specs.** Some spec files (e.g., `complaints.spec.ts` per Bucket C's debatable verdict) have tests at different tiers. We're betting most files are single-tier; if too many turn out mixed, the per-`describe` ergonomics may bite.
