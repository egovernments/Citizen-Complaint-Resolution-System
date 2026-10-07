# CCRS documentation

Docs are grouped by what the reader is trying to do. Pick the folder that matches
your question; version-specific material lives only under `releases/`.

| Folder | Question it answers |
|---|---|
| [`setup/`](setup/) | How do I get it running? |
| [`features/`](features/) | What does a feature do, and how do I configure it? |
| [`operations/`](operations/) | How do I keep it running, monitor it and migrate data? |
| [`releases/`](releases/) | What changed in a release, and how do I upgrade? |
| [`reference/`](reference/) | Where do I look up architecture, masters, config keys, services and APIs? |

## setup/

- Quickstarts: [macOS](setup/quickstart-mac.md) · [Windows](setup/quickstart-windows.md)
- [`local/`](setup/local/README.md) — local and hybrid development stacks, hot deploy, remote dev
- [`deployment/`](setup/deployment/) — [deployment modes](setup/deployment/modes.md),
  [CMS vs stock DIGIT](setup/deployment/cms-vs-stock-digit.md), sizing guides
  ([Africa](setup/deployment/decision-guide-africa.md), [India](setup/deployment/decision-guide-india.md)),
  [identity BFF](setup/deployment/identity-bff.md) ([on Helm](setup/deployment/helm-identity.md)), [Matomo](setup/deployment/matomo.md).
  The current single-machine deployment guide is [releases/2.12/deployment](releases/2.12/deployment/README.md).
- [`onboarding/`](setup/onboarding/README.md) — onboard a city and load its data, with example and sample sheets

## features/

One folder per feature; design docs sit next to the feature they describe.

- [complaint-hierarchy](features/complaint-hierarchy/README.md) · [escalation](features/escalation/README.md) ·
  [reopen-window](features/reopen-window/README.md) · [visibility](features/visibility/README.md)
- [maps](features/maps/README.md) (incl. [OpenStreetMap](features/maps/openstreetmap/README.md)) ·
  [dashboard](features/dashboard/product-overview.md) ([design](features/dashboard/design/README.md)) ·
  [analytics](features/analytics/README.md) · [notifications](features/notifications/)

## operations/

- [`monitoring/`](operations/monitoring/) — enabling monitoring, dashboard metrics, alerting
- [`data-migration/`](operations/data-migration/README.md) — how DB migrations flow, plus one-off data migrations
  (e.g. [complaint hierarchy](operations/data-migration/complaint-hierarchy/README.md))
- The 2.12 operations handbook (L1/L2 runbooks) and performance reports live under
  [releases/2.12/operations](releases/2.12/operations/README.md) and
  [releases/2.12/performance](releases/2.12/performance/README.md).

## releases/

- [2.12](releases/2.12/release-notes-v2.12.md) · [2.12-beta](releases/2.12-beta/release-notes-v2.12-beta.md) ·
  [2.11 upgrade](releases/2.11/migration-v2.10-to-v2.11.md)
- [2.20 notifications](releases/2.20/notifications/README.md): setup, migration from 2.12, providers, developer guide and the published contract (unreleased; lands with the notifications PR #2097)
- [Rapid release approach](releases/rapid-release-approach.md)

## reference/

- [`architecture/`](reference/architecture/) — [HLD](reference/architecture/HLD.md),
  [DIGIT learnings](reference/architecture/digit-learnings.md),
  [access control / ABAC](reference/architecture/access-control/),
  [config service](reference/architecture/config-service/LLD.md)
- [`mdms/`](reference/mdms/README.md) — MDMS schema reference
- [`global-config/`](reference/global-config/README.md) — `globalConfigs.js` key inventory
- [`services/`](reference/services/) — [stack reference](reference/services/stack-reference.md),
  [service startup sequence](reference/services/startup-sequence.md)
- [`api/`](reference/api/) — OpenAPI specs

## Conventions

- **Feature docs link to reference, not copy it.** List only the settings a feature uses and link to
  `reference/mdms/`, `reference/global-config/` for the full schema.
- **Module-local docs stay with their code** (`digit-mcp/`, `configurator/docs/`, `backend/*/README.md`,
  `devops/deploy-as-code/`).
- **No agent plans or QA screenshots in `docs/`.**
