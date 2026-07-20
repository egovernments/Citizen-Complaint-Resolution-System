import { sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import exec from 'k6/execution';
import { login } from '../helpers/auth.js';
import { createComplaint, updateComplaint, searchComplaint } from '../helpers/pgr.js';
import { getEnv } from '../config/environments.js';

// Custom metrics — same as other scenarios for consistent reporting
export const transactionDuration = new Trend('transaction_duration', true);
export const transactionSuccess = new Rate('transaction_success');

// Per-phase metrics for breakdown
export const spikeDuration = new Trend('spike_duration', true);
export const valleyDuration = new Trend('valley_duration', true);
export const sustainedDuration = new Trend('sustained_duration', true);

// Per-VU auth cache
let employeeToken = null;
let employeeUserInfo = null;
let iterationCount = 0;

const SERVICE_CODES = [
  'StreetLightNotWorking', 'NoStreetlight', 'GarbageNeedsTobeCleared',
  'BurningOfGarbage', 'DamagedGarbageBin', 'NonSweepingOfRoad',
  'OverflowingOrBlockedDrain', 'NoWaterSupply', 'ShortageOfWater',
  'DirtyWaterSupply', 'BrokenWaterPipeOrLeakage', 'WaterPressureisVeryLess',
  'BlockOrOverflowingSewage', 'illegalDischargeOfSewage', 'DamagedRoad',
  'WaterLoggedRoad', 'ManholeCoverMissingOrDamaged', 'DamagedOrBlockedFootpath',
  'ConstructionMaterialLyingOntheRoad', 'RequestSprayingOrFoggingOperation',
  'OpenDefecation', 'DeadAnimals', 'StrayAnimals',
  'NoWaterOrElectricityinPublicToilet', 'PublicToiletIsDamaged',
  'DirtyOrSmellyPublicToilets', 'ParkRequiresMaintenance',
  'CuttingOrTrimmingOfTreeRequired', 'IllegalCuttingOfTrees',
  'IllegalParking', 'IllegalConstructions', 'IllegalShopsOnFootPath', 'Others',
];

// Phase boundaries (cumulative seconds from test start)
// warmup: 0-60, spike1: 60-90, valley1: 90-210, spike2: 210-240,
// valley2: 240-360, spike3: 360-390, sustained: 390-570, cooldown: 570-600
const PHASES = [
  { name: 'warmup',   end: 60 },
  { name: 'spike1',   end: 90 },
  { name: 'valley1',  end: 210 },
  { name: 'spike2',   end: 240 },
  { name: 'valley2',  end: 360 },
  { name: 'spike3',   end: 390 },
  { name: 'sustained', end: 570 },
  { name: 'cooldown', end: 600 },
];

function getCurrentPhase() {
  const elapsed = exec.scenario.progress * exec.scenario.maxDuration / 1000;
  for (const phase of PHASES) {
    if (elapsed <= phase.end) return phase.name;
  }
  return 'cooldown';
}

export const options = {
  scenarios: {
    variable_throughput: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 300,
      maxVUs: 400,
      stages: [
        // Warmup: ~1 lifecycle/sec
        { target: 1,  duration: '1m' },

        // Spike 1: sudden burst to ~15 lifecycles/sec (~60 API calls/sec)
        { target: 15, duration: '30s' },
        // Valley 1: sharp drop, services go idle
        { target: 1,  duration: '2m' },

        // Spike 2: bigger burst after idle (~25 lifecycles/sec)
        { target: 25, duration: '30s' },
        // Valley 2: another lull
        { target: 2,  duration: '2m' },

        // Spike 3: peak burst (~35 lifecycles/sec, near system max)
        { target: 35, duration: '30s' },
        // Sustained moderate load (~10 lifecycles/sec)
        { target: 10, duration: '3m' },

        // Cooldown
        { target: 0,  duration: '30s' },
      ],
    },
  },
  thresholds: {
    'transaction_success': ['rate>0.90'],
    'http_req_failed': ['rate<0.05'],
    'http_req_duration': ['p(95)<10000'],
  },
};

function thinkTime() {
  sleep(Math.random() * 2 + 1);
}

function ensureAuth(env) {
  if (!employeeToken) {
    const auth = login(env.baseUrl, env.username, env.password, env.tenant, 'EMPLOYEE');
    if (!auth) return false;
    employeeToken = auth.token;
    employeeUserInfo = auth.userInfo;
  }
  return true;
}

export default function () {
  const env = getEnv();
  const start = Date.now();
  let success = false;

  try {
    if (!ensureAuth(env)) return;
    thinkTime();

    const vuId = exec.vu.idInTest;
    const serviceCode = SERVICE_CODES[(vuId + iterationCount++) % SERVICE_CODES.length];
    const citizenIndex = (vuId % 100) + 1;
    const citizenPhone = `9900000${String(citizenIndex).padStart(3, '0')}`;
    const citizenName = `LoadTestCitizen_${citizenIndex}`;

    // CREATE
    let service = createComplaint(
      env.baseUrl, employeeToken, employeeUserInfo,
      env.tenant, serviceCode, citizenPhone, citizenName
    );
    if (!service) {
      employeeToken = null;
      employeeUserInfo = null;
      if (!ensureAuth(env)) return;
      service = createComplaint(
        env.baseUrl, employeeToken, employeeUserInfo,
        env.tenant, serviceCode, citizenPhone, citizenName
      );
      if (!service) return;
    }
    thinkTime();

    // ASSIGN
    const assigned = updateComplaint(
      env.baseUrl, employeeToken, employeeUserInfo,
      service, 'ASSIGN', [], 'Load test assignment'
    );
    if (!assigned) return;
    thinkTime();

    // RESOLVE
    const resolved = updateComplaint(
      env.baseUrl, employeeToken, employeeUserInfo,
      assigned, 'RESOLVE', [], 'Load test resolution'
    );
    if (!resolved) return;
    thinkTime();

    // SEARCH
    const found = searchComplaint(
      env.baseUrl, employeeToken, employeeUserInfo,
      env.tenant, service.serviceRequestId
    );
    if (!found) return;

    if (found.applicationStatus === 'RESOLVED') {
      success = true;
    }
  } finally {
    const duration = Date.now() - start;
    transactionDuration.add(duration);
    transactionSuccess.add(success ? 1 : 0);

    // Tag by phase for per-phase analysis in results
    const phase = getCurrentPhase();
    if (phase.startsWith('spike')) {
      spikeDuration.add(duration);
    } else if (phase.startsWith('valley')) {
      valleyDuration.add(duration);
    } else if (phase === 'sustained') {
      sustainedDuration.add(duration);
    }
  }
}
