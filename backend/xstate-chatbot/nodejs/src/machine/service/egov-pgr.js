const fetch = require("node-fetch");
const config = require("../../env-variables");
const mobileValidation = require("./mobile-validation-service");
const getCityAndLocality = require("./util/google-maps-util");
const localisationService = require("../util/localisation-service");
const urlencode = require("urlencode");
const dialog = require("../util/dialog");
const moment = require("moment-timezone");
const fs = require("fs");
const axios = require("axios");
var FormData = require("form-data");
const mediaTypes = require("../../media-types");
const TtlCache = require("../../ttl-cache");
var geturl = require("url");
var path = require("path");
const userService = require('../../session/user-service');
const { ExternalServiceError } = require("../../session/errors");
require("url-search-params-polyfill");

let pgrCreateRequestBody =
  '{"RequestInfo":{"authToken":"","userInfo":{}},"service":{"tenantId":"","serviceCode":"","description":"","accountId":"","source":"whatsapp","address":{"landmark":"","city":"","geoLocation":{"latitude": null, "longitude": null},"locality":{"code":""}}},"workflow":{"action":"APPLY","verificationDocuments":[]}}';

const referenceCache = new TtlCache(config.referenceCacheTtlMs);

class PGRService {
  async fetchMdmsData(tenantId, moduleName, masterName, filterPath, user) {
    var url =
      config.egovServices.egovServicesHost + config.egovServices.mdmsSearchPath;
    var request = {
      RequestInfo: {
        authToken: user ? user.authToken : undefined
      },
      MdmsCriteria: {
        tenantId: tenantId,
        moduleDetails: [
          {
            moduleName: moduleName,
            masterDetails: [
              {
                name: masterName,
                filter: filterPath,
              },
            ],
          },
        ],
      },
    };

    var options = {
      method: "POST",
      body: JSON.stringify(request),
      headers: {
        "Content-Type": "application/json",
      },
    };

    let response = await fetch(url, { ...options, timeout: config.timeouts.request });

    if (!response.ok) {
      throw new Error(`MDMS fetch failed with status ${response.status}`);
    }

    let data = await response.json();

    // Check if MdmsRes exists
    if (!data["MdmsRes"]) {
      throw new Error(`Invalid MDMS response structure - MdmsRes not found`);
    }

    // Check if module exists
    if (!data["MdmsRes"][moduleName]) {
      throw new Error(`Module ${moduleName} not found in MDMS data`);
    }

    // Check if master exists
    if (!data["MdmsRes"][moduleName][masterName]) {
      throw new Error(`Master ${masterName} not found in module ${moduleName}`);
    }

    return data["MdmsRes"][moduleName][masterName];
  }

  async fetchMdmsV2Data(tenantId, moduleDetails, user) {
    const url = `${config.egovServices.egovServicesHost}mdms-v2/v1/_search?tenantId=${tenantId}`;

    const request = {
      MdmsCriteria: {
        tenantId: tenantId,
        moduleDetails: moduleDetails
      },
      RequestInfo: {
        apiId: "Rainmaker",
        authToken: user ? user.authToken : undefined,
        msgId: Date.now() + "|en_IN",
        plainAccessRequest: {}
      }
    };

    const options = {
      method: "POST",
      body: JSON.stringify(request),
      headers: {
        "Content-Type": "application/json"
      }
    };

    let response = await fetch(url, { ...options, timeout: config.timeouts.request });

    if (!response.ok) {
      throw new Error(`MDMS v2 fetch failed with status ${response.status}`);
    }

    let data = await response.json();
    return data.MdmsRes || data.mdms || {};
  }

  async fetchComplaintHierarchyLevels(tenantId) {
    const rows = await referenceCache.get(`definition:${tenantId}`, () =>
      this.fetchMdmsData(
        tenantId,
        "RAINMAKER-PGR",
        "ComplaintHierarchyDefinition",
        "$.[?(@.active == true)]"
      )
    );
    const definition = rows?.[0] ?? {};
    const levels = definition.levels ?? [];
    if (levels.some((level) => level.isFreeText)) {
      throw new Error("ComplaintHierarchyDefinition declares an isFreeText level, which the chatbot does not support");
    }
    return {
      hierarchyType: definition.hierarchyType,
      levels: [...levels].sort((a, b) => a.order - b.order)
    };
  }

