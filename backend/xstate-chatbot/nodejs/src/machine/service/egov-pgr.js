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
  async fetchMdmsData(tenantId, moduleName, masterName, filterPath) {
    var url =
      config.egovServices.egovServicesHost + config.egovServices.mdmsSearchPath;
    var request = {
      RequestInfo: {},
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
    let data = await response.json();

    return data["MdmsRes"][moduleName][masterName];
  }

  async fetchFrequentComplaints(tenantId) {
    let complaintTypeMdmsData = await this.fetchMdmsData(
      tenantId,
      "RAINMAKER-PGR",
      "ServiceDefs",
      "$.[?(@.order && @.active == true)]"
    );
    let sortedData = complaintTypeMdmsData
      .slice()
      .sort((a, b) => a.order - b.order);
    let complaintTypes = [];
    for (let data of sortedData) {
      if (!complaintTypes.includes(data.serviceCode))
        complaintTypes.push(data.serviceCode);
    }
    let localisationPrefix = "SERVICEDEFS.";
    let messageBundle = {};
    for (let complaintType of complaintTypes) {
      let message = localisationService.getMessageBundleForCode(
        localisationPrefix + complaintType.toUpperCase()
      );
      messageBundle[complaintType] = message;
    }
    return { complaintTypes, messageBundle };
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
    let localisationPrefix = "SERVICEDEFS.";
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
    let localisationPrefix = "SERVICEDEFS.";
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

  async fetchLocalitiesAndWebpageLink(tenantId, whatsAppBusinessNumber) {
    let { localities, messageBundle } = await this.fetchLocalities(tenantId);
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

  async fetchLocalities(tenantId) {
    let moduleName = "egov-location";
    let masterName = "TenantBoundary";
    let filterPath =
      '$.[?(@.hierarchyType.code=="ADMIN")].boundary.children.*.children.*.children.*';

    let boundaryData = await this.fetchMdmsData(
      tenantId,
      moduleName,
      masterName,
      filterPath
    );
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
      console.error("Error in fetching the city");
      return { predictedCityCode, predictedCity, isCityDataMatch };
    }
  } catch (error) {
    console.error("Error in getCity:", error);
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
      console.error("Error in fetching the locality");
      return { predictedLocalityCode, predictedLocality, isLocalityDataMatch };
    }
  }

  async preparePGRResult(responseBody, locale) {
    let serviceWrappers = responseBody.ServiceWrappers;
    var results = {};
    results["ServiceWrappers"] = [];
    let localisationPrefix = "SERVICEDEFS.";

    let complaintLimit = config.pgrUseCase.complaintSearchLimit;

    if (serviceWrappers.length < complaintLimit)
      complaintLimit = serviceWrappers.length;
    var count = 0;

    for (let serviceWrapper of serviceWrappers) {
      if (count < complaintLimit) {
        let mobileNumber = serviceWrapper.service.citizen.mobileNumber;
        let serviceRequestId = serviceWrapper.service.serviceRequestId;
        let complaintURL = await this.makeCitizenURLForComplaint(
          serviceRequestId,
          mobileNumber
        );
        let serviceCode = localisationService.getMessageBundleForCode(
          localisationPrefix + serviceWrapper.service.serviceCode.toUpperCase()
        );
        let filedDate = serviceWrapper.service.auditDetails.createdTime;
        filedDate = moment(filedDate)
          .tz(config.timeZone)
          .format(config.dateFormat);
        let applicationStatus = localisationService.getMessageBundleForCode(
          serviceWrapper.service.applicationStatus
        );
        var data = {
          complaintType: dialog.get_message(serviceCode, locale),
          complaintNumber: serviceRequestId,
          filedDate: filedDate,
          complaintStatus: dialog.get_message(applicationStatus, locale),
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
    requestBody["service"]["address"]["locality"]["code"] = locality;
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
        let filestoreId = await this.getFileForFileStoreId(slots.image, city);
        var content = {
          documentType: "PHOTO",
          filestoreId: filestoreId,
        };
        requestBody["workflow"]["verificationDocuments"].push(content);
      } catch (error) {
      }
    }

    // Handle image upload from extraInfo.fileStoreId (new flow)
    if (extraInfo && extraInfo.fileStoreId) {
      try {
        let filestoreId = await this.getFileForFileStoreId(extraInfo.fileStoreId, city);
        var content = {
          documentType: "PHOTO",
          filestoreId: filestoreId,
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
      console.error("Error in creating the complaint, status:", response.status);
      const errorText = await response.text();
      console.error("Error response body:", errorText);
      return undefined;
    }
    return results[0];
  }

  async fetchOpenComplaints(user) {
    let requestBody = {
      RequestInfo: {
        authToken: user.authToken,
      },
    };

    var url =
      config.egovServices.egovServicesHost +
      config.egovServices.pgrSearchEndpoint;
    url = url + "?tenantId=" + config.rootTenantId;
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
      console.error("Error in fetching the complaints");
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
    let url =
      config.egovServices.externalHost +
      "citizen/otpLogin?mobileNo=" +
      mobileNumber +
      "&redirectTo=digit-ui/citizen/pgr/complaints/" +
      encodedPath;
    let shortURL = await this.getShortenedURL(url);
    return shortURL;
  }

  async downloadImage(url, filename) {
      // Fix: Validate filename before creating WriteStream
  if (!filename || filename.trim() === '') {
    const timestamp = Date.now();
    filename = `pgr_download_${timestamp}.jpg`;
    console.warn(`Empty filename detected in PGR, using fallback: ${filename}`);
  }
  
  filename = filename.toString().trim();
  if (filename === '') {
    filename = `pgr_fallback_${Date.now()}.jpg`;
    console.warn(`Invalid filename after processing in PGR, using: ${filename}`);
  }
  
  console.log("PGR downloadImage - Using filename:", filename);
  
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
