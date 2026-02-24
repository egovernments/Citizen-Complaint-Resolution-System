#!/usr/bin/env bash
set -euo pipefail

# setup-k8s.sh - Create Kind cluster with local registry for DIGIT development
# Usage: ./scripts/setup-k8s.sh [cluster-name]

CLUSTER_NAME="${1:-ccrs}"
REG_NAME="kind-registry"
REG_PORT=5000
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== DIGIT K8s Dev Environment Setup ==="
echo "Cluster: $CLUSTER_NAME"
echo "Project: $PROJECT_DIR"

# 1. Start local Docker registry (if not running)
if [ "$(docker inspect -f '{{.State.Running}}' "${REG_NAME}" 2>/dev/null || true)" != 'true' ]; then
  echo "Starting local Docker registry on port ${REG_PORT}..."
  docker run -d --restart=always -p "127.0.0.1:${REG_PORT}:5000" --network bridge --name "${REG_NAME}" registry:2
else
  echo "Registry already running."
fi

# 2. Create Kind cluster if not exists
if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
  echo "Cluster '${CLUSTER_NAME}' already exists."
else
  echo "Creating Kind cluster '${CLUSTER_NAME}'..."

  cat <<EOF | kind create cluster --name "${CLUSTER_NAME}" --config=-
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
containerdConfigPatches:
  - |-
    [plugins."io.containerd.grpc.v1.cri".registry.mirrors."localhost:${REG_PORT}"]
      endpoint = ["http://${REG_NAME}:5000"]
nodes:
  - role: control-plane
    extraPortMappings:
      - containerPort: 30000
        hostPort: 30000
        protocol: TCP
      - containerPort: 30001
        hostPort: 30001
        protocol: TCP
      - containerPort: 30080
        hostPort: 30080
        protocol: TCP
      - containerPort: 30443
        hostPort: 30443
        protocol: TCP
    kubeadmConfigPatches:
      - |
        kind: InitConfiguration
        nodeRegistration:
          kubeletExtraArgs:
            node-labels: "ingress-ready=true"
    extraMounts:
      - hostPath: ${PROJECT_DIR}/db
        containerPath: /data/db
        readOnly: true
  - role: worker
    extraMounts:
      - hostPath: ${PROJECT_DIR}/db
        containerPath: /data/db
        readOnly: true
  - role: worker
    extraMounts:
      - hostPath: ${PROJECT_DIR}/db
        containerPath: /data/db
        readOnly: true
EOF
fi

# 3. Connect registry to Kind network
if [ "$(docker inspect -f='{{json .NetworkSettings.Networks.kind}}' "${REG_NAME}" 2>/dev/null)" = 'null' ] || \
   [ "$(docker inspect -f='{{json .NetworkSettings.Networks.kind}}' "${REG_NAME}" 2>/dev/null)" = '' ]; then
  echo "Connecting registry to Kind network..."
  docker network connect "kind" "${REG_NAME}" 2>/dev/null || true
fi

# 4. Document the local registry (KEP-1755)
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: local-registry-hosting
  namespace: kube-public
data:
  localRegistryHosting.v1: |
    host: "localhost:${REG_PORT}"
    help: "https://kind.sigs.k8s.io/docs/user/local-registry/"
EOF

# 5. Create digit namespace
kubectl create namespace digit --dry-run=client -o yaml | kubectl apply -f -

echo ""
echo "=== Setup Complete ==="
echo "Cluster: ${CLUSTER_NAME}"
echo "Registry: localhost:${REG_PORT}"
echo "Namespace: digit"
echo ""
echo "Next steps:"
echo "  1. Load images: ./scripts/load-images.sh"
echo "  2. Start Tilt:  tilt up -f Tiltfile.k8s"
