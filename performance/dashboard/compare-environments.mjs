#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';

function usage(message) {
  if (message) console.error(`compare-environments: ${message}`);
  console.error(`Usage:
  compare-environments.mjs REFERENCE.json CANDIDATE.json [options]

Options:
  --mode full|dashboard-hot-path  Compare every Compose service or dashboard path only
  --require-host-match            Require logical CPU and memory (within 2%) to match
  --check-config                  Compare hashed container runtime configuration
  --allow-image-drift SERVICE     Document an intentional component-under-test image
  --allow-config-drift SERVICE    Document an intentional service config difference
  --output FILE                   Also write the report as JSON`);
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length < 2) usage();
const referencePath = args.shift();
const candidatePath = args.shift();
let mode = 'full';
let requireHostMatch = false;
let checkConfig = false;
let outputPath = '';
const allowedConfigDrift = new Set();
const allowedImageDrift = new Set();

while (args.length) {
  const flag = args.shift();
  if (flag === '--require-host-match') requireHostMatch = true;
  else if (flag === '--check-config') checkConfig = true;
  else if (flag === '--mode') mode = args.shift() || usage('--mode requires a value');
  else if (flag === '--output') outputPath = args.shift() || usage('--output requires a value');
  else if (flag === '--allow-image-drift') allowedImageDrift.add(args.shift() || usage('--allow-image-drift requires a service'));
  else if (flag === '--allow-config-drift') allowedConfigDrift.add(args.shift() || usage('--allow-config-drift requires a service'));
  else usage(`unknown option: ${flag}`);
}
if (!['full', 'dashboard-hot-path'].includes(mode)) usage('--mode must be full or dashboard-hot-path');

const reference = JSON.parse(readFileSync(referencePath, 'utf8'));
const candidate = JSON.parse(readFileSync(candidatePath, 'utf8'));
const hotPath = new Set([
  'postgres', 'pgbouncer', 'pgr-services', 'egov-workflow-v2', 'egov-persister',
  'kafka', 'redpanda', 'redis', 'kong', 'digit-ui', 'mdms-backend',
  'egov-mdms-service', 'boundary-service', 'egov-bndry-mgmnt', 'egov-user',
  'egov-accesscontrol', 'egov-localization', 'otel-collector', 'prometheus',
  'tempo', 'grafana',
]);

function byService(manifest) {
  const result = new Map();
  for (const container of manifest.containers || []) {
    if (!container.service) continue;
    if (mode === 'dashboard-hot-path' && !hotPath.has(container.service)) continue;
    const values = result.get(container.service) || [];
    values.push(container);
    result.set(container.service, values);
  }
  return result;
}

function identity(container) {
  return container.imageId || container.image;
}

const refServices = byService(reference);
const candidateServices = byService(candidate);
const failures = [];
const warnings = [];
const matches = [];

for (const [service, refContainers] of refServices) {
  const candidates = candidateServices.get(service);
  if (!candidates) {
    failures.push({ type: 'missing-service', service });
    continue;
  }
  const refImages = [...new Set(refContainers.map(identity))].sort();
  const candidateImages = [...new Set(candidates.map(identity))].sort();
  if (JSON.stringify(refImages) !== JSON.stringify(candidateImages)) {
    const finding = { type: 'image-mismatch', service, reference: refImages, candidate: candidateImages };
    if (allowedImageDrift.has(service)) warnings.push(finding);
    else failures.push(finding);
    continue;
  }
  if (checkConfig) {
    const refConfigs = [...new Set(refContainers.map((item) => item.configFingerprint).filter(Boolean))].sort();
    const candidateConfigs = [...new Set(candidates.map((item) => item.configFingerprint).filter(Boolean))].sort();
    if (JSON.stringify(refConfigs) !== JSON.stringify(candidateConfigs)) {
      const finding = { type: 'config-mismatch', service, reference: refConfigs, candidate: candidateConfigs };
      if (allowedConfigDrift.has(service)) warnings.push(finding);
      else failures.push(finding);
      continue;
    }
  }
  matches.push(service);
}

for (const service of candidateServices.keys()) {
  if (!refServices.has(service)) warnings.push({ type: 'extra-service', service });
}

if (requireHostMatch) {
  const refCpu = Number(reference.host?.logicalCpus || 0);
  const candidateCpu = Number(candidate.host?.logicalCpus || 0);
  if (refCpu !== candidateCpu) failures.push({ type: 'host-cpu-mismatch', reference: refCpu, candidate: candidateCpu });
  const refMemory = Number(reference.host?.memoryBytes || 0);
  const candidateMemory = Number(candidate.host?.memoryBytes || 0);
  const drift = refMemory ? Math.abs(candidateMemory - refMemory) / refMemory : 1;
  if (drift > 0.02) failures.push({ type: 'host-memory-mismatch', reference: refMemory, candidate: candidateMemory, tolerance: 0.02 });
}

const report = {
  generatedAt: new Date().toISOString(),
  reference: referencePath,
  candidate: candidatePath,
  mode,
  requireHostMatch,
  checkConfig,
  allowedConfigDrift: [...allowedConfigDrift].sort(),
  allowedImageDrift: [...allowedImageDrift].sort(),
  matchedServices: matches.sort(),
  failures,
  warnings,
  comparable: failures.length === 0,
};

const rendered = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) writeFileSync(outputPath, rendered);
process.stdout.write(rendered);
if (failures.length) process.exit(1);
