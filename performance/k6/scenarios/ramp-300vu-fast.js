import { pgrLifecycle, transactionDuration, transactionSuccess } from './pgr-lifecycle.js';
import { THRESHOLDS } from '../config/thresholds.js';

export const options = {
  scenarios: {
    warmup: {
      executor: 'constant-vus',
      vus: 5,
      duration: '30s',
      exec: 'warmupFn',
    },
    main: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 300 },
        { duration: '3m', target: 300 },
        { duration: '15s', target: 0 },
      ],
      startTime: '30s',
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
