const config = require('../env-variables');
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
    const cleanMobileNumber = this.sanitizeMobileNumber(mobileNumber) || mobileNumber;

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
    const cleanMobileNumber = this.sanitizeMobileNumber(mobileNumber);
    if (!cleanMobileNumber) {
      throw new Error(`Invalid mobile number format: ${mobileNumber}. Expected 10 digits.`);
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

  // Helper method to sanitize mobile number
  sanitizeMobileNumber(mobileNumber) {
    if (!mobileNumber) return null;

    // Remove any non-digit characters
    const digitsOnly = mobileNumber.replace(/\D/g, '');

    // Handle different formats:
    // 918750975975 (12 digits with country code) -> 8750975975 (10 digits)
    // 8750975975 (10 digits) -> 8750975975 (keep as is)
    if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
      return digitsOnly.substring(2); // Remove '91' country code
    } else if (digitsOnly.length === 10) {
      return digitsOnly;
    } else {
      return null; // Invalid format
    }
  }
}

module.exports = new UserService();
