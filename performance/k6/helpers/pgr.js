import http from 'k6/http';
import { sleep } from 'k6';
import { makeRequestInfo } from './auth.js';

const HEADERS = { 'Content-Type': 'application/json' };
const HTTP_TIMEOUT = '120s';

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
export function createComplaint(baseUrl, token, userInfo, tenantId, serviceCode, citizenPhone, citizenName) {
  const requestInfo = makeRequestInfo(token, userInfo);
  const payload = {
    service: {
      tenantId: tenantId,
      serviceCode: serviceCode,
      description: `Load test complaint - ${serviceCode} - VU ${citizenName}`,
      additionalDetail: {},
      source: 'web',
      address: {
        landmark: 'Load Test Landmark',
        city: 'City A',
        district: 'City A',
        region: 'City A',
        pincode: '',
        locality: {
          code: 'JLC477',
          name: 'Gali No,. 2 To Gali No. 6',
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
    { headers: HEADERS, tags: { name: 'PGR_Create' }, timeout: HTTP_TIMEOUT }
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
export function updateComplaint(baseUrl, token, userInfo, service, action, assignees, comment, rating) {
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
      { headers: HEADERS, tags: { name: tagName }, timeout: HTTP_TIMEOUT }
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
export function searchComplaint(baseUrl, token, userInfo, tenantId, serviceRequestId) {
  const requestInfo = makeRequestInfo(token, userInfo);
  const payload = { RequestInfo: requestInfo };

  const maxRetries = 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = http.post(
      `${baseUrl}/pgr-services/v2/request/_search?tenantId=${tenantId}&serviceRequestId=${serviceRequestId}`,
      JSON.stringify(payload),
      { headers: HEADERS, tags: { name: 'PGR_Search' }, timeout: HTTP_TIMEOUT }
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
