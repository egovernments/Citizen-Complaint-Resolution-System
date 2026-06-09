// Quick smoke test: 1 VU, 1 iteration
import { pgrLifecycle, transactionDuration, transactionSuccess } from './pgr-lifecycle.js';

export const options = {
  vus: 1,
  iterations: 1,
};

export default function () {
  pgrLifecycle();
}
