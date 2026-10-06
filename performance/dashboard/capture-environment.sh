#!/usr/bin/env bash

set -euo pipefail

OUTPUT_PATH="${1:-}"
[[ -n "${OUTPUT_PATH}" ]] || {
  echo 'usage: capture-environment.sh OUTPUT.json' >&2
  exit 2
}
DOCKER_CMD=(docker)
if [[ "${DASHBOARD_DOCKER_SUDO:-}" == '1' ]]; then DOCKER_CMD=(sudo -n docker); fi
command -v docker >/dev/null 2>&1 || {
  echo 'capture-environment: docker is required on the target host' >&2
  exit 2
}
command -v jq >/dev/null 2>&1 || {
  echo 'capture-environment: jq is required on the target host' >&2
  exit 2
}
if command -v sha256sum >/dev/null 2>&1; then
  HASH_CMD=(sha256sum)
elif command -v shasum >/dev/null 2>&1; then
  HASH_CMD=(shasum -a 256)
else
  echo 'capture-environment: sha256sum or shasum is required on the target host' >&2
  exit 2
fi

if [[ "${OUTPUT_PATH}" == '-' ]]; then
  TEMP_PATH="$(mktemp)"
else
  mkdir -p "$(dirname "${OUTPUT_PATH}")"
  TEMP_PATH="${OUTPUT_PATH}.tmp"
fi
trap 'rm -f "${TEMP_PATH}"' EXIT
HOST_CPUS="$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc)"
KERNEL="$(uname -srmo)"
if [[ -r /proc/meminfo ]]; then
  HOST_MEMORY_BYTES="$(awk '/MemTotal:/{print $2 * 1024}' /proc/meminfo)"
  CPU_MODEL="$(awk -F: '/model name/{sub(/^[[:space:]]+/, "", $2); print $2; exit}' /proc/cpuinfo)"
else
  HOST_MEMORY_BYTES="$(sysctl -n hw.memsize 2>/dev/null || echo 0)"
  CPU_MODEL="$(sysctl -n machdep.cpu.brand_string 2>/dev/null || sysctl -n hw.model 2>/dev/null || echo unknown)"
fi
DOCKER_VERSION="$("${DOCKER_CMD[@]}" version --format '{{.Server.Version}}')"

{
  printf '{\n'
  printf '  "capturedAt": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "host": {"logicalCpus": %s, "memoryBytes": %.0f, "cpuModel": %s, "kernel": %s},\n' \
    "${HOST_CPUS}" "${HOST_MEMORY_BYTES}" \
    "$(printf '%s' "${CPU_MODEL}" | jq -Rsa .)" "$(printf '%s' "${KERNEL}" | jq -Rsa .)"
  printf '  "dockerVersion": %s,\n' "$(printf '%s' "${DOCKER_VERSION}" | jq -Rsa .)"
  printf '  "containers": [\n'
  first=true
  while IFS= read -r container_id; do
    [[ -n "${container_id}" ]] || continue
    if [[ "${first}" == true ]]; then first=false; else printf ',\n'; fi
    if ! effective_cpu="$("${DOCKER_CMD[@]}" exec "${container_id}" sh -c 'cat /sys/fs/cgroup/cpu.max' 2>/dev/null)"; then
      effective_cpu='unavailable'
    fi
    if ! effective_memory="$("${DOCKER_CMD[@]}" exec "${container_id}" sh -c 'cat /sys/fs/cgroup/memory.max' 2>/dev/null)"; then
      effective_memory='unavailable'
    fi
    config_fingerprint="$(
      "${DOCKER_CMD[@]}" inspect "${container_id}" --format '{{json .Config}}' |
        jq -c '{Env: ((.Env // []) | sort), Cmd, Entrypoint, WorkingDir, User}' |
        "${HASH_CMD[@]}" | awk '{print $1}'
    )"
    "${DOCKER_CMD[@]}" inspect "${container_id}" --format '{{json .}}' | jq -c \
      --arg effectiveCpuMax "${effective_cpu}" \
      --arg effectiveMemoryMax "${effective_memory}" \
      --arg configFingerprint "${config_fingerprint}" '{
      name: (.Name | ltrimstr("/")),
      service: .Config.Labels["com.docker.compose.service"],
      image: .Config.Image,
      imageId: .Image,
      state: .State.Status,
      nanoCpus: .HostConfig.NanoCpus,
      cpuPeriod: .HostConfig.CpuPeriod,
      cpuQuota: .HostConfig.CpuQuota,
      memoryBytes: .HostConfig.Memory,
      memorySwapBytes: .HostConfig.MemorySwap,
      effectiveCpuMax: $effectiveCpuMax,
      effectiveMemoryMax: $effectiveMemoryMax,
      configFingerprint: $configFingerprint,
      benchmarkSettings: [
        .Config.Env[]? |
        select(test("^(PGR_DASHBOARD_REFRESH_ENABLED|PGR_ESCALATION_ENABLED)="))
      ]
    }' | sed 's/^/    /'
  done < <("${DOCKER_CMD[@]}" ps -q | sort)
  printf '\n  ]\n}\n'
} > "${TEMP_PATH}"

if [[ "${OUTPUT_PATH}" == '-' ]]; then
  command cat "${TEMP_PATH}"
else
  mv "${TEMP_PATH}" "${OUTPUT_PATH}"
  echo "Environment manifest: ${OUTPUT_PATH}"
fi
trap - EXIT
