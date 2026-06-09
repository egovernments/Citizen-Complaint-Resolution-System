#!/usr/bin/env bash
# Run the full test matrix: all profiles x all scenarios x both environments
# Applies CPU profiles via Ansible, then runs k6 in parallel against both machines.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ANSIBLE_DIR="${ROOT_DIR}/ansible"
SCENARIOS=(ramp-2vu ramp-10vu ramp-50vu)

# Profiles to test per environment
DEV_PROFILES=(cpu-2 cpu-4 cpu-8)
PROD_PROFILES=(cpu-2 cpu-4 cpu-8 cpu-16)

# All profiles that need to run (union, sorted)
ALL_PROFILES=(cpu-2 cpu-4 cpu-8 cpu-16)

echo "=== DIGIT Load Test Matrix ==="
echo "Scenarios: ${SCENARIOS[*]}"
echo "Dev profiles: ${DEV_PROFILES[*]}"
echo "Prod profiles: ${PROD_PROFILES[*]}"
echo ""

run_scenarios_for_env() {
  local env="$1"
  local profile="$2"
  for scenario in "${SCENARIOS[@]}"; do
    echo "[${env}/${profile}] Running ${scenario}..."
    "${SCRIPT_DIR}/run-test.sh" "$env" "$profile" "$scenario"
    echo "[${env}/${profile}] ${scenario} complete."
    echo ""
  done
}

for profile in "${ALL_PROFILES[@]}"; do
  echo "=========================================="
  echo "Phase: Applying profile ${profile}"
  echo "=========================================="

  # Apply profile via Ansible
  cd "$ANSIBLE_DIR"
  ansible-playbook playbook-profile.yml -e "cpu_profile=${profile}" -i inventory.ini
  cd "$ROOT_DIR"

  echo "Profile ${profile} applied. Waiting 30s for services to stabilize..."
  sleep 30

  # Determine which envs to test for this profile
  dev_match=false
  prod_match=false
  for p in "${DEV_PROFILES[@]}"; do [[ "$p" == "$profile" ]] && dev_match=true; done
  for p in "${PROD_PROFILES[@]}"; do [[ "$p" == "$profile" ]] && prod_match=true; done

  if $dev_match && $prod_match; then
    # Run both in parallel, redirect to separate logs to avoid interleaving
    echo "Running ${profile} tests on dev and prod in parallel..."
    run_scenarios_for_env dev "$profile" > "${ROOT_DIR}/results/dev-${profile}.log" 2>&1 &
    DEV_PID=$!
    run_scenarios_for_env prod "$profile" > "${ROOT_DIR}/results/prod-${profile}.log" 2>&1 &
    PROD_PID=$!
    wait $DEV_PID
    echo "Dev ${profile} complete. Log: results/dev-${profile}.log"
    wait $PROD_PID
    echo "Prod ${profile} complete. Log: results/prod-${profile}.log"
  elif $dev_match; then
    run_scenarios_for_env dev "$profile"
  elif $prod_match; then
    run_scenarios_for_env prod "$profile"
  fi

  echo "Phase ${profile} complete."
  echo ""
done

echo "=== Full matrix complete ==="
echo "Results in: ${ROOT_DIR}/results/"

# Generate summary
"${SCRIPT_DIR}/collect-results.sh"
