// Parameterised ramp used for capacity/ceiling testing.
//
// Usage: k6 run --env TARGET=<env> --env VUS=100 ramp-nvu.js
//
// Mirrors ramp-50vu.js's shape (2m warmup -> 3m ramp -> 5m hold -> 2m down) so
// results are directly comparable with the fixed ramp-2vu/10vu/50vu runs.
//
// Unlike burst.js this splits warmupFn/mainFn and applies THRESHOLDS, so the
// `{scenario:main}` thresholds actually evaluate and the run can fail. A
// ceiling test that cannot fail is worthless.
import { pgrLifecycle, transactionDuration, transactionSuccess } from './pgr-lifecycle.js';
import { THRESHOLDS } from '../config/thresholds.js';

const VUS = parseInt(__ENV.VUS || '50', 10);
// Warm a tenth of peak, minimum 1, so connection pools and JIT are primed
// before the measured ramp begins.
const WARMUP_VUS = Math.max(1, Math.floor(VUS / 10));

export const options = {
  scenarios: {
    warmup: {
      executor: 'constant-vus',
      vus: WARMUP_VUS,
      duration: '2m',
      exec: 'warmupFn',
    },
    main: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '3m', target: VUS },
        { duration: '5m', target: VUS },
        { duration: '2m', target: 0 },
      ],
      startTime: '2m',
      exec: 'mainFn',
    },
  },
  thresholds: THRESHOLDS,
};

export function warmupFn() {
  pgrLifecycle();
}

export function mainFn() {
  pgrLifecycle();
}