  isOtherOption(row) {
    return /^(other|others|outro|outros)$/i.test(String(row.name ?? "").trim())
      || String(row.code ?? "").endsWith("Other");
  }

  async fetchComplaintHierarchyStep(tenantId, hierarchyPath = []) {
    const [{ hierarchyType, levels }, hierarchyRows] = await Promise.all([
      this.fetchComplaintHierarchyLevels(tenantId),
      referenceCache.get(`hierarchy:${tenantId}`, () =>
        this.fetchMdmsData(tenantId, "RAINMAKER-PGR", "ComplaintHierarchy", "$.[?(@.active == true)]")
      )
    ]);


    const parentCode = hierarchyPath[hierarchyPath.length - 1];
    const children = hierarchyRows
      .filter((row) => !hierarchyType || row.hierarchyType === hierarchyType)
      .filter((row) => (parentCode ? row.parentCode === parentCode : row.parentCode == null))
      .sort(
        (a, b) =>
          (this.isOtherOption(a) ? 1 : 0) - (this.isOtherOption(b) ? 1 : 0) ||
          (a.order ?? 0) - (b.order ?? 0) ||
          String(a.code).localeCompare(String(b.code))
      );

    const level =
      levels.find((candidate) => candidate.levelCode === children[0]?.levelCode) ??
      levels[hierarchyPath.length];
    
    const hasChildren = (code) =>
      hierarchyRows.some(
        (row) => (!hierarchyType || row.hierarchyType === hierarchyType) && row.parentCode === code
      );
      
    const isLeaf = (row) => !hasChildren(row.code);
    const isLeafLevel = level
      ? level.isLeafServiceCode === true || (children.length > 0 && children.every(isLeaf))
      : children.every((row) => row.department !== undefined || row.slaHours !== undefined);

    const options = children.map((row) => row.code);
    return {
      options,
      messageBundle: this.hierarchyMessageBundle(options),
      trailBundle: this.hierarchyMessageBundle(hierarchyPath),
      levelLabel: level?.label ?? "",
      isLeafLevel,
      leafByCode: this.leafExceptions(children.map((row) => [row.code, isLeaf(row)]), isLeafLevel)
    };
  }

  /** Codes whose leafness disagrees with isLeafLevel; empty on a uniform level.
   *  Rides in context, which is serialised into eg_chat_state_v2 each transition. */
  leafExceptions(pairs, isLeafLevel) {
    const exceptions = {};
    for (const [code, leaf] of pairs) {
      if (leaf !== isLeafLevel) exceptions[code] = leaf;
    }
    return exceptions;
  }

  hierarchyMessageBundle(codes) {
    const messageBundle = {};
    for (const code of codes) {
      messageBundle[code] = localisationService.getMessageBundleForCode(
        "COMPLAINT_HIERARCHY." + code.toUpperCase()
      );
    }
    return messageBundle;
  }

