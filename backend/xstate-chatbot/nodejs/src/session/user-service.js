const config = require('../env-variables');
const mobileValidation = require('../machine/service/mobile-validation-service');
const fetch = require('node-fetch');
require('url-search-params-polyfill');
const { ValidationError, AuthenticationError, ExternalServiceError } = require('./errors');
const { maskMobile } = require('../privacy');
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
        console.error(`Failed to create user for ${maskMobile(mobileNumber)}: ${error.message}`);
        user = await this.findCitizen(mobileNumber, tenantId).catch(() => undefined);
        if (user) return user;

        // If the citizen is not found in the active users, check if they exist as an inactive user.
        const inactive = await this.findInactiveCitizen(mobileNumber, tenantId).catch(() => undefined);
        if (inactive)
          throw new AuthenticationError(`Citizen ${maskMobile(mobileNumber)} exists but is deactivated (uuid ${inactive.uuid}) - creation is blocked by the taken username`);

        throw error;
      }

    }

    if (!user || !user.userInfo)
      throw new AuthenticationError(`Unable to resolve citizen ${maskMobile(mobileNumber)} for tenant ${tenantId}`);

    return user;
  }


  validateInputs(mobileNumber, tenantId) {
    if (!mobileNumber || !tenantId) 
      throw new ValidationError('Mobile number and tenant ID are required');
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

  /**
   * Runs a privileged request with the service-account token, retrying ONCE with a
   * freshly minted token if the first attempt comes back 401.
   *
   * The token is cached on expires_in alone, so an egov-user restart, a token-store
   * flush or a password rotation invalidates it early. Without this retry the
   * process never recovered: findCitizen read 401 as "citizen not found" — so every
   * caller looked like a brand-new citizen — and createUser threw, until restart.
   */
  async withServiceAccount(perform) {
    const account = await this.getServiceAccount();
    const response = await perform(account);
    if (response.status !== StatusCodes.UNAUTHORIZED) return { response, account };

    console.warn('Service account token rejected (401); re-authenticating and retrying once');
    this._serviceAccount = undefined;
    this._serviceAccountExpiry = 0;

    const freshAccount = await this.getServiceAccount();
    return { response: await perform(freshAccount), account: freshAccount };
  }



  // Finds a citizen by mobile number and tenant ID using the service account.
  // Returns the citizen's auth token and user info if found, otherwise undefined.
    async findCitizen(mobileNumber, tenantId) {
    const cleanMobileNumber = (await this.sanitizeMobileNumber(mobileNumber, tenantId)) || mobileNumber;
    const url = config.egovServices.userServiceHost + config.egovServices.userServiceSearchPath;

    const { response, account } = await this.withServiceAccount(({ authToken, userInfo }) =>
      fetch(url, {
        method: 'POST',
        timeout: config.timeouts.request,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          RequestInfo: this.serviceRequestInfo(authToken, userInfo),
          tenantId: tenantId,
          mobileNumber: cleanMobileNumber,
          userType: 'CITIZEN'
        })
      })
    );

    if (response.status !== StatusCodes.OK) {
      throw new ExternalServiceError(`user/_search failed with status ${response.status}`);
    }

    const body = await response.json();
    const found = (body.user || []).find((candidate) => candidate.active !== false);
    return found ? { authToken: account.authToken, userInfo: found } : undefined;
  }


  
  async findInactiveCitizen(mobileNumber, tenantId) {
    const cleanMobileNumber = (await this.sanitizeMobileNumber(mobileNumber, tenantId)) || mobileNumber;
    const url = config.egovServices.userServiceHost + config.egovServices.userServiceSearchPath;

    const { response } = await this.withServiceAccount(({ authToken, userInfo }) =>
      fetch(url, {
        method: 'POST',
        timeout: config.timeouts.request,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          RequestInfo: this.serviceRequestInfo(authToken, userInfo),
          tenantId: tenantId,
          mobileNumber: cleanMobileNumber,
          userType: 'CITIZEN',
          active: false
        })
      })
    );

    if (response.status !== StatusCodes.OK) 
      throw new ExternalServiceError(`user/_search failed with status ${response.status}`);
    
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
      timeout: config.timeouts.request,
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
    if (!body.access_token) {
      throw new AuthenticationError(
        'Service account login returned 200 without an access_token; refusing to cache it'
      );
    }
    this._serviceAccount = { authToken: body.access_token, userInfo: body.UserRequest };
    this._serviceAccountExpiry = Date.now() + Math.max((body.expires_in || 3600) - 60, 60) * 1000;
    return this._serviceAccount;
  }

  serviceRequestInfo(authToken, userInfo) {
    return { apiId: 'Rainmaker', ver: '.01', ts: null, action: '', did: '1', key: '', msgId: `${Date.now()}|${config.defaultLocale}`, authToken, userInfo };
  }


  
  
  async createUser(mobileNumber, tenantId) {

    const cleanMobileNumber = await this.sanitizeMobileNumber(mobileNumber, tenantId);
    if (!cleanMobileNumber)
        throw new ValidationError(`Invalid mobile number format: ${maskMobile(mobileNumber)}. Expected ${config.mobileNumberLength} digits, optionally prefixed with ${config.countryCode}.`);

    const url = config.egovServices.userServiceHost + config.egovServices.userServiceCreateNoValidatePath;

    const { response, account } = await this.withServiceAccount(({ authToken, userInfo }) =>
      fetch(url, {
        method: 'POST',
        timeout: config.timeouts.request,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // egov-user's create DTO is @JsonProperty("requestInfo"), lowercase — unlike _search.
          requestInfo: this.serviceRequestInfo(authToken, userInfo),
          user: {
            userName: cleanMobileNumber,
            mobileNumber: cleanMobileNumber,
            name: config.citizenPlaceholderName,
            type: "CITIZEN",
            active: true,
            permanentCity: tenantId,
            tenantId: tenantId,
            roles: [{ code: "CITIZEN", name: "Citizen", tenantId: tenantId }]
          }
        })
      })
    );

    const responseBody = await response.json();

    if (response.status === StatusCodes.OK) {
      return { authToken: account.authToken, userInfo: (responseBody.user || [])[0] };
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
  // Per-tenant rule from MDMS (common-masters.MobileNumberValidation), falling
  // back to DEFAULT_COUNTRY_CODE / DEFAULT_MOBILE_REGEX when the tenant has none.
  async sanitizeMobileNumber(mobileNumber, tenantId) {
    if (!mobileNumber) return null;
    const mobileConfig = await mobileValidation.getConfig(tenantId || config.rootTenantId);
    return mobileValidation.toNational(mobileNumber, mobileConfig);
  }
}

module.exports = new UserService();
