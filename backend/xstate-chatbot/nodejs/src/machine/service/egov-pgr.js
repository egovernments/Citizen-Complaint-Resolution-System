const fetch = require("node-fetch");
const config = require("../../env-variables");
const getCityAndLocality = require("./util/google-maps-util");
const localisationService = require("../util/localisation-service");
const urlencode = require("urlencode");
const dialog = require("../util/dialog");
const moment = require("moment-timezone");
const fs = require("fs");
const axios = require("axios");
var FormData = require("form-data");
var geturl = require("url");
var path = require("path");
require("url-search-params-polyfill");

let pgrCreateRequestBody =
  '{"RequestInfo":{"authToken":"","userInfo":{}},"service":{"tenantId":"","serviceCode":"","description":"","accountId":"","source":"whatsapp","address":{"landmark":"","city":"","geoLocation":{"latitude": null, "longitude": null},"locality":{"code":""}}},"workflow":{"action":"APPLY","verificationDocuments":[]}}';

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

    let response = await fetch(url, options);

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

    let response = await fetch(url, options);

    if (!response.ok) {
      throw new Error(`MDMS v2 fetch failed with status ${response.status}`);
    }

    let data = await response.json();
    return data.MdmsRes || data.mdms || {};
  }

  async fetchFrequentComplaints(tenantId, user) {
    try {

      // Try MDMS v2 first
      try {
        const mdmsData = await this.fetchMdmsV2Data(
          tenantId,
          [
            {
              moduleName: "RAINMAKER-PGR",
              masterDetails: [{ name: "ServiceDefs" }]
            }
          ],
          user
        );

        if (mdmsData['RAINMAKER-PGR'] && mdmsData['RAINMAKER-PGR']['ServiceDefs']) {
          const serviceDefs = mdmsData['RAINMAKER-PGR']['ServiceDefs'];

          // Filter active services - show all complaint types
          const activeServices = serviceDefs
            .filter(def => def.active === true)
            .sort((a, b) => (a.order || 999) - (b.order || 999));
            // Removed slice to show all complaint types

          let complaintTypes = [];
          let messageBundle = {};
          let localisationPrefix = "SERVICEDEFS_";
          
          // Collect all localization codes
          let localizationCodes = [];
          for (let service of activeServices) {
            complaintTypes.push(service.serviceCode);
            localizationCodes.push(localisationPrefix + service.serviceCode.toUpperCase());
          }
          
          // Fetch all localizations at once from API
          let localizedMessages = await localisationService.getMessagesForCodesAndTenantId(
            localizationCodes,
            tenantId
          );
          
          // Build message bundle
          for (let service of activeServices) {
            let localizationKey = localisationPrefix + service.serviceCode.toUpperCase();
            if (localizedMessages[localizationKey] && Object.keys(localizedMessages[localizationKey]).length > 0) {
              messageBundle[service.serviceCode] = localizedMessages[localizationKey];
            } else {
              // Fallback to MDMS name if localization not found
              messageBundle[service.serviceCode] = {
                en_IN: service.name || service.serviceCode,
                hi_IN: service.name || service.serviceCode
              };
            }
          }

          return { complaintTypes, messageBundle };
        }
      } catch (v2Error) {
      }

      // Fallback to MDMS v1
      let complaintTypeMdmsData = await this.fetchMdmsData(
        tenantId,
        "RAINMAKER-PGR",
        "ServiceDefs",
        "$.[?(@.active == true)]",
        user
      );
      let sortedData = complaintTypeMdmsData
        .slice()
        .sort((a, b) => (a.order || 999) - (b.order || 999));
        // Removed slice to show all complaint types

      let complaintTypes = [];
      let messageBundle = {};
      let localisationPrefix = "SERVICEDEFS_";
      
      // Collect unique service codes and localization codes
      let localizationCodes = [];
      for (let data of sortedData) {
        if (!complaintTypes.includes(data.serviceCode)) {
          complaintTypes.push(data.serviceCode);
          localizationCodes.push(localisationPrefix + data.serviceCode.toUpperCase());
        }
      }
      
      // Fetch all localizations at once from API
      let localizedMessages = await localisationService.getMessagesForCodesAndTenantId(
        localizationCodes,
        tenantId
      );
      
      // Build message bundle
      for (let data of sortedData) {
        if (messageBundle[data.serviceCode]) continue; // Skip if already processed
        
        let localizationKey = localisationPrefix + data.serviceCode.toUpperCase();
        if (localizedMessages[localizationKey] && Object.keys(localizedMessages[localizationKey]).length > 0) {
          messageBundle[data.serviceCode] = localizedMessages[localizationKey];
        } else {
          // Fallback to MDMS name if localization not found
          messageBundle[data.serviceCode] = {
            en_IN: data.name || data.serviceCode,
            hi_IN: data.name || data.serviceCode
          };
        }
      }

      return { complaintTypes, messageBundle };
    } catch (error) {

      // Fallback to basic complaint types if MDMS fails
      const fallbackTypes = [
        { code: 'STREETLIGHT', name: 'Streetlight not working' },
        { code: 'SEWAGE', name: 'Sewage overflow / blocked' },
        { code: 'GARBAGE', name: 'Garbage not cleared' },
        { code: 'WATER', name: 'Pipe broken / leaking' }
      ];

      let complaintTypes = [];
      let messageBundle = {};

      for (let type of fallbackTypes) {
        complaintTypes.push(type.code);
        messageBundle[type.code] = {
          en_IN: type.name,
          hi_IN: type.name
        };
      }

      return { complaintTypes, messageBundle };
    }
  }


  async fetchComplaintCategories(tenantId) {
    //
    let complaintCategories = await this.fetchMdmsData(
      tenantId,
      "RAINMAKER-PGR",
      "ServiceDefs",
      "$.[?(@.active == true)].menuPath"
    );
    complaintCategories = [...new Set(complaintCategories)];
    complaintCategories = complaintCategories.filter(
      (complaintCategory) => complaintCategory != ""
    ); // To remove any empty category
    let localisationPrefix = "SERVICEDEFS_";
    let messageBundle = {};
    for (let complaintCategory of complaintCategories) {
      let message = localisationService.getMessageBundleForCode(
        localisationPrefix + complaintCategory.toUpperCase()
      );
      messageBundle[complaintCategory] = message;
    }
    return { complaintCategories, messageBundle };
  }


  async fetchComplaintItemsForCategory(category, tenantId) {
    let complaintItems = await this.fetchMdmsData(
      tenantId,
      "RAINMAKER-PGR",
      "ServiceDefs",
      '$.[?(@.active == true && @.menuPath == "' + category + '")].serviceCode'
    );
    let localisationPrefix = "SERVICEDEFS_";
    let messageBundle = {};
    for (let complaintItem of complaintItems) {
      let message = localisationService.getMessageBundleForCode(
        localisationPrefix + complaintItem.toUpperCase()
      );
      messageBundle[complaintItem] = message;
    }

    return { complaintItems, messageBundle };
  }


  async getCityAndLocalityForGeocode(geocode, tenantId) {
    let latlng = geocode.substring(1, geocode.length - 1); // Remove braces
    let cityAndLocality = await getCityAndLocality(latlng);
    let { cities, messageBundle } = await this.fetchCities(tenantId);
    if (cityAndLocality.city == "Sahibzada Ajit Singh Nagar") {
      cityAndLocality.city = "Mohali";
    }
    let matchedCity = null;
    let matchedCityMessageBundle = null;
    for (let city of cities) {
      let cityName = messageBundle[city]["en_IN"];
      if (cityName.toLowerCase() == cityAndLocality.city.toLowerCase()) {
        matchedCity = city;
        matchedCityMessageBundle = messageBundle[city];
        break;
      }
    }
    if (matchedCity) {
      let matchedLocality = null;
      let matchedLocalityMessageBundle = null;
      let { localities, messageBundle } = await this.fetchLocalities(
        matchedCity
      );
      for (let locality of localities) {
        let localityName = messageBundle[locality]["en_IN"];
        if (
          localityName.toLowerCase() == cityAndLocality.locality.toLowerCase()
        ) {
          matchedLocality = locality;
          matchedLocalityMessageBundle = messageBundle[locality];
          return {
            city: matchedCity,
            locality: matchedLocality,
            matchedCityMessageBundle: matchedCityMessageBundle,
            matchedLocalityMessageBundle: matchedLocalityMessageBundle,
          };
        }
      }
      // Matched City found but no matching locality found
      return {
        city: matchedCity,
        matchedCityMessageBundle: matchedCityMessageBundle,
      };
    }
    return undefined; // No matching city found
  }

  async fetchCitiesAndWebpageLink(tenantId, whatsAppBusinessNumber) {
    let { cities, messageBundle } = await this.fetchCities(tenantId);
    let link = await this.getCityExternalWebpageLink(
      tenantId,
      whatsAppBusinessNumber
    );
    return { cities, messageBundle, link };
  }

  async fetchCities(tenantId) {
    let cities = await this.fetchMdmsData(
      tenantId,
      "tenant",
      "citymodule",
      "$.[?(@.module=='PGR.WHATSAPP')].tenants.*.code"
    );
    let messageBundle = {};
    for (let city of cities) {
      let message = localisationService.getMessageBundleForCode(city);
      messageBundle[city] = message;
    }
    return { cities, messageBundle };
  }

  async getCityExternalWebpageLink(tenantId, whatsAppBusinessNumber) {
    let url =
      config.egovServices.externalHost +
      config.egovServices.cityExternalWebpagePath +
      "?tenantId=" +
      tenantId +
      "&phone=+91" +
      whatsAppBusinessNumber;
    let shorturl = await this.getShortenedURL(url);
    return shorturl;
  }

  async fetchLocalitiesAndWebpageLink(tenantId, whatsAppBusinessNumber, user) {
    let { localities, messageBundle } = await this.fetchLocalities(tenantId, user);
    let link = await this.getLocalityExternalWebpageLink(
      tenantId,
      whatsAppBusinessNumber
    );
    return { localities, messageBundle, link };
  }

  async getLocalityExternalWebpageLink(tenantId, whatsAppBusinessNumber) {
    let url =
      config.egovServices.externalHost +
      config.egovServices.localityExternalWebpagePath +
      "?tenantId=" +
      tenantId +
      "&phone=+91" +
      whatsAppBusinessNumber;
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

      const boundaryResponse = await fetch(boundaryUrl, boundaryOptions);

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
        const localizationResponse = await fetch(localizationUrl, localizationOptions);

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

  async getCity(input, locale, tenantId) {

    try {
    var url =
      config.egovServices.nlpEngineHost +
      config.egovServices.cityFuzzySearch;

    // Add tenant ID to bypass gateway
    if (tenantId) {
      url += `?tenantId=${tenantId}`;
    }

    // Fix locale format - NLP expects "en" not "en_IN"
    const nlpLocale = locale === "en_IN" ? "en" : locale.split("_")[0];

    var requestBody = {
      input_city: input,
      input_lang: nlpLocale,
    };

    var options = {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers: {
        "Content-Type": "application/json",
      },
    };


    let response = await fetch(url, options);

    let predictedCity = null;
    let predictedCityCode = null;
    let isCityDataMatch = false;
    if (response.status === 200) {
      let responseBody = await response.json();
      if (responseBody.match == 0) {
        return { predictedCityCode, predictedCity, isCityDataMatch };
      } else {
        predictedCityCode = responseBody.city_detected[0];
        let localisationMessages =
          await localisationService.getMessageBundleForCode(predictedCityCode);
        predictedCity = dialog.get_message(localisationMessages, locale);
        if (locale === "en_IN") {
          if (predictedCity.toLowerCase() === input.toLowerCase())
            isCityDataMatch = true;
        } else {
          if (predictedCity === input) isCityDataMatch = true;
        }
        return { predictedCityCode, predictedCity, isCityDataMatch };
      }
    } else {
      const errorText = await response.text();
      return { predictedCityCode, predictedCity, isCityDataMatch };
    }
  } catch (error) {
    return { predictedCityCode: null, predictedCity: null, isCityDataMatch: false };
  }
  }

  async getLocality(input, city, locale, tenantId) {
    var url =
      config.egovServices.nlpEngineHost +
      config.egovServices.localityFuzzySearch;

    // Add tenant ID to bypass gateway
    if (tenantId) {
      url += `?tenantId=${tenantId}`;
    }

    var requestBody = {
      city: city,
      locality: input,
    };

    var options = {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers: {
        "Content-Type": "application/json",
      },
    };

    let response = await fetch(url, options);

    let predictedLocality = null;
    let predictedLocalityCode = null;
    let isLocalityDataMatch = false;

    if (response.status === 200) {
      let responseBody = await response.json();
      if (responseBody.predictions.length == 0)
        return {
          predictedLocalityCode,
          predictedLocality,
          isLocalityDataMatch,
        };
      else {
        let localityList = responseBody.predictions;
        for (let locality of localityList) {
          if (locality.name.toLowerCase() === input.toLowerCase()) {
            predictedLocalityCode = locality.code;
            predictedLocality = locality.name;
            isLocalityDataMatch = true;
            return {
              predictedLocalityCode,
              predictedLocality,
              isLocalityDataMatch,
            };
          }
        }

        predictedLocalityCode = localityList[0].code;
        predictedLocality = localityList[0].name;
        isLocalityDataMatch = false;
        return {
          predictedLocalityCode,
          predictedLocality,
          isLocalityDataMatch,
        };
      }
    } else {
      const errorText = await response.text();
      return { predictedLocalityCode, predictedLocality, isLocalityDataMatch };
    }
  }

  formatComplaintStatus(status) {
    // Convert fully capitalized status to Title Case
    // e.g., "PENDINGFORASSIGNMENT" -> "Pendingforassignment"
    if (!status) return status;
    
    // Convert to title case: First letter uppercase, rest lowercase
    return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
  }

  async preparePGRResult(responseBody, locale) {
    let serviceWrappers = responseBody.ServiceWrappers;
    var results = {};
    results["ServiceWrappers"] = [];
    let localisationPrefix = "SERVICEDEFS_";

    let complaintLimit = config.pgrUseCase.complaintSearchLimit;

    if (serviceWrappers.length < complaintLimit)
      complaintLimit = serviceWrappers.length;
    var count = 0;
    
    // Collect all localization codes needed
    let localizationCodes = [];
    let tenantId = serviceWrappers.length > 0 ? serviceWrappers[0].service.tenantId : config.rootTenantId;
    
    for (let i = 0; i < complaintLimit && i < serviceWrappers.length; i++) {
      localizationCodes.push(localisationPrefix + serviceWrappers[i].service.serviceCode.toUpperCase());
    }
    
    // Fetch all localizations at once from API
    let localizedMessages = {};
    if (localizationCodes.length > 0) {
      localizedMessages = await localisationService.getMessagesForCodesAndTenantId(
        localizationCodes,
        tenantId
      );
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
        // Format the applicationStatus for better display
        let applicationStatus = this.formatComplaintStatus(serviceWrapper.service.applicationStatus);
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

    let authToken = user.authToken;
    let userId = user.userId;
    let complaintType = slots.complaint;
    let locality = slots.locality;
    let city = slots.city;
    let userInfo = user.userInfo;

    requestBody["RequestInfo"]["authToken"] = authToken;
    requestBody["service"]["tenantId"] = city;
    requestBody["service"]["address"]["city"] = city;
    requestBody["service"]["address"]["locality"]["code"] = "ADMIN_" + locality;

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
          body: JSON.stringify(localizationRequest),
          headers: { "Content-Type": "application/json" }
        });

        if (response.ok) {
          const data = await response.json();
          if (data.messages) {
            // Look for ADMIN_<locality> code
            const localityCode = `ADMIN_${locality}`;
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
    requestBody["service"]["accountId"] = userId;
    requestBody["RequestInfo"]["userInfo"] = userInfo;

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
    };

    let response = await fetch(url, options);

    let results;
    if (response.status === 200) {
      let responseBody = await response.json();
      results = await this.preparePGRResult(responseBody, user.locale);
    } else {
      const errorText = await response.text();
      return undefined;
    }
    return results[0];
  }

  async fetchOpenComplaints(user, extraInfo) {
    let requestBody = {
      RequestInfo: {
        authToken: user.authToken,
      },
    };

    // Use tenant from extraInfo in sandbox mode, otherwise use root tenant
    let tenantId = (config.enableSandboxMode && extraInfo && extraInfo.tenantId)
      ? extraInfo.tenantId
      : config.rootTenantId;

    var url =
      config.egovServices.egovServicesHost +
      config.egovServices.pgrSearchEndpoint;
    url = url + "?tenantId=" + tenantId;
    url += "&";
    url += "mobileNumber=" + user.mobileNumber;

    let options = {
      method: "POST",
      origin: "*",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    };

    let response = await fetch(url, options);
    let results;
    if (response.status === 200) {
      let responseBody = await response.json();
      results = await this.preparePGRResult(responseBody, user.locale);
    } else {
      return [];
    }

    return results;
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
    let response = await fetch(url, options);
    let data = await response.text();
    return data;
  }

  async makeCitizenURLForComplaint(serviceRequestId, mobileNumber) {
    let encodedPath = urlencode(serviceRequestId, "utf8");

    // Use sandbox-ui for sandbox mode, digit-ui otherwise
    const uiPath = config.enableSandboxMode ? 'sandbox-ui' : 'digit-ui';

    let url;
    if (config.enableSandboxMode) {
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

  async fileStoreAPICall(fileName, fileData, tenantId) {
    var url =
      config.egovServices.egovServicesHost +
      config.egovServices.egovFilestoreServiceUploadEndpoint;
    url = url + "&tenantId=" + tenantId;
    var form = new FormData();
    form.append("file", fileData, {
      filename: fileName,
      contentType: "image/jpg",
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

    let response = await fetch(url, options);
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
