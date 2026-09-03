# DIGIT Learnings: What Building CMS Taught Us About the Platform

**Audience:** Technical · **Companion to:** `[docs/deployment-cms-vs-stock-digit.md](deployment-cms-vs-stock-digit.md)` · **Last updated:** 2026-08-24

## TL;DR

DIGIT has strong core services — MDMS, workflow, boundary, indexer, filestore, HRMS, user, idgen — but it ships as a platform, not a product. When we started, going from "DIGIT installed" to "citizen filing a complaint" took months, not weeks. This note lays out where the friction was and what CMS built to close it. It's the "why" behind the componentry table in the companion doc.

## Current state of DIGIT 2.9.x

The core DIGIT services and the config model (tenants, MDMS, boundaries, branding) are the right shape. What wasn't there:

- No single-VM way to run it
- No shipped admin console
- No tenant orchestration
- No shared client library
- No coherent data-model view of the platform
- Thin observability
- Component defaults that were expensive to run at pilot scale — JVM-heavy backbone, custom JWTs, env-var secrets, per-channel notification services

## Four areas of challenges

### 1. Getting to production — deployment and sizing

- **K8s-only.** Every environment — dev laptop, demo, three-month pilot, CI, training — needed a real Kubernetes cluster. That priced pilots like production, and made small-city adoption (where DIGIT should be easiest) the place the deployment barrier hit hardest.
- **No sizing benchmarks.** DIGIT doesn't ship reference sizing data. No "N complaints/day → M cores + G RAM" tables, no load profiles under a documented traffic model, no numbers for what components cost at rest vs. peak. Partners guessed. Some overbought and paid for six months of unused headroom; others underbought and hit ceilings under real traffic. When a CFO asked "what does this cost to run?", the answer was a range, not a number.

### 2. Keeping it running — operational maturity of the defaults

- **JVM-heavy backbone.** Kafka on JVM (heap tuning, GC pauses, big RAM floor), Spring Cloud Gateway sharing heap contention with the services it fronts, indexer on Elasticsearch. Real production cost before your own services show up.
- **Service lifecycle is left to the operator.** Startup order, cross-service readiness, and depth-first health checks aren't platform primitives. Because health checks are per-process, a service can look green while a downstream it depends on is degraded. Which service to restart when a particular symptom shows up lives in team runbooks and in people's heads.
- **Release engineering isn't shipped.** No expand-contract migration convention, no auto-rollback, no smoke gates, limited or no feature flags, no trunk-based development guidance. Every partner reinvents CI/CD. See `[docs/rapid-release-approach.md](rapid-release-approach.md)` for what we ended up building.
- **Thin observability defaults.** No `node-exporter` in deployments before mid-2026, no default container-log rotation cap (long-lived containers grow logs forever until disk fills), shallow health checks (an API tile reads green because the process is up, even when the API is failing).

### 3. Shipping value — product-surface gaps

- **No admin console.** MDMS masters were per-service JSON, hand-edited. Every partner either edited JSON directly or built a thin admin UI. We built a **Configurator** to ease both platform and product setup.
- **No tenant orchestration.** Onboarding a city meant many manual steps — infra → cluster → charts → secrets → tenant → boundaries → MDMS → users — with no idempotent runner. We built **digit-mcp** to make it programmatic, repeatable, and callable from AI agents.
- **No coherent data-model view of the platform or products.** DIGIT's data surface is spread across MDMS masters, boundary hierarchies, workflow business services, PGR, HRMS, user, access-control, localization, filestore — each with its own schema, read pattern, and access model. To understand what DIGIT actually holds, you had to read multiple service codebases and stitch it together. Two things we built to ease that:
 **@digit-mcp/data-provider** is a shared TypeScript client library for talking to DIGIT. It wraps DIGIT's REST APIs into typed, easy-to-call
  functions, handles auth and tenant scoping, and keeps a single list of every DIGIT resource we consume — schema, id field, access rule, all in one place. Used by our admin console (Configurator), our citizen + officer UI (digit-ui-v2), and our automation server (digit-mcp). Adding a new DIGIT resource is one entry.

  **@digit-mcp** is an MCP server that exposes DIGIT operations as typed, discoverable tools. Any MCP client — a CLI, an AI agent, or CI — can list the tools, read the schemas, and call them without reading service source. Tenant setup, boundary loads, complaint lifecycle, master validation all sit here.

  **Why they matter, together**:

  - One source of truth for DIGIT's data surface. DIGIT knowledge used to live scattered across Java service code. Now it's one registry + one
  tool catalogue. New engineers, new partners, and new AI agents learn from the same artifact.
  - Humans and AI agents share the same layer. Configurator uses it for admin flows. Officers and citizens go through it via digit-ui-v2. Agents use it for onboarding, validation, automation. A change to how DIGIT is accessed lands in one place.
  - Account automation is real. A new city onboarding — tenant, boundaries, masters, employees, validation — is scriptable and agent-driveable.
  What was multi-week manual configuration is a series of tool calls.

  Concretely: a fresh Mozambique-scale tenant used to take days of hand-editing MDMS masters, boundary hierarchies, and roles. digit-mcp now
  provisions it end-to-end against the data-provider, validates it against the same registry, and the Configurator uses the same client when
  someone later wants to edit that config by hand.

