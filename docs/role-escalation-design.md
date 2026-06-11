# Optional role-level escalation — design (moved)

> Consolidated into
> [escalation-feature-design.md § Role-level escalation](./escalation-feature-design.md#role-level-escalation-opt-in)
> on 2026-06-11 — this file is kept only so older links (PR #815 and
> review/discussion comments) keep resolving. Do not extend this file;
> edit the consolidated section instead.

What lives there now:

- **Problem + design stance** — the PRD's unowned-complaint primary journey; opt-in, exactly-one-individual, deterministic, honest about the #1674 ASSIGN-persistence interaction (fix now deployed on current deployments).
- **Configuration** — the `roleEscalation` object on `CRS.EscalationPolicy` and the `CRS.RoleSupervisors` pin schema (verbatim JSON + annotations in the consolidated doc's Schemas section).
- **R1 → R2 → R3 resolution** — pin → ladder → reportingTo consensus, with the review hardening (tenant-keyed memoization, HRMS truncation guard, tri-state lookups, `maxPerScan` + backlog convergence).
- **Skip-don't-guess, provenance, concurrency** — the three new skip reasons with operator fixes; `resolutionStrategy` / `actingRole` / `candidateCount` / `departmentFiltered` on outcomes, Kafka events and OTEL spans; the scan guard (HTTP 409) and the SYSTEM-identity observation.
- **Operator UI, verification, rollout** — the Escalation Settings opt-in block (incl. the city-tenant pin-lookup limitation), the four live suites (R1 / R2-R3 / baseline / UI), and the rollout runbook.