  async fetchBoundaryHierarchy(tenantId) {
    const url =
      config.egovServices.egovServicesHost +
      "boundary-service/boundary-hierarchy-definition/_search";
     
      const data = await referenceCache.get(`boundary-def:${tenantId}`, async () => {
        const response = await fetch(url, {
          method: "POST",
          timeout: config.timeouts.request,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            RequestInfo: {},
            BoundaryTypeHierarchySearchCriteria: { tenantId },
          }),
        });

        if (!response.ok) {
          throw new Error(`Boundary hierarchy fetch failed with status ${response.status}`);
        }

        return response.json();
    });

    // a tenant can have several unrelated hierarchy types registered (other
    // modules, QA fixtures) - pick the one PGR is configured to use, not just
    // whichever the search happens to return first.
    const definition = (data.BoundaryHierarchy ?? []).find(
      (d) => d.hierarchyType === config.boundaryHierarchyType
    ) ?? {};
    const levels = (definition.boundaryHierarchy ?? []).filter(
      (level) => level.active !== false
    );
    return {
      hierarchyType: definition.hierarchyType,
      levels: this.orderBoundaryLevels(levels),
    };
  }

  // Levels declare parentBoundaryType, not an index; follow the chain from the root.
  orderBoundaryLevels(levels) {
    const byParent = {};
    for (const level of levels) {
      byParent[level.parentBoundaryType ?? "\u0000root"] = level;
    }
    const ordered = [];
    let key = "\u0000root";
    while (byParent[key] && ordered.length <= levels.length) {
      ordered.push(byParent[key]);
      key = byParent[key].boundaryType;
    }
    return ordered.length ? ordered : levels;
  }

  async fetchBoundaryStep(tenantId, boundaryPath = []) {
    const { hierarchyType, levels } = await this.fetchBoundaryHierarchy(tenantId);
    if (!hierarchyType) {
      throw new ExternalServiceError(
        `No boundary hierarchy registered for '${config.boundaryHierarchyType}' in tenant ${tenantId}`
      );
    }


    const url =
      config.egovServices.egovServicesHost +
      "boundary-service/boundary-relationships/_search?tenantId=" +
      encodeURIComponent(tenantId) +
      "&hierarchyType=" +
      encodeURIComponent(hierarchyType) +
      "&includeChildren=true";
    
    const data = await referenceCache.get(`boundary-tree:${tenantId}:${hierarchyType}`, async () => {
      const response = await fetch(url, {
        method: "POST",
        timeout: config.timeouts.request,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ RequestInfo: {} }),
      });

      if (!response.ok) {
        throw new Error(`Boundary relationships fetch failed with status ${response.status}`);
      }

      return response.json();
    });


    let nodes = (data.TenantBoundary ?? []).flatMap((entry) => entry.boundary ?? []);
    for (const code of boundaryPath) {
      const match = nodes.find((node) => node.code === code);
      nodes = match?.children ?? [];
    }

    const options = nodes
      .map((node) => node.code)
      .sort((a, b) => String(a).localeCompare(String(b)));

    const isLeaf = (node) => (node.children ?? []).length === 0;
    const isLeafLevel = nodes.every(isLeaf);

    return {
      options,
      messageBundle: this.boundaryMessageBundle(options),
      levelLabel:
        nodes[0]?.boundaryType ?? levels[boundaryPath.length]?.boundaryType ?? "",
      isLeafLevel,
      leafByCode: this.leafExceptions(nodes.map((node) => [node.code, isLeaf(node)]), isLeafLevel),
    };

  }

  boundaryMessageBundle(codes) {
    const messageBundle = {};
    for (const code of codes) {
      messageBundle[code] = localisationService.getMessageBundleForCode(code);
    }
    return messageBundle;
  }

  