- **No shipped test suite for platform or product.** Partners either invested in their own E2E / integration / performance coverage or shipped without it. We built the Playwright + integration + k6 suite and wired it to run against deployed environments through an `integration-tests-runner` systemd service. We've also provided a performance test harness that can be pointed at any deployed instance. This has already been used in Mozambique by our team to stress test the deployment.

### 4. Customizing it — extension friction

- **Per-service MDMS ergonomics.** Adding one feature — a new master with a picker in the UI, some notification behavior, an access rule — meant touching MDMS, the service that reads that master, the UI, the notification wiring, and the access rules. Five places, five ways, no orchestrator. Data-layer changes are the long pole in DIGIT work.
- **MDMS is a storage layer, not a configuration model.** The API is generic `{ schemaCode, uniqueIdentifier, data }` records. Foreign keys between schemas, cross-schema composition, and tenant-hierarchy resolution aren't part of the platform. Schema documentation is thin — a live MDMS v2 instance returns ~18 of 31 shipped schemas with empty or self-referential descriptions, so field-level requirements have to be reverse-engineered from service source. Every consumer ends up re-implementing the missing domain layer — referential integrity, config cloning, cross-schema queries, tenant-root resolution — in application code. Our `tenant_bootstrap` tooling and the ~1,700-line MDMS-heavy MCP wrapper are examples. MDMS v2's JSON Schema helps with per-field type checking but doesn't add relationships or composition. See the [MDMS design concerns writeup](https://gist.github.com/ChakshuGautam/cc917537d6365f5223c44ceb6d6dea87) for the fuller diagnosis.
- **RBAC is not always enough.** DIGIT's baseline access model is coarse-grained RBAC. However, most implementations need finer grained access control with jurisdictions/departments similar to the Andhra stack. CMS designed and built a simple ABAC framework — see `docs/design/generic-abac-policy-framework-design.md`, `composable-scope-policies-design.md`, `field-level-attribute-access-design.md`, and `masters-configurator-access-policy-design.md`. 
- **No config-service abstraction beyond MDMS.** Anything that wasn't a master had no home. It was scattered between Helm env files (credentials for SMS, WhatsApp etc..) and the configs repo. Config resolution rules per tenant, defaults & fallbacks per tenant etc.. were not explicitly mapped.
- **Notifications required a full redesign.** egov-notification-* per-channel services meant every new channel was a new service. Templates, routing, retries and provider mapping had no shipped model. We adopted Novu and built `novu-bridge` plus provider-template mapping (`[docs/plans/2026-07-06-provider-template-mapping-design.md](plans/2026-07-06-provider-template-mapping-design.md)`) to give notifications a workflow / template / channel model.
- **Frontend framework friction.** digit-ui (webpack, multi-repo) was slow to build and expensive to theme per tenant. `digit-ui-v2` (esbuild, monorepo) closed most of that gap. We build in about 5 minutes and deploy quickly. That sped up development and iteration. While a lot of workflow is configuration in the backend, the FE hardcodes states and is not as dynamic. We had to change the hard coding. 

## What we invested in

The full mapping is the componentry table in `[docs/deployment-cms-vs-stock-digit.md](deployment-cms-vs-stock-digit.md)`. In shape:

- **Ansible single-VM path** so dev / demo / pilot / CI can exist without a cluster.
- **Componentry swaps** where the default's operational cost was too high — Redpanda for Kafka (RAM, GC, cold-boot), Kong for Spring Cloud Gateway (off-JVM, declarative), Keycloak for egov-user JWTs (standards-based, federatable), OpenBao for env-var secrets (rotation, audit).
- **Missing product-surface layers** — Configurator, digit-mcp, `@digit-mcp/data-provider`, Novu, Gatus + custom Grafana dashboards, Playwright + integration + k6.
- **Release-engineering baseline** — trunk + nightly + weekly staging + expand-contract migrations + auto-rollback + smoke gates. See `[docs/rapid-release-approach.md](rapid-release-approach.md)`.

## Why this matters going forward

A partner picking up stock DIGIT today hits every friction above. CMS delivers a packaged product experience on top of the DIGIT platform. The single-VM Ansible path is the biggest single lever — it changes the unit economics of pilots, demos, and dev. The component swaps and the added product-surface layers change the unit economics of running the product.

## Further reading

- `[docs/deployment-cms-vs-stock-digit.md](deployment-cms-vs-stock-digit.md)` — the componentry table (friction → response mapping)
- `[docs/rapid-release-approach.md](rapid-release-approach.md)` — the release-engineering baseline we built
- `[docs/2.12/operations/known-issues.md](2.12/operations/known-issues.md)` — operational patterns catalogued
- `[docs/design/](design/)` — the ABAC framework design docs
- `[docs/plans/2026-07-06-provider-template-mapping-design.md](plans/2026-07-06-provider-template-mapping-design.md)` — the notifications redesign
