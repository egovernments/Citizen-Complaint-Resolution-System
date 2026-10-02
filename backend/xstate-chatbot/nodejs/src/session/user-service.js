const config = require('../env-variables');
const mobileValidation = require('../machine/service/mobile-validation-service');
const fetch = require('node-fetch');
require('url-search-params-polyfill');

class UserService {

  async getUserForMobileNumber(mobileNumber, tenantId) {
    try {
      let user = await this.loginOrCreateUser(mobileNumber, tenantId);
      if (!user || !user.userInfo) throw new Error('User info is incomplete');

      user.userId = user.userInfo.uuid;
      user.mobileNumber = mobileNumber;
      user.name = user.userInfo.name;
      user.locale = user.userInfo.locale;
      return user;
    } catch (error) {
      throw error;
    }
  }

  async loginOrCreateUser(mobileNumber, tenantId) {
    try {
      // Validate inputs
      if (!mobileNumber || !tenantId) {
        throw new Error('Mobile number and tenant ID are required');
      }

      let user = await this.loginUser(mobileNumber, tenantId);
      if (!user) {
        // User doesn't exist, try to create
        try {
          let createResult = await this.createUser(mobileNumber, tenantId);
          if (!createResult) {
            throw new Error(`Failed to create user for ${mobileNumber}`);
          }
          
          // The create response already includes the auth token and user info!
          // No need to login again - just use the create response directly
          if (createResult.access_token && createResult.UserRequest) {
            user = {
              authToken: createResult.access_token,
              refreshToken: createResult.refresh_token,
              userInfo: createResult.UserRequest
            };
          } else {
            // Fallback: try to login after creation if no token in create response
            await new Promise(resolve => setTimeout(resolve, 1000));
            user = await this.loginUser(mobileNumber, tenantId);
          }
        } catch (createError) {
          // If creation fails with duplicate user, try login once more
          // This handles race conditions where user was created between login attempts
          if (createError.message && createError.message.includes('Duplicate')) {
            console.log('User already exists, attempting login again...');
            user = await this.loginUser(mobileNumber, tenantId);
          } else {
            throw createError;
          }
        }
      }
      
      if (!user) {
        throw new Error(`Unable to authenticate user ${mobileNumber} for tenant ${tenantId}`);
      }

      user = await this.enrichuserDetails(user);
      return user;
    } catch (error) {
      throw error;
    }
  }

  async enrichuserDetails(user) {
    // Skip enrichment if no auth token
    if (!user || !user.authToken) {
      return user;
    }

    let url = `${config.egovServices.userServiceHost}${config.egovServices.userServiceCitizenDetailsPath}?access_token=${user.authToken}`;

    let options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    try {
      let response = await fetch(url, options);
      if (response.status === 200) {
        let body = await response.json();
        user.userInfo.name = body.name;
        user.userInfo.locale = body.locale;
      } else if (response.status === 401) {
      } else {
      }
      return user;
    } catch (error) {
      return user; // Return original user even if enrichment fails
    }
  }

  async loginUser(mobileNumber, tenantId) {

    // Sanitize mobile number for login too
    const cleanMobileNumber = (await this.sanitizeMobileNumber(mobileNumber, tenantId)) || mobileNumber;

    let data = new URLSearchParams();
    data.append('grant_type', 'password');
    data.append('scope', 'read');
    data.append('password', config.userService.userServiceHardCodedPassword);
    data.append('userType', 'CITIZEN');
    data.append('tenantId', tenantId);
    data.append('username', cleanMobileNumber);

    let headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': config.userService.userLoginAuthorizationHeader
    };

    let url = config.egovServices.userServiceHost + config.egovServices.userServiceOAuthPath;
    
    let options = {
      method: 'POST',
      headers: headers,
      body: data
    };

    try {
      let response = await fetch(url, options);

      if (response.status === 200) {
        let body = await response.json();
        return {
          authToken: body.access_token,
          refreshToken: body.refresh_token,
          userInfo: body.UserRequest
        };
      } else {
        return undefined;
      }
    } catch (error) {
      return undefined;
    }
  }

  async createUser(mobileNumber, tenantId) {
    // Validate mobile number format (should be 10 digits)
    const cleanMobileNumber = await this.sanitizeMobileNumber(mobileNumber, tenantId);
    if (!cleanMobileNumber) {
      const mobileConfig = await mobileValidation.getConfig(tenantId || config.rootTenantId);
      throw new Error(
        `Invalid mobile number format: ${mobileNumber}. Tenant ${tenantId} expects ` +
        `${mobileConfig.mobileNumberRegex} (country code ${mobileConfig.countryCode}).`
      );
    }

    let requestBody = {
      RequestInfo: {
        apiId: "Rainmaker",
        ver: ".01",
        ts: "",
        action: "_create",
        did: "1",
        key: "",
        msgId: "20170310130900|en_IN",
        authToken: null
      },
      User: {
        otpReference: config.userService.userServiceHardCodedPassword,
        permanentCity: tenantId,
        tenantId: tenantId,
        username: cleanMobileNumber,
        mobileNumber: cleanMobileNumber,
        name: "Citizen",
        type: "CITIZEN"
      }
    };

    let url = config.egovServices.userServiceHost + config.egovServices.userServiceCreateCitizenPath;
    
    let options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    };

    try {
      let response = await fetch(url, options);
      let responseBody = await response.json();

      if (response.status === 200) {
        return responseBody;
      } else {
        throw new Error(`User creation failed with status ${response.status}`);
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Reduce any inbound number form to the national number egov-user expects.
   *
   * Previously this accepted only 10 digits, or 12 beginning `91` -- an India-only rule
   * that rejected every other country outright (a Kenyan +254712345678 returned null and
   * the citizen saw "Invalid mobile number format"). It also rejected tenants whose rule
   * is narrower than "any 10 digits", such as pg.citya's 9-digit numbers starting 7 or 9.
   *
   * The rule now comes from the tenant's common-masters.MobileNumberValidation row. With
   * no row present the fallback is +91 / 10 digits, so India behaves exactly as before.
   */
  async sanitizeMobileNumber(mobileNumber, tenantId) {
    if (!mobileNumber) return null;
    const mobileConfig = await mobileValidation.getConfig(tenantId || config.rootTenantId);
    return mobileValidation.toNational(mobileNumber, mobileConfig);
  }
}

module.exports = new UserService();
