#!/bin/bash
# Deploy DIGIT stack to Nairobi server (10.0.0.5)
# Domain: naipepea.digit.org
# Tenant: ke.nairobi (Nairobi County, Kenya)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Check if esbuild HMR is running — it binds port 18080, same as digit-ui container
if ssh -o ConnectTimeout=5 root@10.0.0.5 "tmux has-session -t esbuild 2>/dev/null" 2>/dev/null; then
  echo "WARNING: esbuild HMR is running on Nairobi (tmux session 'esbuild')."
  echo "Ansible will start the digit-ui Docker container which also binds port 18080."
  echo ""
  read -p "Stop esbuild and switch to Docker mode? [Y/n] " answer
  if [[ "${answer:-Y}" =~ ^[Yy]$ ]]; then
    ssh root@10.0.0.5 "tmux kill-session -t esbuild"
    echo "Stopped esbuild HMR."
  else
    echo "Aborting. Stop esbuild manually first: ssh egov-nairobi 'tmux kill-session -t esbuild'"
    exit 1
  fi
fi

echo "========================================="
echo "Deploying DIGIT to Nairobi (10.0.0.5)"
echo "Domain: naipepea.digit.org"
echo "Tenant: ke.nairobi"
echo "========================================="

ansible-playbook \
  -i inventory.ini \
  --limit nairobi \
  -e boot_tenant=ke.nairobi \
  playbook-deploy.yml \
  "$@"

echo ""
echo "========================================="
echo "Nairobi deployment complete!"
echo "UI:           https://naipepea.digit.org/digit-ui/"
echo "Configurator: https://naipepea.digit.org/configurator/"
echo "========================================="
