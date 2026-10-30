# CMS v2.20 Image Tags

**As of:** `master` at the `v2.20` tag (`48feb6d7f`). **Who this is for:** anyone deploying or upgrading CMS v2.20.

**See also:** [Release notes](release-notes-v2.20.md), [Deployment changelog](release-config-changelog-v2.20.md) and the [Migration guide](migration-guide-v2.12-to-v2.20.md).

All images are on Docker Hub. Tags are the defaults in `local-setup/docker-compose.egov-digit.yaml`, which the Docker Compose and Ansible deploys use. A `-db` image runs the service's database migrations.

## 1. CMS (PGR) services

These images are built from this repository and tagged for the release.

| Service | Image | Migration image |
| --- | --- | --- |
| pgr-services | `egovio/pgr-services:v2.20` | `egovio/pgr-services-db:v2.20` |
| digit-ui (citizen and employee UI) | `egovio/digit-ui-esbuild:v2.20` | — |
| configurator (DIGIT Studio) | `egovio/configurator:v2.20` | — |
| digit-mcp | `egovio/digit-mcp:v2.20` | — |
| novu-bridge | `egovio/novu-bridge:v2.20` | `egovio/novu-bridge-db:v2.20` |
| digit-config-service | `egovio/digit-config-service:v2.20` | `egovio/digit-config-service-db:v2.20` |
| digit-user-preferences-service | `egovio/digit-user-preferences-service:v2.20` | `egovio/digit-user-preferences-service-db:v2.20` |
| xstate-chatbot | `egovio/xstate-chatbot:v2.20` | `egovio/xstate-chatbot-db:v2.20` |
| identity-keycloak | `egovio/identity-keycloak:master-b6643bb` | — |
| identity-bff | `egovio/identity-bff:master-b6643bb` | — |

`identity-keycloak` and `identity-bff` are pinned to a `master` build because it carries the Keycloak realm-configure fix.

## 2. DIGIT core services

These images come from the DIGIT platform and are not rebuilt for v2.20.

| Service | Image | Migration image |
| --- | --- | --- |
| egov-user | `egovio/egov-user:2.12-68f707e` | `egovio/egov-user-db:2.12-87e13fe` |
| egov-workflow-v2 | `egovio/egov-workflow-v2:2.12-87e13fe` | `egovio/egov-workflow-v2-db:2.12-87e13fe` |
| egov-localization | `egovio/egov-localization:2.12-87e13fe` | `egovio/egov-localization-db:2.12-87e13fe` |
| egov-enc-service | `egovio/egov-enc-service:2.12-87e13fe` | `egovio/egov-enc-service-db:2.12-87e13fe` |
| mdms-v2 | `egovio/mdms-v2:maven-jdk21-f3a7c13` | `egovio/mdms-v2-db:maven-jdk21-9f83afb` |
| boundary-service | `egovio/boundary-service:maven-jdk21-9f83afb` | `egovio/boundary-service-db:maven-jdk21-9f83afb` |
| egov-idgen | `egovio/egov-idgen:maven-jdk21-9f83afb` | `egovio/egov-idgen-db:maven-jdk21-9f83afb` |
| egov-persister | `egovio/egov-persister:maven-jdk21-9f83afb` | — |
| egov-filestore | `egovio/egov-filestore:maven-jdk21-9f83afb` | `egovio/egov-filestore-db:maven-jdk21-9f83afb` |
| egov-indexer | `egovio/egov-indexer:maven-jdk21-9f83afb` | `egovio/egov-indexer-db:maven-jdk21-9f83afb` |
| egov-accesscontrol | `egovio/egov-accesscontrol:abac-changes-cb6a372` | `egovio/egov-accesscontrol-db:maven-jdk21-9f83afb` |
| egov-url-shortening | `egovio/egov-url-shortening:maven-jdk21-983e8b2` | `egovio/egov-url-shortening-db:maven-jdk21-983e8b2` |
| egov-hrms | `egovio/egov-hrms:2.12-beta-dd641a6` | `egovio/egov-hrms-db:2.12-beta-dd641a6` |
| egov-bndry-mgmnt | `egovio/egov-bndry-mgmnt:bndry-mgmnt-3794b8c` | `egovio/egov-bndry-mgmnt-db:bndry-mgmnt-3794b8c` |
| egov-otp | `egovio/egov-otp:v2.9.2-4a60f20` | `egovio/egov-otp-db:v2.9.2-4a60f20` |
| user-otp | `egovio/user-otp:master-e22c7c5` | — |
| audit-service | `egovio/audit-service:v2.9.2-4a60f20` | `egovio/audit-service-db:v2.9.2-4a60f20` |
| inbox | `egovio/inbox:state-tenant-fix` | — |

## 3. Gateway and infrastructure

| Component | Image |
| --- | --- |
| Kong gateway | `egovio/kong:3.6` |
| PostgreSQL | `egovio/postgres:16` |
| Redis | `egovio/redis:7.2.4` |
| Redpanda (Kafka) | `egovio/redpanda:v24.1.1` |
| MinIO | `egovio/minio:RELEASE.2024-01-16T16-07-38Z` |
| Elasticsearch | `egovio/elasticsearch:8.10.3` |
| Novu API, worker, WebSocket, dashboard | `ghcr.io/novuhq/novu/*:2.3.0` |
| MongoDB (for Novu) | `mongo:8.0.3` |

## 4. Overriding a tag

- **Compose:** set the matching environment variable, for example `PGR_SERVICES_IMAGE=egovio/pgr-services:<tag>`.
- **Ansible:** `./deploy.sh <tenant> --image-tag=<tag>` moves every CMS image in section 1; add `--image-tag-services=pgr-services` to move only some.
