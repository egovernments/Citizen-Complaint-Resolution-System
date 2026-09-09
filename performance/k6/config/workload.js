const PROFILE_STEPS = {
  'pgr-lifecycle': ['create', 'assign', 'resolve', 'search'],
  'pgr-write': ['create', 'assign', 'resolve'],
  'pgr-create': ['create'],
  'pgr-create-read': ['create', 'search'],
};

const STEP_ORDER = ['create', 'assign', 'resolve', 'search'];

function parseSteps(raw) {
  return raw.split(',').map((step) => step.trim().toLowerCase()).filter(Boolean);
}

function validateSteps(steps) {
  if (steps.length === 0) {
    throw new Error('PGR_STEPS must contain at least one step');
  }

  const unknown = steps.filter((step) => !STEP_ORDER.includes(step));
  if (unknown.length > 0) {
    throw new Error(`Unknown PGR_STEPS: ${unknown.join(', ')}. Valid steps: ${STEP_ORDER.join(', ')}`);
  }

  if (new Set(steps).size !== steps.length) {
    throw new Error(`PGR_STEPS contains a duplicate: ${steps.join(',')}`);
  }

  const ordered = [...steps].sort((left, right) => STEP_ORDER.indexOf(left) - STEP_ORDER.indexOf(right));
  if (ordered.join(',') !== steps.join(',')) {
    throw new Error(`PGR_STEPS must follow lifecycle order: ${STEP_ORDER.join(',')}`);
  }

  if (!steps.includes('create')) {
    throw new Error('This harness currently requires create; existing-record inputs are not implemented');
  }
  if (steps.includes('assign') && !steps.includes('create')) {
    throw new Error('assign requires create');
  }
  if (steps.includes('resolve') && !steps.includes('assign')) {
    throw new Error('resolve requires assign');
  }
  if (steps.includes('search') && !steps.includes('create')) {
    throw new Error('search requires create');
  }
}

export function getWorkloadConfig() {
  const profile = (__ENV.WORKLOAD_PROFILE || 'pgr-lifecycle').trim().toLowerCase();
  const profileSteps = PROFILE_STEPS[profile];
  if (!profileSteps) {
    throw new Error(`Unknown WORKLOAD_PROFILE: ${profile}. Valid profiles: ${Object.keys(PROFILE_STEPS).join(', ')}`);
  }

  const steps = __ENV.PGR_STEPS ? parseSteps(__ENV.PGR_STEPS) : [...profileSteps];
  validateSteps(steps);

  return Object.freeze({
    profile,
    steps: Object.freeze(steps),
    runId: (__ENV.RUN_ID || 'unlabelled').trim(),
    principal: (__ENV.PRINCIPAL || 'employee').trim().toLowerCase(),
    datasetTier: (__ENV.DATASET_TIER || 'unspecified').trim().toLowerCase(),
  });
}

export function requestContext(config, step) {
  return {
    runId: config.runId,
    profile: config.profile,
    principal: config.principal,
    datasetTier: config.datasetTier,
    step,
  };
}
