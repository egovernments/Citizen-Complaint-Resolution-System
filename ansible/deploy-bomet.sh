#!/bin/bash
# Deploy DIGIT stack to Bomet server (10.0.0.2)
# Domain: bometfeedbackhub.digit.org
# Tenant: ke.bomet (Bomet County, Kenya)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Check if esbuild HMR is running — it binds port 18080, same as digit-ui container
if ssh -o ConnectTimeout=5 root@10.0.0.2 "tmux has-session -t esbuild 2>/dev/null" 2>/dev/null; then
  echo "WARNING: esbuild HMR is running on Bomet (tmux session 'esbuild')."
  echo "Ansible will start the digit-ui Docker container which also binds port 18080."
  echo ""
  read -p "Stop esbuild and switch to Docker mode? [Y/n] " answer
  if [[ "${answer:-Y}" =~ ^[Yy]$ ]]; then
    ssh root@10.0.0.2 "tmux kill-session -t esbuild"
    echo "Stopped esbuild HMR."
  else
    echo "Aborting. Stop esbuild manually first: ssh egov-bomet 'tmux kill-session -t esbuild'"
    exit 1
  fi
fi

echo "========================================="
echo "Deploying DIGIT to Bomet (10.0.0.2)"
echo "Domain: bometfeedbackhub.digit.org"
echo "Tenant: ke.bomet"
echo "========================================="

ansible-playbook \
  -i inventory.ini \
  --limit bomet \
  -e boot_tenant=ke.bomet \
  playbook-deploy.yml \
  "$@"

echo ""
echo "========================================="
echo "Bomet deployment complete!"
echo "UI:           https://bometfeedbackhub.digit.org/digit-ui/"
echo "Configurator: https://bometfeedbackhub.digit.org/configurator/"
echo "========================================="
