const config = require('../env-variables');
const fetch = require('node-fetch');
require('url-search-params-polyfill');

class UserService {

  async getUserForMobileNumber(mobileNumber, tenantId) {
    console.log("getUserForMobileNumber " + mobileNumber);
    try {
      let user = await this.loginOrCreateUser(mobileNumber, tenantId);
      if (!user || !user.userInfo) throw new Error('User info is incomplete');
      
      user.userId = user.userInfo.uuid;
      user.mobileNumber = mobileNumber;
      user.name = user.userInfo.name;
      user.locale = user.userInfo.locale;
      return user;
    } catch (error) {
      console.error('Error in getUserForMobileNumber:', error.message);
      throw error;
    }
  }

  async loginOrCreateUser(mobileNumber, tenantId) {
    console.log("Passed Mobile Number " + mobileNumber);
    try {
      let user = await this.loginUser(mobileNumber, tenantId);
      if (!user) {
        console.log(`Initial login failed for ${mobileNumber}, attempting to create user`);
        let createResult = await this.createUser(mobileNumber, tenantId);
        if (!createResult) {
          throw new Error(`Failed to create user for ${mobileNumber}`);
        }
        // Add a small delay before retry login to allow for database consistency
        await new Promise(resolve => setTimeout(resolve, 1000));
        user = await this.loginUser(mobileNumber, tenantId);
      }
      if (!user) {
        throw new Error(`Unable to login after user creation for ${mobileNumber}`);
      }

      user = await this.enrichuserDetails(user);
      return user;
    } catch (error) {
      console.error('Error in loginOrCreateUser:', error.message);
      throw error;
    }
  }

  async enrichuserDetails(user) {
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
      } else {
        console.warn(`User enrichment failed with status ${response.status}`);
      }
      return user;
    } catch (error) {
      console.error('Error in enrichuserDetails:', error.message);
      return user; // Return original user even if enrichment fails
    }
  }

  async loginUser(mobileNumber, tenantId) {
    console.log("Into Login User mobileNumber", mobileNumber, "tenant id", tenantId);
    
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
      console.log("User Response status", response.status);

      if (response.status === 200) {
        let body = await response.json();
        return {
          authToken: body.access_token,
          refreshToken: body.refresh_token,
          userInfo: body.UserRequest
        };
      } else {
        console.warn(`Login failed for ${mobileNumber} with status ${response.status}`);
        return undefined;
      }
    } catch (error) {
      console.error('Error in loginUser:', error.message);
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
        console.error(`Create User failed: ${JSON.stringify(responseBody)}`);
        throw new Error(`User creation failed: ${JSON.stringify(responseBody)}`);
      }
    } catch (error) {
      console.error('Error in createUser:', error.message);
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
