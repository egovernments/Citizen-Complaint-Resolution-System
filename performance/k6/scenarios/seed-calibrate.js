// Quick calibration: 1000 iterations at 200 VUs, no think time
import { Trend, Rate, Counter } from 'k6/metrics';
import exec from 'k6/execution';
import { login } from '../helpers/auth.js';
import { createComplaint, updateComplaint } from '../helpers/pgr.js';
import { getEnv } from '../config/environments.js';

export const transactionDuration = new Trend('transaction_duration', true);
export const transactionSuccess = new Rate('transaction_success');
export const complaintsCreated = new Counter('complaints_created');

const ALL_SERVICE_CODES = [
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

const SERVICE_CODES = (() => {
  const env = getEnv();
  const svc = env.serviceCodes;
  return (Array.isArray(svc) && svc.length > 0) ? svc : ALL_SERVICE_CODES;
})();

// Boundary codes to rotate across. Falls back to the stock seed locality only
// if the env config doesn't supply real ones.
const LOCALITIES = (() => {
  const env = getEnv();
  const loc = env.localities;
  return (Array.isArray(loc) && loc.length > 0) ? loc : ['JLC477'];
})();

let employeeToken = null;
let employeeUserInfo = null;
let iterationCount = 0;

export const options = {
  scenarios: {
    seed: {
      executor: 'shared-iterations',
      vus: 50,
      iterations: 1000,
      maxDuration: '10m',
    },
  },
};

function ensureAuth(env) {
  if (!employeeToken) {
    const auth = login(env.baseUrl, env.username, env.password, env.authTenant || env.tenant, 'EMPLOYEE');
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

    // Rotate boundary per iteration so writes spread across wards
    const locality = LOCALITIES[(vuId + iterationCount) % LOCALITIES.length];
    const city = env.city || 'City A';
    const citizenIndex = (vuId % 500) + 1;
    const citizenPhone = env.citizenPhone || `9900000${String(citizenIndex).padStart(3, '0')}`;
    const citizenName = env.citizenName || `LoadTestCitizen_${citizenIndex}`;

    let service = createComplaint(
      env.baseUrl, employeeToken, employeeUserInfo,
      env.tenant, serviceCode, citizenPhone, citizenName, locality, city
    );
    if (!service) {
      employeeToken = null; employeeUserInfo = null;
      if (!ensureAuth(env)) return;
      service = createComplaint(
        env.baseUrl, employeeToken, employeeUserInfo,
        env.tenant, serviceCode, citizenPhone, citizenName, locality, city
      );
      if (!service) return;
    }

    const assigned = updateComplaint(
      env.baseUrl, employeeToken, employeeUserInfo,
      service, 'ASSIGN', [], 'Seed assignment'
    );
    if (!assigned) return;

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