/**
   * The city pick-list a citizen chooses from, and the tenant the complaint is filed against.
   *
   * Derived from `tenant.tenants`, NOT seeded statically. The previous implementation read
   * only `tenant.citymodule` filtered on `module == 'PGR.WHATSAPP'`, which conflated two
   * different questions: "which tenants have the WhatsApp module" and "which cities can a
   * citizen file in". Seeding that row with the module's own tenant produced a one-entry
   * pick-list containing the STATE tenant, with no localisation, so selecting it filed the
   * complaint at state level while boundaries and employees live at the city tenant -- the
   * complaint landed in nobody's inbox. An absent row was no better: an empty list is a dead
   * end the citizen cannot get past.
   *
   * `tenant.tenants` is the master city onboarding actually populates, so the list stays
   * correct without a seed step. `citymodule` is still honoured when present, as an operator
   * override for restricting WhatsApp to a subset of cities.
   */
  async fetchCities(tenantId, user) {
    let cities = await this.fetchWhatsAppCityOverride(tenantId, user);
    if (!cities.length) cities = await this.fetchCityTenants(tenantId, user);

    let messageBundle = {};
    for (let city of cities) {
      messageBundle[city] = localisationService.getMessageBundleForCode(city);
    }
    return { cities, messageBundle };
  }

  /** City tenants from `tenant.tenants` -- everything below the state root. */
  async fetchCityTenants(tenantId, user) {
    const stateRoot = String(tenantId || "").split(".")[0];
    try {
      const rows = await this.fetchMdmsData(tenantId, "tenant", "tenants", "$.*", user);
      const codes = (rows || [])
        .map((r) => (typeof r === "string" ? r : r && r.code))
        .filter((c) => c && c !== stateRoot);
      if (codes.length) return codes;
      // Single-tenant deployment: the state root IS the only place to file.
      return stateRoot ? [stateRoot] : [];
    } catch (error) {
      console.error(`Unable to derive city tenants for ${tenantId}: ${error.message}`);
      return stateRoot ? [stateRoot] : [];
    }
  }

  /** Optional `tenant.citymodule` PGR.WHATSAPP restriction. Empty when unset. */
  async fetchWhatsAppCityOverride(tenantId, user) {
    try {
      const codes = await this.fetchMdmsData(
        tenantId,
        "tenant",
        "citymodule",
        "$.[?(@.module=='PGR.WHATSAPP')].tenants.*.code",
        user
      );
      // A row listing only the state root is the mis-seeded shape described above; treat it
      // as "no override" rather than filing every complaint at state level.
      const stateRoot = String(tenantId || "").split(".")[0];
      return (codes || []).filter((c) => c && c !== stateRoot);
    } catch (error) {
      return [];
    }
  }

  async getCityExternalWebpageLink(tenantId, whatsAppBusinessNumber) {
    let url =
      config.egovServices.externalHost +
      config.egovServices.cityExternalWebpagePath +
      "?tenantId=" +
      tenantId;
    // The business number belongs to the TWILIO ACCOUNT, not to the citizen's tenant, so it
    // is deliberately NOT normalised against the tenant's mobile rule: a Kenyan tenant on
    // the Twilio US sandbox sender produced phone=%2B25414155238886, a dead wa.me target.
    // It arrives in E.164 already, so its own digits are used as-is.
    //
    // Blank omits the parameter entirely, which is what host_vars promises. Previously
    // toE164('') returned null and encodeURIComponent(null) rendered the literal
    // "phone=null" into the URL.
    const phoneDigits = mobileValidation.digitsOnly(whatsAppBusinessNumber);
    if (phoneDigits) url += "&phone=" + encodeURIComponent("+" + phoneDigits);
    let shorturl = await this.getShortenedURL(url);
    return shorturl;
  }



  
  async getLocalityExternalWebpageLink(tenantId, whatsAppBusinessNumber) {
    let url =
      config.egovServices.externalHost +
      config.egovServices.localityExternalWebpagePath +
      "?tenantId=" +
      tenantId;
    // The business number belongs to the TWILIO ACCOUNT, not to the citizen's tenant, so it
    // is deliberately NOT normalised against the tenant's mobile rule: a Kenyan tenant on
    // the Twilio US sandbox sender produced phone=%2B25414155238886, a dead wa.me target.
    // It arrives in E.164 already, so its own digits are used as-is.
    //
    // Blank omits the parameter entirely, which is what host_vars promises. Previously
    // toE164('') returned null and encodeURIComponent(null) rendered the literal
    // "phone=null" into the URL.
    const phoneDigits = mobileValidation.digitsOnly(whatsAppBusinessNumber);
    if (phoneDigits) url += "&phone=" + encodeURIComponent("+" + phoneDigits);
    let shorturl = await this.getShortenedURL(url);
    return shorturl;
  }

  async fetchLocalities(tenantId, user) {
    try {
      // First, fetch hierarchy schema to determine the lowest level
      let lowestBoundaryType = 'Locality'; // Default

      try {
        const mdmsData = await this.fetchMdmsV2Data(
          tenantId,
          [
            {
              moduleName: "CMS-BOUNDARY",
              masterDetails: [{ name: "HierarchySchema" }]
            }
          ],
          user
        );

        if (mdmsData['CMS-BOUNDARY'] && mdmsData['CMS-BOUNDARY']['HierarchySchema']) {
          const hierarchySchemas = mdmsData['CMS-BOUNDARY']['HierarchySchema'];
          // Find ADMIN hierarchy
          const adminHierarchy = hierarchySchemas.find(h => h.hierarchy === 'ADMIN');
          if (adminHierarchy && adminHierarchy.lowestHierarchy) {
            lowestBoundaryType = adminHierarchy.lowestHierarchy;
          }
        }
      } catch (mdmsError) {
      }

      // Step 1: Fetch boundary data from boundary service with specific boundary type

      // Use boundary type parameter to fetch only the lowest level boundaries
      const boundaryUrl = `${config.egovServices.egovServicesHost}boundary-service/boundary-relationships/_search?tenantId=${tenantId}&hierarchyType=ADMIN&boundaryType=${lowestBoundaryType}&includeChildren=true`;

      const boundaryRequest = {
        RequestInfo: {
          apiId: "Rainmaker",
          msgId: Date.now() + "|en_IN",
          authToken: user ? user.authToken : undefined,
          plainAccessRequest: {}
        }
      };

      const boundaryOptions = {
        method: "POST",
        body: JSON.stringify(boundaryRequest),
        headers: {
          "Content-Type": "application/json"
        }
      };

      const boundaryResponse = await fetch(boundaryUrl, { ...boundaryOptions, timeout: config.timeouts.request });

      if (!boundaryResponse.ok) {
        throw new Error(`Boundary service returned status ${boundaryResponse.status}`);
      }

      const boundaryData = await boundaryResponse.json();

      // Extract locality codes - When using boundaryType parameter, response contains only those boundaries
      const localityCodes = [];
      const localityMap = new Map(); // Store code to full locality object mapping

      if (boundaryData && boundaryData.TenantBoundary && boundaryData.TenantBoundary.length > 0) {
        const tenantBoundary = boundaryData.TenantBoundary[0];
        const boundaries = tenantBoundary.boundary || [];

        // When boundaryType is specified, boundaries array contains only that type
        for (const boundary of boundaries) {
          if (boundary.code) {
            localityCodes.push(boundary.code);
            localityMap.set(boundary.code, boundary);
          }
        }
      }

      if (localityCodes.length === 0) {
        throw new Error(`No localities found for tenant ${tenantId}`);
      }


      // Step 2: Fetch localization messages for these locality codes from digit-tenants module
      const localizationUrl = `${config.egovServices.egovServicesHost}localization/messages/v1/_search?module=digit-tenants&locale=en_IN&tenantId=${tenantId}`;

      const localizationRequest = {
        RequestInfo: {
          apiId: "Rainmaker",
          authToken: user ? user.authToken : undefined,
          msgId: Date.now() + "|en_IN",
          plainAccessRequest: {}
        }
      };

      const localizationOptions = {
        method: "POST",
        body: JSON.stringify(localizationRequest),
        headers: {
          "Content-Type": "application/json"
        }
      };

      let localizedMessages = {};

      try {
        const localizationResponse = await fetch(localizationUrl, { ...localizationOptions, timeout: config.timeouts.request });

        if (localizationResponse.ok) {
          const localizationData = await localizationResponse.json();

          if (localizationData && localizationData.messages) {

            // Create a map of code to message for locality codes
            // The messages use ADMIN_ prefixed codes (e.g., ADMIN_SUN01)
            localizationData.messages.forEach(msg => {
              // Check if this message corresponds to a locality code
              localityCodes.forEach(code => {
                // Direct match for ADMIN_ prefixed codes
                if (msg.code === code) {
                  localizedMessages[code] = msg.message;
                }
              });
            });

          }
        } else {
        }
      } catch (localizationError) {
        // Continue without localized messages
      }

      // Step 3: Build the result with proper display names
      const localities = [];
      const messageBundle = {};

      for (const code of localityCodes) {
        // Remove ADMIN_ prefix for PGR usage
        const localityCodeForPGR = code.replace(/^ADMIN_/, '');
        localities.push(localityCodeForPGR);

        // Use localized name if available, otherwise generate a readable name from the code
        let displayName = localizedMessages[code];

        if (!displayName) {
          // Try to extract a readable name from the locality object if available
          const localityObj = localityMap.get(code);
          if (localityObj && localityObj.name) {
            displayName = localityObj.name;
          } else {
            // Generate a readable name from the code (e.g., "ADMIN_SUN04" -> "Sun 04")
            const cleanCode = localityCodeForPGR;
            displayName = cleanCode
              .replace(/([A-Z]+)(\d+)/, '$1 $2')  // Add space between letters and numbers
              .replace(/_/g, ' ')  // Replace underscores with spaces
              .split(' ')
              .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
              .join(' ');
          }
        }

        messageBundle[localityCodeForPGR] = {
          en_IN: displayName,
          hi_IN: displayName,  // Will use same unless we fetch hi_IN locale too
          pa_IN: displayName   // Will use same unless we fetch pa_IN locale too
        };
      }

      return { localities, messageBundle };

    } catch (error) {

      // Fallback to MDMS if boundary service fails
      try {

        let moduleName = "egov-location";
        let masterName = "TenantBoundary";
        let filterPath =
          '$.[?(@.hierarchyType.code=="ADMIN")].boundary.children.*.children.*.children.*';

        let boundaryData = await this.fetchMdmsData(
          tenantId,
          moduleName,
          masterName,
          filterPath,
          user
        );

        if (boundaryData && boundaryData.length > 0) {
          let localities = [];
          for (let i = 0; i < boundaryData.length; i++) {
            localities.push(boundaryData[i].code);
          }

          let localitiesLocalisationCodes = [];
          for (let locality of localities) {
            let localisationCode =
              tenantId.replace(".", "_").toUpperCase() + "_ADMIN_" + locality;
            localitiesLocalisationCodes.push(localisationCode);
          }

          let localisedMessages =
            await localisationService.getMessagesForCodesAndTenantId(
              localitiesLocalisationCodes,
              tenantId
            );

          let messageBundle = {};
          for (let locality of localities) {
            let localisationCode =
              tenantId.replace(".", "_").toUpperCase() + "_ADMIN_" + locality;
            messageBundle[locality] = localisedMessages[localisationCode];
          }

          return { localities, messageBundle };
        }
      } catch (mdmsError) {
      }

      throw new Error(`Unable to fetch localities for tenant ${tenantId}`);
    }
  }

  
  async preparePGRResult(responseBody, locale) {
    let serviceWrappers = responseBody.ServiceWrappers;
    var results = {};
    results["ServiceWrappers"] = [];
    let localisationPrefix = "COMPLAINT_HIERARCHY.";
    let statusLocalisationPrefix = "CS_COMMON_";

    let complaintLimit = config.pgrUseCase.complaintSearchLimit;

    if (serviceWrappers.length < complaintLimit)
      complaintLimit = serviceWrappers.length;
    var count = 0;
    
    // Collect all localization codes needed
    let localizationCodes = [];
    let statusCodes = [];
    let tenantId = serviceWrappers.length > 0 ? serviceWrappers[0].service.tenantId : config.rootTenantId;
    
    for (let i = 0; i < complaintLimit && i < serviceWrappers.length; i++) {
      localizationCodes.push(localisationPrefix + serviceWrappers[i].service.serviceCode.toUpperCase());
      // Add status codes for localization
      if (serviceWrappers[i].service.applicationStatus) {
        statusCodes.push(statusLocalisationPrefix + serviceWrappers[i].service.applicationStatus.toUpperCase());
      }
    }
    
    // Fetch all localizations at once from API
    let localizedMessages = {};
    if (localizationCodes.length > 0) {
      localizedMessages = await localisationService.getMessagesForCodesAndTenantId(
        localizationCodes,
        tenantId
      );
    }
    
    // Fetch status localizations from rainmaker-pgr module
    let statusLocalizedMessages = {};
    if (statusCodes.length > 0) {
      // Use the localization service to fetch messages for the rainmaker-pgr module
      try {
        const pgrMessages = await localisationService.getMessagesForModule('rainmaker-pgr', locale, tenantId);
        
        // Map the status codes to their localized messages
        statusCodes.forEach(statusCode => {
          if (pgrMessages[statusCode]) {
            statusLocalizedMessages[statusCode] = pgrMessages[statusCode];
          }
        });
      } catch (error) {
        console.log("Error fetching status localizations:", error);
      }
    }

    for (let serviceWrapper of serviceWrappers) {
      if (count < complaintLimit) {
        let mobileNumber = serviceWrapper.service.citizen.mobileNumber;
        let serviceRequestId = serviceWrapper.service.serviceRequestId;
        let complaintURL = await this.makeCitizenURLForComplaint(
          serviceRequestId,
          mobileNumber
        );
        
        let localizationKey = localisationPrefix + serviceWrapper.service.serviceCode.toUpperCase();
        let serviceCode = localizedMessages[localizationKey] || {};
        
        let filedDate = serviceWrapper.service.auditDetails.createdTime;
        filedDate = moment(filedDate)
          .tz(config.timeZone)
          .format(config.dateFormat);
        
        // Get localized status or fallback to formatted status
        let applicationStatus = serviceWrapper.service.applicationStatus;
        if (applicationStatus) {
          let statusKey = statusLocalisationPrefix + applicationStatus.toUpperCase();
          applicationStatus = statusLocalizedMessages[statusKey] || applicationStatus;
        }
        
        var data = {
          complaintType: dialog.get_message(serviceCode, locale),
          complaintNumber: serviceRequestId,
          filedDate: filedDate,
          complaintStatus: applicationStatus,
          complaintLink: complaintURL,
        };
        count++;
        results["ServiceWrappers"].push(data);
      } else break;
    }
    return results["ServiceWrappers"];
  }

  async persistComplaint(user, slots, extraInfo) {
    let requestBody = JSON.parse(pgrCreateRequestBody);

    const serviceAccount = await userService.getServiceAccount();
    let authToken = serviceAccount.authToken;
    let userId = user.userId;
    let complaintType = slots.complaint;
    let locality = slots.locality;
    let city = slots.city;
    let userInfo = serviceAccount.userInfo;

    requestBody["RequestInfo"]["authToken"] = authToken;
    requestBody["service"]["tenantId"] = city;
    requestBody["service"]["citizen"] = user.userInfo;
    requestBody["service"]["address"]["city"] = city;
    requestBody["service"]["address"]["locality"]["code"] = locality;
    requestBody["service"]["accountId"] = userId;
    requestBody["RequestInfo"]["userInfo"] = userInfo;

    // Add localized locality name if available
    if (slots.localityName) {
      requestBody["service"]["address"]["locality"]["name"] = slots.localityName;
    } else {
      // Try to fetch the localized name
      try {
        const localizationUrl = `${config.egovServices.egovServicesHost}localization/messages/v1/_search?module=digit-tenants&locale=en_IN&tenantId=${city}`;
        const localizationRequest = {
          RequestInfo: {
            apiId: "Rainmaker",
            authToken: authToken,
            msgId: Date.now() + "|en_IN",
            plainAccessRequest: {}
          }
        };

        const response = await fetch(localizationUrl, {
          method: "POST",
          timeout: config.timeouts.request,
          body: JSON.stringify(localizationRequest),
          headers: { "Content-Type": "application/json" }
        });

        if (response.ok) {
          const data = await response.json();
          if (data.messages) {
            // Look for ADMIN_<locality> code
            const localityCode = locality;
            const message = data.messages.find(m => m.code === localityCode);
            if (message) {
              requestBody["service"]["address"]["locality"]["name"] = message.message;
            }
          }
        }
      } catch (error) {
      }
    }

    requestBody["service"]["serviceCode"] = complaintType;
    requestBody["service"]["description"] = slots.description ?? "";
    requestBody["service"]["extendedAttributes"] = {
      caseRelatedTo: config.caseRelatedTo,
      instituteName: slots.instituteName,
      isConfidential: slots.isConfidential === true,
    };

    // Handle location coordinates (geocode)
    if (slots.geocode) {
      let latlng = slots.geocode.substring(1, slots.geocode.length - 1);
      latlng = latlng.split(",");
      requestBody["service"]["address"]["geoLocation"]["latitude"] = latlng[0];
      requestBody["service"]["address"]["geoLocation"]["longitude"] = latlng[1];
    }

    // Handle image upload from slots.image (existing flow)
    if (slots.image) {
      try {
        // slots.image already contains the filestore ID from channel upload
        var content = {
          documentType: "PHOTO",
          filestoreId: slots.image,
        };
        requestBody["workflow"]["verificationDocuments"].push(content);
      } catch (error) {
      }
    }

    // Handle image upload from extraInfo.fileStoreId (new flow)
    if (extraInfo && extraInfo.fileStoreId) {
      try {
        // extraInfo.fileStoreId already contains the filestore ID
        var content = {
          documentType: "PHOTO",
          filestoreId: extraInfo.fileStoreId,
        };
        requestBody["workflow"]["verificationDocuments"].push(content);
      } catch (error) {
      }
    }

    // Log final request for debugging

    var url =
      config.egovServices.egovServicesHost +
      config.egovServices.pgrCreateEndpoint +
      "?tenantId=" +
      city;

    var options = {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers: {
        "Content-Type": "application/json",
      },
      timeout: config.timeouts.request,
    };

    let response = await fetch(url, { ...options, timeout: config.timeouts.request });

    if (response.status === 200) {
      // the create endpoint wraps its result the same way search does:
      // {ServiceWrappers: [{service: {...}}]}
      let responseBody = await response.json();
      let serviceWrapper = (responseBody.ServiceWrappers || [])[0];
      return { complaintNumber: serviceWrapper && serviceWrapper.service && serviceWrapper.service.serviceRequestId };
    } else {
      const errorText = await response.text();
      throw new Error(`Failed to create complaint: ${response.status} ${errorText}`);
    }
  }

  
  async getShortenedURL(finalPath) {
    var url =
      config.egovServices.egovServicesHost +
      config.egovServices.urlShortnerEndpoint;
    var request = {};
    request.url = finalPath;
    var options = {
      method: "POST",
      body: JSON.stringify(request),
      headers: {
        "Content-Type": "application/json",
      },
    };
    let response = await fetch(url, { ...options, timeout: config.timeouts.request });
    if (!response.ok) {
      return finalPath;
    }
    let data = await response.text();
    return data;
  }

  async makeCitizenURLForComplaint(serviceRequestId, mobileNumber) {
    let encodedPath = urlencode(serviceRequestId, "utf8");

    // Use sandbox-ui for sandbox mode, digit-ui otherwise
    const uiPath = config.isSandboxMode ? 'sandbox-ui' : 'digit-ui';

    let url;
    if (config.isSandboxMode) {
      // For sandbox mode, use the proper login page with redirect
      const sandboxHost = config.sandboxHost || 'https://sandbox.digit.org';
      url = `${sandboxHost}/sandbox-ui/user/login?redirectTo=/sandbox-ui/citizen/pgr/complaints/${encodedPath}`;
    } else {
      // For production mode, use the OTP login
      url = config.egovServices.externalHost +
        "citizen/otpLogin?mobileNo=" +
        mobileNumber +
        `/digit-ui/citizen/pgr/complaints/` +
        encodedPath;
    }
    
    let shortURL = await this.getShortenedURL(url);
    return shortURL;
  }

  async downloadImage(url, filename) {
      // Fix: Validate filename before creating WriteStream
  if (!filename || filename.trim() === '') {
    const timestamp = Date.now();
    filename = `pgr_download_${timestamp}.jpg`;
  }

  filename = filename.toString().trim();
  if (filename === '') {
    filename = `pgr_fallback_${Date.now()}.jpg`;
  }


    const writer = fs.createWriteStream(filename);

    const response = await axios({
      url,
      method: "GET",
      responseType: "stream",
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
  }

  async fileStoreAPICall(fileName, fileData, tenantId, contentType = null) {
    var url =
      config.egovServices.egovServicesHost +
      config.egovServices.egovFilestoreServiceUploadEndpoint;
    url = url + "&tenantId=" + tenantId;
    var form = new FormData();
    form.append("file", fileData, {
      filename: fileName,
      contentType: mediaTypes.filestoreContentType(fileName) || contentType || "image/jpg",
    });
    let response = await axios.post(url, form, {
      headers: {
        ...form.getHeaders(),
      },
    });

    var filestore = response.data;
    return filestore["files"][0]["fileStoreId"];
  }

  async getFileForFileStoreId(filestoreId, tenantId) {
    var url =
      config.egovServices.egovServicesHost +
      config.egovServices.egovFilestoreServiceDownloadEndpoint;
    url = url + "?";
    url = url + "tenantId=" + config.rootTenantId;
    url = url + "&";
    url = url + "fileStoreIds=" + filestoreId;

    var options = {
      method: "GET",
      origin: "*",
    };

    let response = await fetch(url, { ...options, timeout: config.timeouts.request });
    response = await response.json();

    // Handle the correct response structure based on actual API response
    if (!response) {
      throw new Error("No response received from filestore");
    }

    // Check for both possible response structures
    let fileData;
    if (response.fileStoreIds && response.fileStoreIds.length > 0 && response.fileStoreIds[0].url) {
      // Old structure
      fileData = response.fileStoreIds[0];
    } else if (response.files && response.files.length > 0) {
      // New structure - need to make another call to get URL

      // For now, construct the URL directly since the response only has fileStoreId and tenantId
      // This is a common pattern in DIGIT filestore services
      let directUrl = config.egovServices.egovServicesHost +
                     "filestore/v1/files/id?fileStoreId=" + filestoreId +
                     "&tenantId=" + tenantId;

      fileData = {
        fileStoreId: filestoreId,
        tenantId: tenantId,
        url: directUrl
      };
    } else {
      throw new Error("Invalid filestore response structure");
    }

    if (!fileData.url) {
      throw new Error("No URL found in filestore response");
    }

    var fileURL = fileData.url.split(",");
    var fileName = geturl.parse(fileURL[0]);
    fileName = path.basename(fileName.pathname);
    fileName = fileName.substring(13);
    await this.downloadImage(fileURL[0].toString(), fileName);
    let imageInBase64String = fs.readFileSync(fileName, "base64");
    imageInBase64String = imageInBase64String.replace(/ /g, "+");
    let fileDataBuffer = Buffer.from(imageInBase64String, "base64");
    var newFilestoreId = await this.fileStoreAPICall(fileName, fileDataBuffer, tenantId);
    fs.unlinkSync(fileName);
    return newFilestoreId;
  }
}

module.exports = new PGRService();
