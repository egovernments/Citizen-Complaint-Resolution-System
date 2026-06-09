// Pass/fail thresholds for all scenarios
// Scoped to 'main' scenario to exclude warmup data
//
// Note: transaction_duration includes ~8s of think time (4 random sleeps of 1-3s).
// The http_req_duration threshold measures actual server latency.

export const THRESHOLDS = {
  'transaction_duration{scenario:main}': ['p(95)<15000', 'p(99)<25000'],
  'transaction_success{scenario:main}': ['rate>0.95'],
  'http_req_failed{scenario:main}': ['rate<0.01'],
  'http_req_duration{scenario:main}': ['p(95)<5000', 'p(99)<10000'],
};
