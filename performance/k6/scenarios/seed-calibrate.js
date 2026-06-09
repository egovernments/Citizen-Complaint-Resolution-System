// Quick calibration: 1000 iterations at 200 VUs, no think time
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

    let service = createComplaint(
      env.baseUrl, employeeToken, employeeUserInfo,
      env.tenant, serviceCode, citizenPhone, citizenName
    );
    if (!service) {
      employeeToken = null; employeeUserInfo = null;
      if (!ensureAuth(env)) return;
      service = createComplaint(
        env.baseUrl, employeeToken, employeeUserInfo,
        env.tenant, serviceCode, citizenPhone, citizenName
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
