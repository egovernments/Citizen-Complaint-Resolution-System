# Test standardization — brief for the config / seed / tenant discussion

**Context.** We ran the *same* integration suite against two deployments of the same code — Docker-Compose (Kong gateway) and k3s (Spring gateway), both seeded with identical `mz.maputo` data — and diffed every test. Full per-test tracker: [`PARITY-TEST-MATRIX.md`](./PARITY-TEST-MATRIX.md). Fix recipes: [`PARITY-FIXES.md`](./PARITY-FIXES.md).

**Top line:** of 272 tests, the two stacks now **agree on 266**. But getting there required fixing **~35 tests that failed purely on assumptions baked into the tests, not real bugs** — which is exactly the standardization problem. The breakdown below turns each of the three asks into concrete, counted evidence + a proposed model.

---

## 1) Tests assume config that varies by deployment → **define a standard config contract (or tag tests by config)**

Tests hard-code environment facts that are true on one cluster and not another. When they diverge, it looks like a product failure but it's a test-vs-config mismatch.

**Evidence (32 tests failed on k3s for this reason alone):**

| Assumption baked into tests | Tests affected | What actually varies |
|---|---:|---|
| **Fixed OTP `123456`** | 3 | Compose default *mocks* OTP (rubber-stamps 123456); a real cluster runs real OTP and rejects it. k3s had no mock → citizen register/login tests failed. (§1.6b) |
| **UI global config** (dial code `+258`, CCRS labels, postal format) | 17 | k3s digit-ui fell back to **India defaults** (`+91`) because its `globalConfigs.js` came from a different source. Tests asserted Maputo values. (§1.8) |
| **Mobile-number format / validation rule** | 12 | The valid mobile regex is per-tenant MDMS (`^8…` for Maputo vs `^[17]…` for Kenya); tests + one UI form hard-code a Kenyan literal. (§1.6) |

**Proposal:**
- Publish **one "production-ready reference config"** (OTP mode, tenant dial code, mobile rule, label set, gateway enforcement mode) that tests are written against — and that a deploy is asserted to match before the suite runs.
- Where a value legitimately varies, **read it at runtime** (we already do this for the mobile rule via `getMobileValidationRule()` — good pattern to generalize) **or tag the test** (`@config:otp-mock`, `@config:real-otp`) so a runner can select the right set.
- Anti-pattern to kill: hard-coded literals (`123456`, `+91`, `07…`) in assertions.

---

## 2) Tests assume seed data that isn't guaranteed → **define standard seed data for tests**

Most "it passes here but not there" cases trace to *differently-assumed seed data* — a record, grant, workflow, or user the test expects but the target tenant doesn't have.

**Evidence (23 tests pass on bomet's Kenya seed but fail on both our Maputo stacks; plus several parity fixes were pure seed gaps):**
- **Onboarding (14) + Admin (8)** tests assume specific master data / boundary shapes / theme records that the Maputo seed didn't have the same way.
- Concrete parity fixes that were *seed*, not code:
  - **PGR workflow businessservice** wasn't resolvable at the city tenant → every complaint-create failed until seeded correctly (§1.9).
  - **`create — citizen user`** failed because the test's session token resolved to **insufficient roles** on the enforcing gateway — a seed/identity assumption (§2.6b).
  - **RBAC write grants** for the configurator operator differ by seed (§2.4).

**Proposal:**
- A **canonical, versioned seed fixture** the suite provisions (or asserts) before running — departments, complaint types, boundaries, the PGR workflow, the operator user + roles, theme/localization records — the same on every tenant/stack.
- Tests that need extra data should **create it in-test (run-scoped, unique)** and tear it down, rather than assuming it pre-exists.
- Make identity explicit: tests that hit RBAC-enforced endpoints should authenticate with a **known role set** (we just did this — a fresh `apiAuth()` login for `/user/*` — same idea, generalize it).

---

## 3) Many skips are tenant-coupled → **generalise what can be tenant-neutral**

A large share of "skips" aren't gaps — they're tests wired to one tenant's fixtures, so they silently no-op on any other tenant. That hides signal (a skipped test asserts nothing).

**Evidence (25 tests run on bomet/Kenya but skip on both our Maputo stacks):**
- **Admin (13)** — boundary-hierarchy shape, department-chip dropdowns, deactivation guards, upsert round-trips: mostly assert on *specific seeded records* that only exist on Kenya.
- **Keycloak (7)** — skip where the overlay/tenant isn't wired.
- **Onboarding (3), api+smoke (2)**.

**Proposal:**
- Audit the tenant-coupled skips: many assert **structure/behaviour** (e.g. "boundary comes back as an array", "duplicate hierarchyType is rejected") that is **tenant-neutral** — rewrite them to create their own fixture or assert shape, not a hard-coded seeded value.
- Keep genuinely tenant-specific tests **tagged** (`@tenant:bomet`) and out of the general pass-rate, so a skip is a deliberate scope decision, not accidental silence.
- Target: move as much of the 25 as possible from "skips-on-non-Kenya" to "runs-anywhere".

---

## The ask, in one line
Define **(a) a reference config contract**, **(b) a canonical seed fixture**, and **(c) a tenant-neutral-by-default test policy (tag the exceptions)** — then a test failing means a real regression, not an environment assumption. The parity matrix is the evidence base and can double as the tracker for this cleanup.

*Numbers current as of the latest run; see the matrix for the live per-test state.*
