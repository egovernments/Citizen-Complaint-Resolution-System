ARG KEYCLOAK_VERSION=26.7.3
ARG MAGIC_LINK_VERSION=0.75
ARG NODE_VERSION=22

FROM alpine:3.22 AS extension
ARG MAGIC_LINK_VERSION
ARG MAGIC_LINK_SHA256=cf39e6b2c7f640af09d4a983554f1bd38aec3283313be25af40f58fe078fd5b7
RUN wget -q \
      "https://repo1.maven.org/maven2/io/phasetwo/keycloak/keycloak-magic-link/${MAGIC_LINK_VERSION}/keycloak-magic-link-${MAGIC_LINK_VERSION}.jar" \
      -O /keycloak-magic-link.jar \
    && echo "${MAGIC_LINK_SHA256}  /keycloak-magic-link.jar" | sha256sum -c -

# The Keycloakify login theme (theme-src). Built here rather than
# committed so the jar in the image always matches the reviewed sources.
# Keycloakify packages the jar with Maven, hence the JDK in this stage; none of
# it reaches the runtime image.
FROM node:${NODE_VERSION}-bookworm-slim AS theme
RUN apt-get update \
    && apt-get install -y --no-install-recommends maven \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /theme
COPY theme-src/package.json theme-src/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY theme-src/ ./
RUN npm run build-keycloak-theme \
    && test -f dist_keycloak/configurator-blue-login-theme.jar

# A static jq, so this image can also run configure-keycloak.sh as the Helm
# realm-configure Job (devops/deploy-as-code/charts/identity/keycloak). The
# Keycloak base image has bash and kcadm.sh but no jq. Pinned by index digest.
FROM ghcr.io/jqlang/jq:1.8.1@sha256:4f34c6d23f4b1372ac789752cc955dc67c2ae177eb1b5860b75cdc5091ce6f91 AS jq

FROM quay.io/keycloak/keycloak:${KEYCLOAK_VERSION} AS builder
COPY --from=extension --chown=keycloak:keycloak /keycloak-magic-link.jar /opt/keycloak/providers/keycloak-magic-link.jar
COPY --from=theme --chown=keycloak:keycloak /theme/dist_keycloak/configurator-blue-login-theme.jar /opt/keycloak/providers/configurator-blue-login-theme.jar
RUN /opt/keycloak/bin/kc.sh build --db=postgres --health-enabled=true

FROM quay.io/keycloak/keycloak:${KEYCLOAK_VERSION}
COPY --from=builder /opt/keycloak/ /opt/keycloak/
COPY --from=jq /jq /usr/bin/jq
# The realm reconcile and the declared realm, which the Helm realm-configure
# Job runs from this image (KEYCLOAK_KCADM_SERVER set: kcadm runs here and
# reaches Keycloak over its Service), so the Job always matches the image it
# runs in. Compose/Ansible run the repository copy on the host instead.
COPY configure-keycloak.sh realm.json /opt/identity/
