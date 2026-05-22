import http from 'k6/http';

const BASIC_AUTH = 'Basic ZWdvdi11c2VyLWNsaWVudDo=';

/**
 * Authenticate via DIGIT OAuth and return { token, userInfo }.
 * @param {string} baseUrl - e.g. http://13.200.249.14:18000
 * @param {string} username
 * @param {string} password
 * @param {string} tenantId - e.g. pg.citya
 * @param {string} userType - EMPLOYEE or CITIZEN
 * @returns {{ token: string, userInfo: object }}
 */
export function login(baseUrl, username, password, tenantId, userType) {
  const res = http.post(
    `${baseUrl}/user/oauth/token`,
    {
      username: username,
      password: password,
      grant_type: 'password',
      scope: 'read',
      tenantId: tenantId,
      userType: userType,
    },
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': BASIC_AUTH,
      },
      tags: { name: 'Auth_Login' },
    }
  );

  if (res.status !== 200) {
    console.error(`Login failed: ${res.status} ${res.body}`);
    return null;
  }

  const body = res.json();
  return {
    token: body.access_token,
    userInfo: body.UserRequest,
  };
}

/**
 * Build RequestInfo object used in all DIGIT API calls.
 */
export function makeRequestInfo(token, userInfo) {
  return {
    apiId: 'Rainmaker',
    authToken: token,
    userInfo: userInfo,
    msgId: `${Date.now()}|en_IN`,
    plainAccessRequest: {},
  };
}
