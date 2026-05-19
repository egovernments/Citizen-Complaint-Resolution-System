import { pgrLifecycle, transactionDuration, transactionSuccess } from './pgr-lifecycle.js';
import { THRESHOLDS } from '../config/thresholds.js';

export const options = {
  scenarios: {
    warmup: {
      executor: 'constant-vus',
      vus: 5,
      duration: '2m',
      exec: 'warmupFn',
    },
    main: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '3m', target: 50 },
        { duration: '5m', target: 50 },
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
