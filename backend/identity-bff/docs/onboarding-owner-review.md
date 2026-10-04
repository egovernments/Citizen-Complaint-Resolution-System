# Onboarding integration review

Owner: onboarding-owner. Review checkpoint: 2026-10-04.
This records integration requirements, not a completion claim.

## Current evidence

- Owner branch includes corrected base `75b157446`, binding provider
  `6831f1eb9` and revocation provider `2743ddf82`. Owner BFF typecheck passed
  after the revocation merge. Owner draft PR is #53 into
  `identity/completion-base`.
- Deployment wiring `a8229dc7a` and MCP seed build preparation pass 107/107
  static checks across `deployment-contracts`, `onboarding-deployment-contracts`
  and `mcp-baseline-packaging`. Build-wrapper checks use local Git/Docker
  stubs; no image build, push or deployment has run.
- Draft fork PR #45 (`identity/onb-primitives` → `identity/lane-d`) stages
  primitives, the raw Organization reader, and lifecycle visibility. Its
  reviewed log reports 316 passed, two skipped and 12 todo. Production route
  registration, actual binding/revocation integration and worker removal were
  still pending at the reviewed head `b1313c147`.
- Primitives recovery commit `38c904d88` adds durable replacement high-water
  fencing, raw tenant enumeration and strict stored authority checks. Reviewed
  its reader diff and passing two-file/48-test log. The approved matching
  pending FAILED settlement and real revocation integration are follow-ups;
  the complete child task remains accepted.
- Draft fork PR #46 initially commits only the agreed PGR workspace/rename
  contract at `b0f7b3777`. PGR implementation remains in progress.
- Preserve raw reader commit `6c2e0d98c`: core has consumed the identical
  commit. Further integration uses merges and additive fixes.

## Acceptance checkpoints

| Area | Required integration evidence | Owner |
|---|---|---|
| Attempt ownership | Executed slug/tenant races, same-attempt payload conflict, stale calls on every mutation after newer failure | onb-primitives |
| Interrupted changed-slug restart | Crash after old Organization becomes FAILED and before replacement creation; older calls remain fenced; retry recovers | onb-primitives |
| Attempt authority | Ambiguous or malformed stored attempt metadata fails closed before mutation | onb-primitives |
| Founder binding | Actual core store rejects changed UUID/removed binding, enforces UUID uniqueness, and defers founder credential until first select | onb-primitives + core |
| Lifecycle | Actual revocation provider handles repeated FAILED and interrupted fan-out; supersession repair must not revoke a newer ACTIVE replacement | onb-primitives + core |
| Route integration | Registered production routes enforce dedicated auth and frozen response/error contracts; old fixtures migrated without losing coverage | onb-primitives |
| PGR recovery | Real resubmit endpoint, step-boundary crashes, persisted lifecycle decision and acknowledgement replay, unchanged founder | onb-pgr |
| No identity side effects | Durable ensure-started marker across all restarts; only never-started operations settle FAILED as NO_IDENTITY_SIDE_EFFECTS | onb-pgr |
| Baseline | One versioned artifact for PGR and packaged MCP; no live tenant cloning; internal API bootstrap followed by founder action through Kong | onb-pgr |
| Workspace and rename | Agreed contract, live tenant admin authorization, probes, legacy open behavior, version races and durable rename replay | onb-pgr |
| Citizen lookup | Existing BFF citizen found by mobile without duplication; unrelated upsert behavior preserved | onb-pgr |
| Cutover | PGR switch and BFF worker removal in same owner PR, with executed replacement map and deployment config checks | onboarding-owner + both reports |

## Shared deployment configuration inventory

The deployment configuration hunks below are owned by onboarding under root
and surfaces agreement. PGR/BFF runtime changes remain with the leaves.

- `local-setup/ansible/templates/digit.env.j2`: existing BFF provisioner and
  onboarding-worker settings.
- `local-setup/ansible/playbook-deploy.yml`: independently generated worker
  token and provisioner secret rendering. Keep secret values out of evidence.
- `local-setup/ansible/inventory/host_vars/_example.yml`: old onboarding worker
  and provisioner examples.
- BFF deployment env example and runtime startup: onb-primitives removes
  worker/provisioner configuration only with the PGR replacement.
- PGR `application.properties`: onb-pgr supplies final internal host,
  provisioner, runner and dedicated onboarding-token names.
- Deployment contract tests: verify credential ownership and token wiring
  against the final templates. No host deployment is part of this lane.

## Review constraints

Do not mark the parent or child tasks implemented from staged test counts.
Do not remove a worker test before its replacement is executed. The final
owner PR targets `identity/completion-base` on the fork and remains draft.
