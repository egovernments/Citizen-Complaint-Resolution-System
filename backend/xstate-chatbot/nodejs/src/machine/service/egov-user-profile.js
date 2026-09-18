const { StatusCodes } = require('http-status-codes');
const config = require('../../env-variables');
const fetch = require('node-fetch');
const { ExternalServiceError } = require('../../session/errors');
const userService = require('../../session/user-service');

class UserProfileService {

  async updateUser(user, userSlots, tenantId) {
    user.userInfo.locale = userSlots.locale;
    user.userInfo.name = userSlots.name || user.userInfo.name;

    const { authToken, userInfo } = await userService.getServiceAccount();
    const url = config.egovServices.userServiceHost + config.egovServices.userServiceUpdateNoValidatePath;

    const requestBody = {
      RequestInfo: userService.serviceRequestInfo(authToken, userInfo),
      user: user.userInfo
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (response.status === StatusCodes.OK) {
      return await response.json();
    }

    console.error('Error Updating the user profile');
    console.error((await response.text()).slice(0, 300));
    throw new ExternalServiceError('Error updating the user profile');
  }
}

module.exports = new UserProfileService();
