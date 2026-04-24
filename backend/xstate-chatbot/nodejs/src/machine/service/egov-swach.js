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

let swachCreateRequestBody =
  '{"RequestInfo": {"apiId": "Rainmaker", "authToken":"", "userInfo":{}, "msgId":"", "plainAccessRequest": {}},"service":{"tenantId":"","serviceCode":"","description":"","accountId":"","source":"whatsapp","address":{"landmark":"","city":"","geoLocation":{"latitude": null, "longitude": null},"locality":{"code":""}}},"workflow":{"action":"APPLY","verificationDocuments":[]}}';

let swachSearchRequestBody =
  '{"RequestInfo": {"apiId": "Rainmaker", "authToken":"", "userInfo":{}, "msgId":"", "plainAccessRequest": {}}}';

let attendanceRequestBody =
  '{"RequestInfo": {"apiId": "Rainmaker", "authToken":"", "userInfo":{}, "msgId":"", "plainAccessRequest": {}},"ImageData":{"tenantId":"","useruuid":"","latitude":"","longitude":"","locality":"","imagerurl":""}}'


class SwachService {
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

    try{
      let response = await fetch(url, options);
      let data = await response.json(); 
      if(!data || !data["MdmsRes"] || !data["MdmsRes"][moduleName] || !data["MdmsRes"][moduleName][masterName]){
        console.error("Error in fetching MDMS data ----- ", data);
        return undefined;
      }
      return data["MdmsRes"][moduleName][masterName];
    }catch(error){
      console.error("Error in fetching MDMS data ----- ", error);
      return undefined;
    }
  }

  async fetchSwachFrequentComplaints(tenantId) {
    //
    let complaintTypeMdmsData = await this.fetchMdmsData(
      tenantId,
      "SwachReform",
      "SwachBharatCategory",
      "$.[?(@.order && @.active == true)]"
    );
    if(complaintTypeMdmsData == undefined){
      console.error("Error in fetching SwachFrequentComplaints data ----- ", complaintTypeMdmsData);
      return {complaintTypes: [], messageBundle: {}};
    }
    let sortedData = complaintTypeMdmsData
      .slice()
      .sort((a, b) => a.order - b.order);
    let complaintTypes = [];
    for (let data of sortedData) {
      if (!complaintTypes.includes(data.serviceCode))
        complaintTypes.push(data.serviceCode);
    }
    // let localisationPrefix = "SERVICEDEFS.";    //need review
    let localisationPrefix = "SWACHBHARATCATEGORY.";
    let messageBundle = {};
    for (let complaintType of complaintTypes) {
      let message = localisationService.getMessageBundleForCode(
        localisationPrefix + complaintType.toUpperCase()
      );

      messageBundle[complaintType] = message;
    }
    return { complaintTypes, messageBundle };
  }

  async fetchSwachComplaintCategories(tenantId) {
    // fetchs all the menupath of swach-complaint-category object from MDMS
    let complaintCategories = await this.fetchMdmsData(
      tenantId,
      "SwachReform",
      "SwachBharatCategory",
      "$.[?(@.active == true)].menuPath"
    );
    if(complaintCategories == undefined){
      console.error("Error in fetching SwachComplaintCategories data ----- ", complaintCategories);
      return {complaintCategories: [], messageBundle: {}};
    }
    complaintCategories = [...new Set(complaintCategories)];
    complaintCategories = complaintCategories.filter(
      (complaintCategory) => complaintCategory != ""
    ); // To remove any empty category
    // let localisationPrefix = "SERVICEDEFS.";    //need review
    let localisationPrefix = "SWACHBHARATCATEGORY.";
    let messageBundle = {};
    for (let complaintCategory of complaintCategories) {
      let message = localisationService.getMessageBundleForCode(
        localisationPrefix + complaintCategory.toUpperCase()
      );

      messageBundle[complaintCategory] = message;
    }
    return { complaintCategories, messageBundle };
  }

  async fetchSwatchComplaintItemsForCategory( tenantId) {
    // fetchs all the serviceCode under the selected menupath of complaint-categoy
    let complaintItems = await this.fetchMdmsData(
      tenantId,
      "SwachReform",
      "SwachBharatCategory",
      // '$.[?(@.active == true && @.menuPath == "' + category + '")].serviceCode'
      '$.[?(@.active == true && @.menuPath == "' + "SwachCategory" + '")].serviceCode'
    );
    if(complaintItems == undefined){
      console.error("Error in fetching SwachComplaintItems data ----- ", complaintItems);
      return {complaintItems: [], messageBundle: {}};
    }
    // let localisationPrefix = "SERVICEDEFS.";    //need review
    let localisationPrefix = "SWACHBHARATCATEGORY.";
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
    console.log("latlng", latlng);
    try{
      let cityAndLocality = await getCityAndLocality(latlng);
      console.log("cityAndLocality", cityAndLocality);
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
        // console.log("matchedCity", matchedCity);
        let { localities, messageBundle } = await this.fetchLocalities(
          matchedCity
        );
        // console.log("messageBundle", messageBundle);
        // console.log("localities", localities);
        for (let locality of localities) {
          let localityName = messageBundle[locality]["en_IN"];
          // console.log("localityName", localityName);
          if (
            localityName?.toLowerCase() == cityAndLocality.locality.toLowerCase()
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
    } catch(error){
      console.error("Error in fetching city and locality for geocode ----- ", error);
      return undefined;
    }
  } //

  async fetchCitiesAndWebpageLink(tenantId, whatsAppBusinessNumber) {
    try{
      let { cities, messageBundle } = await this.fetchCities(tenantId);
      let link = await this.getCityExternalWebpageLink(
        tenantId,
        whatsAppBusinessNumber
      );
      if(!link){
        console.error("Error in fetching the city external webpage link ----- ", link);
        return { cities, messageBundle, link: "" };
      }
      if(!cities || cities.length == 0){
        console.error("Error in fetching cities data ----- ", cities);
        return { cities: [], messageBundle: {}, link: "" };
      }
      if(!messageBundle || Object.keys(messageBundle).length == 0){
        console.error("Error in fetching message bundle data ----- ", messageBundle);
        return { cities: [], messageBundle: {}, link: "" };
      }
      return { cities, messageBundle, link };
    }catch(error){
      console.error("Error in fetching cities and webpage link ----- ", error);
      return { cities: [], messageBundle: {}, link: "" };
    }
  }

  async fetchCities(tenantId) {
    let cities = await this.fetchMdmsData(
      tenantId,
      "tenant",
      "citymodule",
      "$.[?(@.module=='SWACH.WHATSAPP')].tenants.*.code"
    );
    if(cities == undefined){
      console.error("Error in fetching cities data ----- ", cities);
      return {cities: [], messageBundle: {}};
    }
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
    if(!shorturl){
      console.error("Error in fetching the shortened URL ----- ", shorturl);
      return undefined;
    }
    return shorturl;
  }

  async fetchLocalitiesAndWebpageLink(tenantId, whatsAppBusinessNumber) {
    let { localities, messageBundle } = await this.fetchLocalities(tenantId);
    let link = await this.getLocalityExternalWebpageLink(
      tenantId,
      whatsAppBusinessNumber
    );
    if(!link){
      console.error("Error in fetching the locality external webpage link ----- ", link);
      return { localities, messageBundle, link: "" };
    }
    if(!localities || localities.length == 0){
      console.error("Error in fetching localities data ----- ", localities);
      return { localities: [], messageBundle: {}, link: "" };
    }
    if(!messageBundle || Object.keys(messageBundle).length == 0){
      console.error("Error in fetching message bundle data ----- ", messageBundle);
      return { localities: [], messageBundle: {}, link: "" };
    }
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
    if(!shorturl){
      console.error("Error in fetching the shortened URL ----- ", shorturl);
      return undefined;
    }
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
    if(boundaryData == undefined){
      console.error("Error in fetching localities data ----- ", boundaryData);
      return {localities: [], messageBundle: {}};
    }
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
      config.egovServices.egovServicesHost +
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
    // console.log("Get City Response ----- ", response);

    let predictedCity = null;
    let predictedCityCode = null;
    let isCityDataMatch = false;
    if (response.status === 200) {
      let responseBody = await response.json();
      if (responseBody.match == 0)
        return { predictedCityCode, predictedCity, isCityDataMatch };
      else {
        predictedCityCode = responseBody.city_detected[0];
        predictedCityCode = predictedCityCode.split(" ");
        predictedCityCode = predictedCityCode.join("");
        // console.log("predictedCityCode", predictedCityCode);
        let localisationMessages =await localisationService.getMessageBundleForCode(predictedCityCode);
          // console.log("localisationMessages",localisationMessages)
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
      console.error("Error in fetching the city");
      return { predictedCityCode, predictedCity, isCityDataMatch };
    }
  } catch(error){
    console.error("Error in fetching the city ----- ", error);
    return { predictedCityCode: null, predictedCity: null, isCityDataMatch: false };
  }
}

  async getLocality(input, city, locale, tenantId) {
    var url =
      config.egovServices.egovServicesHost +
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

    try{let response = await fetch(url, options);

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
      console.error("Error in fetching the locality");
      return { predictedLocalityCode, predictedLocality, isLocalityDataMatch };
    }}catch(error){
      console.error("Error in fetching the locality ----- ", error);
      return { predictedLocalityCode: null, predictedLocality: null, isLocalityDataMatch: false };
    }
  }

  async prepareSwachResult(responseBody, locale) {
    let serviceWrappers = responseBody.ServiceWrappers;
    var results = {};
    results["ServiceWrappers"] = [];
    // let localisationPrefix = "SERVICEDEFS.";    //need review
    let localisationPrefix = "SWACHBHARATCATEGORY.";

    let complaintLimit = config.swachUseCase.complaintSearchLimit; //need review

    if (serviceWrappers.length < complaintLimit)
      complaintLimit = serviceWrappers.length;
    var count = 0;

    try{for (let serviceWrapper of serviceWrappers) {
      if (count < complaintLimit) {
        let mobileNumber = serviceWrapper.service.citizen.mobileNumber;
        let serviceRequestId = serviceWrapper.service.serviceRequestId;
        let complaintURL = await this.makeCitizenURLForComplaint(
          serviceRequestId,
          mobileNumber
        );
        let serviceCode = localisationService.getMessageBundleForCode(    // issue is here
          localisationPrefix + serviceWrapper.service.serviceCode.toUpperCase()
        );
        let filedDate = serviceWrapper.service.auditDetails.createdTime;
        filedDate = moment(filedDate)
          .tz(config.timeZone)
          .format(config.dateFormat);
        let applicationStatus = localisationService.getMessageBundleForCode(
          serviceWrapper.service.applicationStatus
        );

        // console.log("applicationStatus ----- ", JSON.stringify(serviceWrapper.service.applicationStatus));

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
    }}catch(error){
      console.error("Error in preparing the swach result ----- ", error);
      results["ServiceWrappers"] = [];
      return results["ServiceWrappers"];
    }
    return results["ServiceWrappers"];
  }

  async persistSwachComplaint(user, slots, extraInfo) {
    let requestBody = JSON.parse(swachCreateRequestBody);

    

    let authToken = user.authToken;
    let userId = user.userId;
    let complaintType = slots.complaint;
    // let locality = slots.locality;
    let locality = {
      code: slots.locality,
      name: slots.predictedLocality,
    };
    let city = slots.city;
    let userInfo = user.userInfo;
    let description = slots.description;

    

    requestBody["RequestInfo"]["authToken"] = authToken;
    requestBody["service"]["tenantId"] = city;
    requestBody["service"]["address"]["city"] = city;
    requestBody["service"]["address"]["locality"] = locality;
    requestBody["service"]["serviceCode"] = complaintType;
    requestBody["service"]["accountId"] = userId;
    requestBody["service"]["description"] = description;
    requestBody["RequestInfo"]["userInfo"] = userInfo;
    requestBody["RequestInfo"]["msgId"] = config.msgId + "|" + user.locale;

    if (slots.geocode) {
      let latlng = slots.geocode.substring(1, slots.geocode.length - 1);
      latlng = latlng.split(",");
      requestBody["service"]["address"]["geoLocation"]["latitude"] = latlng[0];
      requestBody["service"]["address"]["geoLocation"]["longitude"] = latlng[1];
    }

    if (slots.image) {
      // console.log("Request Body before mutation ----- ", requestBody);
      let filestoreId = await this.getFileForFileStoreId(slots.image, city);
      // console.log("FileStore ID ----- outside if block", filestoreId);
      if(!filestoreId){
        console.error("Error in getting file store ID");
      }else{
      // console.log("FileStore ID ----- ", filestoreId);
      var content = {
        documentType: "PHOTO",
        filestoreId: filestoreId,
      };
      requestBody["workflow"]["verificationDocuments"].push(content);
      }
    }

    var url =
      config.egovServices.egovServicesHost +
      config.egovServices.swachCreateEndpoint +
      "?tenantId=" +
      city;

    var options = {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers: {
        "Content-Type": "application/json",
      },
    };

    // console.log("Persist Swach Complaint URL ----- ", url);
    // console.log(
    //   "Persist Swach Complaint Request Body ----- ",
    //   JSON.stringify(requestBody)
    // );

    try{let response = await fetch(url, options);

    // console.log("persistSwachComplaint response ----- ", response);

    let results;
    if (response.status === 200) {
      let responseBody = await response.json();
      results = await this.prepareSwachResult(responseBody, user.locale);
    } else {
      console.error("Error in fetching the complaints");
      return undefined;
    }
    return results[0];}
    catch(error){
      console.error("Error in persisting the complaint ----- ", error);
      return undefined;
    }
  }
  async fetchOpenSwachComplaints(user) {
    let requestBody = JSON.parse(swachSearchRequestBody);

    requestBody["RequestInfo"]["authToken"] = user.authToken;
    requestBody["RequestInfo"]["userInfo"] = user.userInfo;
    requestBody["RequestInfo"]["msgId"] = config.msgId + "|" + user.locale;

    // let requestBody = {
    //   RequestInfo: {
    //     authToken: user.authToken,
    //   },
    // };

    var url =
      config.egovServices.egovServicesHost +
      config.egovServices.swachSearchEndpoint;
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

    try{let results;
    if (response.status === 200) {
      let responseBody = await response.json();
      results = await this.prepareSwachResult(responseBody, user.locale);
    } else {
      console.error("Error in fetching the complaints");
      return [];
    }
    return results;}
    catch(error){
      console.error("Error in fetching the complaints ----- ", error);
      return undefined;
    }
  }

  async persistAttendence(user, slots, attendance, extraInfo) {
    // console.log("Persist Attendence ----- ", attendance);
    let requestBody = JSON.parse(attendanceRequestBody);
    

    let authToken = user.authToken;
    let userId = user.userId;
    let locality = slots.locality;
    let city = slots.city;
    let userInfo = user.userInfo;
    let geocode = slots.geocode;
    let latitude = geocode.substring(1, geocode.length - 1).split(",")[0];
    let longitude = geocode.substring(1, geocode.length - 1).split(",")[1];

    // console.log("Persist Attendence ----- ", slots);
    

    requestBody["RequestInfo"]["authToken"] = authToken;
    requestBody["RequestInfo"]["userInfo"] = userInfo;
    requestBody["RequestInfo"]["msgId"] = config.msgId + "|" + user.locale;
    requestBody["ImageData"]["tenantId"] = city;
    requestBody["ImageData"]["locality"] = locality;
    requestBody["ImageData"]["useruuid"] = userInfo.uuid;
    // requestBody["ImageData"]["latitude"] = attendance.metadata.latitude;
    // requestBody["ImageData"]["longitude"] = attendance.metadata.longitude;
    requestBody["ImageData"]["latitude"] = latitude;
    requestBody["ImageData"]["longitude"] = longitude;
    // requestBody["ImageData"]["imagerurl"] = attendance.image;

    try{let filestoreId = await this.getFileForFileStoreId(attendance.image, city);
    if(!filestoreId){
      console.error("Error in getting file store ID");
    }else{
    // console.log("FileStore ID ----- ", filestoreId);
      requestBody["ImageData"]["imagerurl"] = filestoreId;
    }}
    catch(error){
      console.error("Error in getting file store ID ----- ", error);
    }

    // console.log("Persist Attendence request ----- ", JSON.stringify(requestBody));

    var url =
      config.egovServices.egovServicesHost +
      config.egovServices.attendanceEndpoint;

    // console.log("Persist Attendence URL ----- ", url);

    var options = {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers: {
        "Content-Type": "application/json",
      },
    };

    try{let response = await fetch(url, options);
    // console.log("Persist Attendence Response ----- ", response);
    if (response.status === 200) {
      let responseBody = await response.json();
      return responseBody;
    } else {
      console.error("Error in persisting the attendence");
      return undefined;
    }}catch(error){
      console.error("Error in persisting the attendence ----- ", error);
      return undefined;
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
    try{
      let response = await fetch(url, options);
      if (response.status !== 200) {
        console.error("Error in fetching the shortened URL ----- ", response);
        return undefined;
      }
      let data = await response.text();
      return data;
    }catch(error){
      console.error("Error in fetching the shortened URL ----- ", error);
      return undefined;
    }
  }

  async makeCitizenURLForComplaint(serviceRequestId, mobileNumber) {
    let encodedPath = urlencode(serviceRequestId, "utf8");
    let url =
      config.egovServices.externalHost +
      "citizen/otpLogin?mobileNo=" +
      mobileNumber +
      "&redirectTo=digit-ui/citizen/swach/complaints/" +
      encodedPath +
      "&channel=whatsapp&tag=complaintTrack";
    try{let shortURL = await this.getShortenedURL(url);
    return shortURL;}
    catch(error){
      console.error("Error in fetching the shortened URL ----- ", error);
      return "";
    }
  }

  async downloadImage(url, filename) {
    const writer = fs.createWriteStream(filename);

    try{const response = await axios({
      url,
      method: "GET",
      responseType: "stream",
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });}catch(error){
      console.error("Error in downloading the image ----- ", error);
      return undefined;
    }
  }

  async fileStoreAPICall(fileName, fileData, tenantId) {
    try {
    // console.log("File Store API Call ----- ", fileName, fileData, tenantId);
    var url =
      config.egovServices.egovServicesHost +
      config.egovServices.egovFilestoreServiceUploadEndpoint;
    url = url + "&tenantId=" + tenantId;

    // console.log("url", url);
    var form = new FormData();
    form.append("file", fileData, {
      filename: fileName,
      contentType: "image/jpg",
    });
    // console.log("File Store API Call ----- form ", form);
    let response = await axios.post(url, form, {
      headers: {
        ...form.getHeaders(),
      },
    }); // API Causing Persistance issue

    // console.log("File Store API Response ----- ", response);

    var filestore = response.data;
    return filestore["files"][0]["fileStoreId"];
  } catch (error) {
    console.error("Error in File Store API Call ----- ", error);
    return undefined;
    // throw error;
    }
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

    try{let response = await fetch(url, options);
    response = await response.json();
    var fileURL = response["fileStoreIds"][0]["url"].split(",");
   // var fileName = geturl.parse(fileURL[0]);
   // fileName = path.basename(fileName.pathname);
   // fileName = fileName.substring(13);
      const urlObj = new URL(fileURL);
      const filePath = decodeURIComponent(urlObj.searchParams.get("name"));
      const fileName = path.basename(filePath);
      //console.log("fileNamefdfdfdfd",fileName)
    await this.downloadImage(fileURL[0].toString(), fileName);
    // console.log("Called Here");
    let imageInBase64String = fs.readFileSync(fileName, "base64");
    imageInBase64String = imageInBase64String.replace(/ /g, "+");
    let fileData = Buffer.from(imageInBase64String, "base64");
    // console.log("Get File For File Store ID Response ----- ", imageInBase64String);
    var filestoreId = await this.fileStoreAPICall(fileName, fileData, tenantId);
    fs.unlinkSync(fileName);
    if(!filestoreId){
      console.error("Error in getting file store ID");
      return undefined;
    }
    return filestoreId;}
    catch(error){
      console.error("Error in getting file store ID ----- ", error);
      return undefined;
    }
  }
}

module.exports = new SwachService();
