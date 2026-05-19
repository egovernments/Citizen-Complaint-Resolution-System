// Quick burst test - use with: k6 run --env TARGET=prod --env VUS=20 --env DUR=2m burst.js
import { pgrLifecycle } from './pgr-lifecycle.js';

const vus = parseInt(__ENV.VUS || '20');
const dur = __ENV.DUR || '2m';

export const options = {
  scenarios: {
    burst: {
      executor: 'constant-vus',
      vus: vus,
      duration: dur,
    },
  },
};

export default function () {
  pgrLifecycle();
}
