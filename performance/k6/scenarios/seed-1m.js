// Seed 1M PGR records: CREATE → ASSIGN → RESOLVE (no think time, no search)
// Usage: k6 run --no-usage-report --env TARGET=prod k6/scenarios/seed-1m.js
//
// Each iteration creates one complete PGR complaint (CREATE→ASSIGN→RESOLVE).
// No think time, no search step — pure throughput for DB seeding.
// All 33 complaint types rotate across VUs and iterations.
import { sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import exec from 'k6/execution';
import { login } from '../helpers/auth.js';
import { createComplaint, updateComplaint } from '../helpers/pgr.js';
import { getEnv } from '../config/environments.js';

export const transactionDuration = new Trend('transaction_duration', true);
export const transactionSuccess = new Rate('transaction_success');
export const complaintsCreated = new Counter('complaints_created');

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

// Per-VU state
let employeeToken = null;
let employeeUserInfo = null;
let iterationCount = 0;

export const options = {
  scenarios: {
    seed: {
      executor: 'shared-iterations',
      vus: 50,
      iterations: 540000,
      maxDuration: '16h',
    },
  },
  thresholds: {
    'transaction_success': ['rate>0.90'],
    'http_req_failed': ['rate<0.05'],
  },
};

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

    const vuId = exec.vu.idInTest;
    const serviceCode = SERVICE_CODES[(vuId + iterationCount++) % SERVICE_CODES.length];
    const citizenIndex = (vuId % 500) + 1;
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

    // Wait for Kafka persister to write the record to DB
    sleep(1);

    // ASSIGN
    const assigned = updateComplaint(
      env.baseUrl, employeeToken, employeeUserInfo,
      service, 'ASSIGN', [], 'Seed assignment'
    );
    if (!assigned) return;

    // RESOLVE
    const resolved = updateComplaint(
      env.baseUrl, employeeToken, employeeUserInfo,
      assigned, 'RESOLVE', [], 'Seed resolution'
    );
    if (!resolved) return;

    success = true;
    complaintsCreated.add(1);
  } finally {
    const duration = Date.now() - start;
    transactionDuration.add(duration);
    transactionSuccess.add(success ? 1 : 0);
  }
}
