# CMS v2.20 Image Tags

**As of:** `master` at the `v2.20` tag (`48feb6d7f`). **Who this is for:** anyone deploying or upgrading CMS v2.20.

**See also:** [Release notes](release-notes-v2.20.md), [Deployment changelog](release-config-changelog-v2.20.md) and the [Migration guide](migration-guide-v2.12-to-v2.20.md).

All images are on Docker Hub under `egovio/`. **Compose** is the default in `local-setup/docker-compose.egov-digit.yaml` (used by Docker Compose and the Ansible deploy). **Helm** is the default in `devops/deploy-as-code/charts/` (used by the Kubernetes deploy). A `-db` image runs the service's database migrations and always ships with the same tag as the service.

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

Compose and Helm use the same tags for every image in this table. `identity-keycloak` and `identity-bff` are pinned to a `master` build because it carries the Keycloak realm-configure fix.

## 2. DIGIT core services

These images come from the DIGIT platform and are not rebuilt for v2.20. Where Compose and Helm differ, the row is marked **⚠**.

| Service | Compose | Helm |
| --- | --- | --- |
| egov-user | `egovio/egov-user:2.12-68f707e` | `egovio/egov-user:2.12-87e13fe` ⚠ |
| egov-workflow-v2 | `egovio/egov-workflow-v2:2.12-87e13fe` | same |
| egov-localization | `egovio/egov-localization:2.12-87e13fe` | same |
| egov-enc-service | `egovio/egov-enc-service:2.12-87e13fe` | same |
| mdms-v2 | `egovio/mdms-v2:maven-jdk21-f3a7c13` | `egovio/mdms-v2:mdms-count-api-3ac4f8e` ⚠ |
| boundary-service | `egovio/boundary-service:maven-jdk21-9f83afb` | same |
| egov-idgen | `egovio/egov-idgen:maven-jdk21-9f83afb` | same |
| egov-persister | `egovio/egov-persister:maven-jdk21-9f83afb` | same |
| egov-filestore | `egovio/egov-filestore:maven-jdk21-9f83afb` | same |
| egov-indexer | `egovio/egov-indexer:maven-jdk21-9f83afb` | same |
| egov-accesscontrol | `egovio/egov-accesscontrol:abac-changes-cb6a372` | `egovio/egov-accesscontrol:maven-jdk21-9f83afb` ⚠ |
| egov-url-shortening | `egovio/egov-url-shortening:maven-jdk21-983e8b2` | same |
| egov-hrms | `egovio/egov-hrms:2.12-beta-dd641a6` | `egovio/egov-hrms:hrms-boundary-dd641a6` ⚠ |
| egov-bndry-mgmnt | `egovio/egov-bndry-mgmnt:bndry-mgmnt-3794b8c` | `egovio/egov-bndry-mgmnt:bndry-mgmnt-8b5fc86` ⚠ |
| egov-otp | `egovio/egov-otp:v2.9.2-4a60f20` | same |
| user-otp | `egovio/user-otp:master-e22c7c5` | `egovio/user-otp:mobile-validation-user-otp-12b1961` ⚠ |
| audit-service | `egovio/audit-service:v2.9.2-4a60f20` | same |
| inbox | `egovio/inbox:state-tenant-fix` | not deployed |
| gateway | not deployed (Kong is the gateway) | `egovio/gateway:v2.9.2-4a60f20` |
| egov-notification-mail | not deployed | `egovio/egov-notification-mail:v2.9.2-4a60f20` |
| egov-notification-sms | not deployed | `egovio/egov-notification-sms:mobile-validation-user-otp-db06ec6` |
| service-request | not deployed | `egovio/service-request:v2.9.2-4a60f20` |
| egov-user-event | not deployed | `egovio/egov-user-event:v1.3.0-cf8ffdfb2b-6` |
| pdf-service | not deployed | `egovio/pdf-service:indexer-bpa-fix-vinoth-c1bb0a940f-46` |
| boundary-bulk-bff | not deployed | `egovio/boundary-bulk-bff:boundary-bulk-bff-b1a02d94-43` |

Each core service with a database also has a `-db` migration image. It uses the same tag as the service, with these exceptions:

| Migration image | Compose | Helm |
| --- | --- | --- |
| egov-user-db | `2.12-87e13fe` | `2.12-87e13fe` |
| mdms-v2-db | `maven-jdk21-9f83afb` | `maven-jdk21-9f83afb` |
| egov-accesscontrol-db | `maven-jdk21-9f83afb` | `v2.9.2-4a60f20` |

## 3. Gateway and infrastructure (Compose)

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
- **Helm:** set `image.tag` for the release in your environment file, as `devops/deploy-as-code/charts/environments/cms-saas.yaml` does for Keycloak.
