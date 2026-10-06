import http from 'k6/http';
import { sleep } from 'k6';
import { makeRequestInfo } from './auth.js';

const HEADERS = { 'Content-Type': 'application/json' };
const HTTP_TIMEOUT = '120s';

function requestTags(name, context = {}) {
  const inferredStep = name.replace(/^PGR_/, '').toLowerCase();
  return {
    name,
    service: 'pgr-services',
    run_id: context.runId || __ENV.RUN_ID || 'unlabelled',
    workload_profile: context.profile || __ENV.WORKLOAD_PROFILE || 'legacy-scenario',
    workload_step: context.step || inferredStep,
    principal: context.principal || __ENV.PRINCIPAL || 'employee',
    dataset_tier: context.datasetTier || __ENV.DATASET_TIER || 'unspecified',
  };
}

/**
 * Check if response is a 401 auth error.
 */
export function isAuthError(res) {
  return res.status === 401;
}

/**
 * Create a PGR complaint.
 * @returns {object} The created service object or null
 */
// `locality` and `city` default to the full-dump.sql seed values so that callers
// which predate these parameters keep their original behaviour.
export function createComplaint(baseUrl, token, userInfo, tenantId, serviceCode, citizenPhone, citizenName, locality = 'JLC477', city = 'City A', context = {}) {
  const requestInfo = makeRequestInfo(token, userInfo);
  const runId = context.runId || __ENV.RUN_ID;
  const workloadProfile = context.profile || __ENV.WORKLOAD_PROFILE || 'legacy-scenario';
  const payload = {
    service: {
      tenantId: tenantId,
      serviceCode: serviceCode,
      description: `Load test complaint - ${serviceCode} - VU ${citizenName}`,
      additionalDetail: runId ? {
        performanceFixture: 'k6-api-v1',
        performanceRunId: runId,
        performanceProfile: workloadProfile,
      } : {},
      source: 'web',
      address: {
        landmark: 'Load Test Landmark',
        city: city,
        district: city,
        region: city,
        pincode: '',
        locality: {
          code: locality,
          name: locality,
        },
        geoLocation: {},
      },
      citizen: {
        name: citizenName,
        type: 'CITIZEN',
        mobileNumber: citizenPhone,
        roles: [
          {
            id: null,
            name: 'Citizen',
            code: 'CITIZEN',
            tenantId: tenantId,
          },
        ],
        tenantId: tenantId,
      },
    },
    workflow: { action: 'APPLY' },
    RequestInfo: requestInfo,
  };

  const res = http.post(
    `${baseUrl}/pgr-services/v2/request/_create?tenantId=${tenantId}`,
    JSON.stringify(payload),
    { headers: HEADERS, tags: requestTags('PGR_Create', context), timeout: HTTP_TIMEOUT }
  );

  if (res.status !== 200) {
    console.error(`PGR Create failed: ${res.status} ${res.body}`);
    return null;
  }

  const body = res.json();
  return body.ServiceWrappers[0].service;
}

/**
 * Update a PGR complaint (Assign, Resolve, or Rate).
 * Retries up to 5 times with backoff on INVALID_UPDATE (async pipeline lag).
 */
export function updateComplaint(baseUrl, token, userInfo, service, action, assignees, comment, rating, context = {}) {
  const requestInfo = makeRequestInfo(token, userInfo);
  const workflow = {
    action: action,
    assignes: assignees,
    comments: comment,
  };
  if (rating !== undefined) {
    workflow.rating = rating;
  }
  const payload = {
    workflow: workflow,
    service: service,
    RequestInfo: requestInfo,
  };

  const tagName = `PGR_${action.charAt(0) + action.slice(1).toLowerCase()}`;
  const jsonPayload = JSON.stringify(payload);

  // Retry loop for async pipeline lag (INVALID_UPDATE means persister hasn't written yet)
  const maxRetries = 5;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = http.post(
      `${baseUrl}/pgr-services/v2/request/_update`,
      jsonPayload,
      { headers: HEADERS, tags: requestTags(tagName, context), timeout: HTTP_TIMEOUT }
    );

    if (res.status === 200) {
      const body = res.json();
      return body.ServiceWrappers[0].service;
    }

    // Check if it's an INVALID_UPDATE (async lag) — retry with backoff
    const isInvalidUpdate = res.status === 400 &&
      res.body && res.body.includes('INVALID_UPDATE');

    if (isInvalidUpdate && attempt < maxRetries) {
      const backoff = Math.pow(2, attempt) + Math.random();
      sleep(backoff);
      continue;
    }

    console.error(`PGR ${action} failed: ${res.status} ${res.body}`);
    return null;
  }
  return null;
}

/**
 * Search for a PGR complaint by serviceRequestId.
 * Retries up to 3 times if the record isn't found yet.
 */
export function searchComplaint(baseUrl, token, userInfo, tenantId, serviceRequestId, context = {}) {
  const requestInfo = makeRequestInfo(token, userInfo);
  const payload = { RequestInfo: requestInfo };

  const maxRetries = 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = http.post(
      `${baseUrl}/pgr-services/v2/request/_search?tenantId=${tenantId}&serviceRequestId=${serviceRequestId}`,
      JSON.stringify(payload),
      { headers: HEADERS, tags: requestTags('PGR_Search', context), timeout: HTTP_TIMEOUT }
    );

    if (res.status === 200) {
      const body = res.json();
      if (body.ServiceWrappers && body.ServiceWrappers.length > 0) {
        return body.ServiceWrappers[0].service;
      }
      // Record not found yet — retry
      if (attempt < maxRetries) {
        sleep(Math.pow(2, attempt) + Math.random());
        continue;
      }
      console.error('PGR Search: record not found after retries');
      return null;
    }

    console.error(`PGR Search failed: ${res.status} ${res.body}`);
    return null;
  }
  return null;
}
