#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../../../../../" && pwd)"
fixture_dir="$(mktemp -d)"
fixture_pid=''
cleanup() {
  if [[ -n "$fixture_pid" ]]; then kill -TERM "$fixture_pid" 2>/dev/null || true; wait "$fixture_pid" 2>/dev/null || true; fi
  rm -rf "$fixture_dir"
}
trap cleanup EXIT
cd "$repo_root/backend/identity-bff"
node --import tsx ../pgr-services/src/test/fixtures/bff-onboarding.mts "$fixture_dir/ready.json" > "$fixture_dir/bff.log" 2>&1 &
fixture_pid=$!
for ((attempt=0; attempt<100; attempt++)); do
  [[ -f "$fixture_dir/ready.json" ]] && break
  if ! kill -0 "$fixture_pid" 2>/dev/null; then cat "$fixture_dir/bff.log"; exit 1; fi
  sleep 0.1
done
[[ -f "$fixture_dir/ready.json" ]] || { echo 'BFF fixture startup timed out'; exit 1; }
fixture_base="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).base)' "$fixture_dir/ready.json")"
cd "$repo_root"
maven_args=(-o -q -f backend/pgr-services/pom.xml
  "-Donboarding.test.jdbc=${ONBOARDING_TEST_JDBC:-jdbc:postgresql://127.0.0.1:16432/onboarding_test}"
  "-Donboarding.test.bff=$fixture_base")
if [[ "${1:-}" != '--full' ]]; then
  maven_args+=(-Dtest=OnboardingPostgresTest,OnboardingStepsTest,OnboardingRecoveryTest,OnboardingProvisionerClientTest,CitizenLookupTest)
fi
mvn "${maven_args[@]}" test
