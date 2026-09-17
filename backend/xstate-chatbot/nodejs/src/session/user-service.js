const config = require('../env-variables');
const fetch = require('node-fetch');
require('url-search-params-polyfill');
const { ValidationError, AuthenticationError, ExternalServiceError } = require('./errors');
const { StatusCodes } = require('http-status-codes');



class UserService {

  async getUserForMobileNumber(mobileNumber, tenantId) {
    try {
      let user = await this.loginOrCreateUser(mobileNumber, tenantId);
      if (!user || !user.userInfo) throw new AuthenticationError('User info is incomplete');

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
    this.validateInputs(mobileNumber, tenantId);

    let user = await this.findCitizen(mobileNumber, tenantId);

    if (!user) {
      try {
        user = await this.createUser(mobileNumber, tenantId);
      } catch (error) {
        // A create that races another message for the same number comes back
        // as a duplicate; a second lookup resolves it.
        user = await this.findCitizen(mobileNumber, tenantId);
        if (user) return user;

        // If the citizen is not found in the active users, check if they exist as an inactive user.
        const inactive = await this.findInactiveCitizen(mobileNumber, tenantId);
        if (inactive)
          throw new AuthenticationError(`Citizen ${mobileNumber} exists but is deactivated (uuid ${inactive.uuid}) - creation is blocked by the taken username`);

        throw error;
      }

    }

    if (!user || !user.userInfo)
      throw new AuthenticationError(`Unable to resolve citizen ${mobileNumber} for tenant ${tenantId}`);

    return user;
  }


  validateInputs(mobileNumber, tenantId) {
    if (!mobileNumber || !tenantId) 
      throw new ValidationError('Mobile number and tenant ID are required');
  }

  async createNewUser(mobileNumber, tenantId) {
    try {
      const createResult = await this.createUser(mobileNumber, tenantId);
      if (!createResult) 
        throw new ExternalServiceError(`Failed to create user for ${mobileNumber}`);
      
      return createResult;
       
    } catch (createError) {
      return this.handleCreationError(createError, mobileNumber, tenantId);
    }
  }

  async authenticateCreatedUser(createResult, mobileNumber, tenantId) {
    if (createResult.authToken) {
      return createResult;
    }

    if (createResult.access_token && createResult.UserRequest) {
      return {
        authToken: createResult.access_token,
        refreshToken: createResult.refresh_token,
        userInfo: createResult.UserRequest
      };
    }

    return await this.loginAfterCreation(mobileNumber, tenantId);
  }
  
  // One service-account token serves every citizen. Cached until shortly
  async getServiceAccount() {
    if (this._serviceAccount && this._serviceAccountExpiry > Date.now()) {
      return this._serviceAccount;
    }

    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await this.loginServiceAccount();
      } catch (error) {
        lastError = error;
        console.error(`Service account login attempt ${attempt}/3 failed: ${error.message}`);
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 300));
      }
    }
    throw lastError;
  }

  // Finds a citizen by mobile number and tenant ID using the service account.
  // Returns the citizen's auth token and user info if found, otherwise undefined.
  async findCitizen(mobileNumber, tenantId) {
    const { authToken, userInfo } = await this.getServiceAccount();
    const cleanMobileNumber = this.sanitizeMobileNumber(mobileNumber) || mobileNumber;

    const url = config.egovServices.userServiceHost + config.egovServices.userServiceSearchPath;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: this.serviceRequestInfo(authToken, userInfo),
        tenantId: tenantId,
        mobileNumber: cleanMobileNumber,
        userType: 'CITIZEN'
      })
    });

    if (response.status !== StatusCodes.OK) return undefined;

    const body = await response.json();
    const found = (body.user || []).find((candidate) => candidate.active !== false);
    return found ? { authToken, userInfo: found } : undefined;
  }

  
  async findInactiveCitizen(mobileNumber, tenantId) {
    const { authToken, userInfo } = await this.getServiceAccount();
    const cleanMobileNumber = this.sanitizeMobileNumber(mobileNumber) || mobileNumber;

    const url = config.egovServices.userServiceHost + config.egovServices.userServiceSearchPath;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: this.serviceRequestInfo(authToken, userInfo),
        tenantId: tenantId,
        mobileNumber: cleanMobileNumber,
        userType: 'CITIZEN',
        active: false
      })
    });

    if (response.status !== StatusCodes.OK) return undefined;
    const body = await response.json();
    return (body.user || [])[0];
  }


  async loginServiceAccount() {
    const data = new URLSearchParams();
    data.append('grant_type', 'password');
    data.append('scope', 'read');
    data.append('userType', 'EMPLOYEE');
    data.append('username', config.serviceAccount.username);
    data.append('password', config.serviceAccount.password);
    data.append('tenantId', config.serviceAccount.tenantId);

    const url = config.egovServices.userServiceHost + config.egovServices.userServiceOAuthPath;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': config.userService.userLoginAuthorizationHeader
      },
      body: data
    });

    if (response.status !== StatusCodes.OK) {
      const body = await response.text();
      throw new AuthenticationError(`Service account login failed with status ${response.status}: ${body.slice(0, 200)}`);
    }

    const body = await response.json();
    this._serviceAccount = { authToken: body.access_token, userInfo: body.UserRequest };
    this._serviceAccountExpiry = Date.now() + Math.max((body.expires_in || 3600) - 60, 60) * 1000;
    return this._serviceAccount;
  }

  serviceRequestInfo(authToken, userInfo) {
    return { apiId: 'Rainmaker', ver: '.01', ts: null, action: '', did: '1', key: '', msgId: `${Date.now()}|${config.defaultLocale}`, authToken, userInfo };
  }


  async loginAfterCreation(mobileNumber, tenantId) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return await this.loginUser(mobileNumber, tenantId);
  }

  async handleCreationError(createError, mobileNumber, tenantId) {
    if (createError.message && createError.message.includes('Duplicate')) {
      console.log('User already exists, attempting login again...');
      return await this.loginUser(mobileNumber, tenantId);
    } else {
      throw createError;
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
      if (response.status === StatusCodes.OK) {
        let body = await response.json();
        user.userInfo.name = body.name;
        user.userInfo.locale = body.locale;
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

      if (response.status === StatusCodes.OK) {
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

    const cleanMobileNumber = this.sanitizeMobileNumber(mobileNumber);
    if (!cleanMobileNumber)
        throw new ValidationError(`Invalid mobile number format: ${mobileNumber}. Expected ${config.mobileNumberLength} digits, optionally prefixed with ${config.countryCode}.`);

    const { authToken, userInfo } = await this.getServiceAccount();

    const requestBody = {
      requestInfo: this.serviceRequestInfo(authToken, userInfo),
      user: {
        userName: cleanMobileNumber,
        mobileNumber: cleanMobileNumber,
        name: "Citizen",
        type: "CITIZEN",
        active: true,
        password: config.citizenPlaceholderPassword,
        locale: config.defaultLocale,
        permanentCity: tenantId,
        tenantId: tenantId,
        roles: [{ code: "CITIZEN", name: "Citizen", tenantId: tenantId }]
      }
    };

    const url = config.egovServices.userServiceHost + config.egovServices.userServiceCreateNoValidatePath;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    const responseBody = await response.json();

    if (response.status === StatusCodes.OK) {
      return { authToken, userInfo: (responseBody.user || [])[0] };
    }

    const errorCode = responseBody?.Errors?.[0]?.code
      || responseBody?.error?.fields?.[0]?.code
      || responseBody?.error?.message
      || JSON.stringify(responseBody).slice(0, 200);
    throw new ExternalServiceError(`User creation failed with status ${response.status}: ${errorCode}`);
  }


  // Helper method to sanitize mobile number.
  // Accepts the national number, or the same number prefixed with the country
  // code, and always returns the national form — that is what DIGIT stores as
  // the citizen's identity.
  // Example: 
  //   sanitizeMobileNumber('919876543210') => '9876543210'
  //   sanitizeMobileNumber('9876543210') => '9876543210'
  sanitizeMobileNumber(mobileNumber) {
    if (!mobileNumber) return null;

    const digitsOnly = String(mobileNumber).replace(/\D/g, '');
    const countryCode = String(config.countryCode).replace(/\D/g, '');
    const nationalLength = config.mobileNumberLength;

    if (digitsOnly.length === nationalLength) {
      return digitsOnly;
    }
    if (countryCode && digitsOnly.length === countryCode.length + nationalLength
        && digitsOnly.startsWith(countryCode)) {
      return digitsOnly.slice(countryCode.length);
    }
    return null;
  }
}

module.exports = new UserService();
