#!/usr/bin/env bash
set -euo pipefail

# load-images.sh - Pull images and push to local registry for Kind cluster
# Uses localhost:5000 registry (started by setup-k8s.sh) instead of
# "kind load docker-image" which has issues with Docker 29+/multi-platform images.
# One-time operation (~15 min on first run, cached after)

REG_PORT=5000

IMAGES=(
  # Infrastructure
  "postgres:16"
  "edoburu/pgbouncer:latest"
  "redis:7.2.4"
  "redpandadata/redpanda:v24.1.1"
  "minio/minio:RELEASE.2024-01-16T16-07-38Z"
  "minio/mc:RELEASE.2024-01-16T16-06-34Z"
  "nginx:alpine"
  "kong:3.6"
  "twinproduction/gatus:latest"

  # Core Services
  "egovio/mdms-v2:v2.9.2-4a60f20"
  "egovio/egov-enc-service:v2.9.2-4a60f20"
  "egovio/egov-idgen:v2.9.2-4a60f20"
  "egovio/egov-user:master-fa75ba8"
  "egovio/egov-workflow-v2:v2.9.2-4a60f20"
  "egovio/egov-localization:v2.9.2-4a60f20"
  "egovio/boundary-service:v2.9.2-4a60f20"
  "egovio/egov-accesscontrol:v2.9.2-4a60f20"
  "egovio/egov-persister:v2.9.2-4a60f20"
  "egovio/egov-filestore:v2.9.2-4a60f20"
  "egovio/egov-hrms:hrms-boundary-0a4e737"
  "egovio/egov-bndry-mgmnt:bndry-mgmnt-3794b8c"
  "egovio/egov-url-shortening:v2.9.2-4a60f20"

  # App Services
  "egovio/pgr-services:multiarch-d448cb7"
  "egovio/digit-ui:multiarch-d448cb7"
)

echo "=== Pushing ${#IMAGES[@]} images to local registry (localhost:${REG_PORT}) ==="
echo "This may take 10-15 minutes on first run..."
echo ""

LOADED=0
FAILED=0

for img in "${IMAGES[@]}"; do
  echo -n "[$((LOADED + FAILED + 1))/${#IMAGES[@]}] ${img}... "

  # Compute the local registry tag
  LOCAL_TAG="localhost:${REG_PORT}/${img}"

  # Check if already in local registry
  if docker manifest inspect "$LOCAL_TAG" &>/dev/null; then
    echo "already in registry"
    LOADED=$((LOADED + 1))
    continue
  fi

  # Pull if not already present locally
  if ! docker image inspect "$img" &>/dev/null; then
    if docker pull "$img" 2>/dev/null; then
      echo -n "pulled, "
    else
      echo "FAILED to pull"
      FAILED=$((FAILED + 1))
      continue
    fi
  else
    echo -n "cached, "
  fi

  # Tag and push to local registry
  docker tag "$img" "$LOCAL_TAG" 2>/dev/null
  if docker push "$LOCAL_TAG" 2>/dev/null; then
    echo "pushed"
    LOADED=$((LOADED + 1))
  else
    echo "FAILED to push"
    FAILED=$((FAILED + 1))
  fi
done

echo ""
echo "=== Done: ${LOADED} pushed, ${FAILED} failed ==="
echo ""
echo "Images are now available to Kind nodes via localhost:${REG_PORT}/"
echo "K8s manifests need imagePullPolicy: Always or IfNotPresent to use them."
