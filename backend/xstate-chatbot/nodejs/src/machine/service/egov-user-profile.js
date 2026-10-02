const { StatusCodes } = require('http-status-codes');
const config = require('../../env-variables');
const fetch = require('node-fetch');
const { ExternalServiceError } = require('../../session/errors');
const userService = require('../../session/user-service');

class UserProfileService {

  async updateUser(user, userSlots, tenantId) {
    // Built as a copy: the session is persisted even when this request fails, so
    // mutating it first marked the citizen onboarded while egov-user still held
    // the placeholder name and old locale.
    const updated = {
      ...user.userInfo,
      locale: userSlots.locale,
      name: userSlots.name || user.userInfo.name,
    };

    const { authToken, userInfo } = await userService.getServiceAccount();
    const url = config.egovServices.userServiceHost + config.egovServices.userServiceUpdateNoValidatePath;

    const requestBody = {
      RequestInfo: userService.serviceRequestInfo(authToken, userInfo),
      user: updated
    };

    const response = await fetch(url, {
      method: 'POST',
      timeout: config.timeouts.request,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (response.status === StatusCodes.OK) {
      const body = await response.json();
      user.userInfo.locale = updated.locale;
      user.userInfo.name = updated.name;
      return body;
    }

    console.error('Error Updating the user profile');
    console.error((await response.text()).slice(0, 300));
    throw new ExternalServiceError('Error updating the user profile');
  }
}

module.exports = new UserProfileService();
