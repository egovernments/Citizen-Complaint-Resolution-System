const config = require('../../env-variables');
const fetch = require("node-fetch");
const moment = require("moment-timezone");
const localisationService = require('../util/localisation-service');
const dialog = require('../util/dialog');

let supportedServiceForLocality = "{\"TL\" : \"tl-services\",\"FIRENOC\" : \"fireNoc\",\"WS\" : \"ws-services\",\"SW\" : \"sw-services\",\"PT\" : \"PT\",\"BPA\" : \"bpa-services\"}";

class BillService {

  constructor() {
    this.services = [];
    let supportedModules = config.billsAndReceiptsUseCase.billSupportedModules.split(',');
    for(let module of supportedModules) {
      this.services.push(module.trim());
    }
  }

  getSupportedServicesAndMessageBundle() {
    let services = this.services;
    let messageBundle = {
      WS: {
        en_IN: 'Water and Sewerage',
        hi_IN: 'पानी और सीवरेज',
        pa_IN: 'ਪਾਣੀ ਅਤੇ ਸੀਵਰੇਜ'
      },
      PT: {
        en_IN: 'Property Tax',
        hi_IN: 'संपत्ति कर',
        pa_IN: 'ਜਾਇਦਾਦ ਟੈਕਸ'
      },
      TL: {
        en_IN: 'Trade License Fees',
        hi_IN: 'ट्रेड लाइसेंस शुल्क'
      },
      FIRENOC: {
        en_IN: 'Fire NOC Fees',
        hi_IN: 'फायर एनओसी फीस'
      },
      BPA: {
        en_IN: 'Building Plan Scrutiny Fees',
        hi_IN: 'बिल्डिंग प्लान स्क्रूटनी फीस'
      }
    }
    
    return { services, messageBundle };
  }
  

  getSearchOptionsAndMessageBundleForService(service) {
    let messageBundle = {
      mobile: {
        en_IN: 'Search 🔎 using Mobile No.📱',
        hi_IN: 'मोबाइल नंबर 📱का उपयोग करके 🔎खोजें'
      },
      connectionNumber: {
        en_IN: 'Search 🔎 using Connection No.',
        hi_IN: 'कनेक्शन नंबर का उपयोग करके 🔎 खोजें'
      },
      consumerNumber: {
        en_IN: 'Search 🔎 using Consumer Number',
        hi_IN: 'उपभोक्ता नंबर का उपयोग करके 🔎 खोजें'

      },
      propertyId: {
        en_IN: 'Search 🔎 using Property ID',
        hi_IN: 'संपत्ति आईडी का उपयोग करके 🔎 खोजें'

      },
      tlApplicationNumber: {
        en_IN: 'Search 🔎 using Trade License Application Number',
        hi_IN: 'ट्रेड लाइसेंस आवेदन संख्या का उपयोग करके 🔎 खोजें'
      },
      nocApplicationNumber: {
        en_IN: 'Search 🔎 using NOC Application Number',
        hi_IN: 'एनओसी आवेदन संख्या का उपयोग करके 🔎 खोजें'
      },
      bpaApplicationNumber: {
        en_IN: 'Search 🔎 using BPA Application Number',
        hi_IN: 'बिल्डिंग प्लान आवेदन संख्या का उपयोग करके 🔎खोजें'
      }
    }
    let searchOptions = [];
    if(service === 'WS') {
      searchOptions = [ 'connectionNumber'];
    } else if(service === 'PT') {
      searchOptions = [ 'propertyId'];
    } else if(service === 'TL') {
      searchOptions = [ 'tlApplicationNumber' ];
    } else if(service === 'FIRENOC') {
      searchOptions = [ 'nocApplicationNumber' ];
    } else if(service === 'BPA') {
      searchOptions = [ 'bpaApplicationNumber' ];
    }

    return { searchOptions, messageBundle };
  }

  getOptionAndExampleMessageBundle(service, searchParamOption) {
    let option,example;

    if(searchParamOption === 'mobile'){
      option = {
        en_IN: 'Mobile Number',
        hi_IN: 'मोबाइल नंबर'
      };
      example = {
        en_IN: 'Do not use +91 or 0 before mobile number.',
        hi_IN: 'मोबाइल नंबर से पहले +91 या 0 का उपयोग न करें।'
      }
    }

    if(searchParamOption === 'consumerNumber'){
      option = {
        en_IN: 'Consumer Number',
        hi_IN: 'उपभोक्ता संख्या'
      };
      example = {
        en_IN: ' ',
        hi_IN: ' '
      }
    }

    if(searchParamOption === 'connectionNumber'){
      option = {
        en_IN: 'Connection No',
        hi_IN: 'कनेक्शन नंबर'
      };
      example = {
       en_IN: '(Connection Number must be in format\nXXXXXXXXXX OR WS/XXXX/YYYY-YY/XXXXXX)',
       hi_IN: '(कनेक्शन नंबर nXXXXXXXXXX OR WS/XXXX/YYYY-YY/XXXXXX प्रारूप में होना चाहिए)'
      }
    }

    if(searchParamOption === 'propertyId'){
      option = {
        en_IN: 'Property ID',
        hi_IN: 'संपत्ति आईडी'
      };
      example = {
       en_IN: '(Property ID must be in format\nPG-PT-xxxx-xxxxxx)',
       hi_IN: '(संपत्ति आईडी\nPG-PT-xxxx-xxxxxx प्रारूप में होनी चाहिए)',
       pa_IN: '(ਪ੍ਰਾਪਰਟੀ ID ਫਾਰਮੈਟ\nPG-PT-xxxx-xxxxxx ਵਿੱਚ ਹੋਣੀ ਚਾਹੀਦੀ ਹੈ)'
      }
    }

    if(searchParamOption === 'tlApplicationNumber'){
      option = {
        en_IN: 'Trade License Application Number',
        hi_IN: 'ट्रेड लाइसेंस आवेदन संख्या'
      };
      example = {
       en_IN: ' ',
       hi_IN: ' '
      }
    }

    if(searchParamOption === 'nocApplicationNumber'){
      option = {
        en_IN: 'Fire Noc Application Number',
        hi_IN: 'फायर एनओसी एप्लीकेशन नंबर'
      };
      example = {
       en_IN: ' ',
       hi_IN: ' '
      }
    }

    if(searchParamOption === 'bpaApplicationNumber'){
      option = {
        en_IN: 'BPA Application Number',
        hi_IN: 'बिल्डिंग प्लान आवेदन संख्या'
      };
      example = {
       en_IN: ' ',
       hi_IN: ' '
      }
    }

    
    return { option, example };
  }

  validateParamInput(service, searchParamOption, paramInput) {
    var state=config.rootTenantId;
    state=state.toUpperCase();
    
    console.log(`Validating ${searchParamOption} for service ${service}: ${paramInput}`);

    if(searchParamOption === 'mobile') {
      let regexp = new RegExp('^[0-9]{10}$');
      let isValid = regexp.test(paramInput);
      console.log(`Mobile validation result: ${isValid}`);
      return isValid;
    }

    if(searchParamOption === 'consumerNumber' || searchParamOption === 'propertyId' || searchParamOption === 'connectionNumber'){
        if(service === 'PT'){
          // Enable PT validation for debugging
          let regexp = new RegExp('^' + state + '-PT-\\d{4}-\\d{2}-\\d{2}-\\d+$');
          let isValid = regexp.test(paramInput);
          console.log(`Regex pattern: ^${state}-PT-\\d{4}-\\d{2}-\\d{2}-\\d+$`);
          return isValid;
        }
        if(service === 'WS'){
          //todo
          let regexp = new RegExp('^WS/\\d{4}/\\d{4}-\\d{2}/\\d+$');
          let isValid = regexp.test(paramInput);
          console.log(`WS Connection validation result: ${isValid}`);
          return isValid;
        }
    }
    

    if(searchParamOption === 'tlApplicationNumber'){
        let regexp = new RegExp(state+'-TL-\\d{4}-\\d{2}-\\d{2}-\\d+$');
        return regexp.test(paramInput);
    }

    if(searchParamOption === 'nocApplicationNumber'){
      let regexp = new RegExp(state+'-FN-\\d{4}-\\d{2}-\\d{2}-\\d+$');
      return regexp.test(paramInput);
    }

    if(searchParamOption === 'bpaApplicationNumber'){
      let regexp = new RegExp(state+'-BP-\\d{4}-\\d{2}-\\d{2}-\\d+$');
      return regexp.test(paramInput);
    }
    console.log(`Validation defaulted to true for ${searchParamOption} in service ${service}`);
    return true;
  }


  async prepareBillResult(responseBody, user){
    let locale = user.locale;
    let results=responseBody.Bill;
    let billLimit = config.billsAndReceiptsUseCase.billSearchLimit;

    if(results.length < billLimit)
      billLimit = results.length;

    var Bills = {};
    Bills['Bills'] = [];
    var count =0;
    var tenantIdList=[];
    var consumerCodeList = [];
    let localisationServicePrefix = "BILLINGSERVICE_BUSINESSSERVICE_"

    let self = this;
    for(let result of results){
      if(result.status=='ACTIVE' && result.totalAmount!=0 && count<billLimit){
        let dueDate = moment(result.billDetails[result.billDetails.length-1].expiryDate).tz(config.timeZone).format(config.dateFormat);
        let fromMonth = new Date(result.billDetails[result.billDetails.length-1].fromPeriod).toLocaleString('en-IN', { month: 'short' });
        let toMonth = new Date(result.billDetails[result.billDetails.length-1].toPeriod).toLocaleDateString('en-IN', { month: 'short' });
        let fromBillYear = new Date(result.billDetails[result.billDetails.length-1].fromPeriod).getFullYear();
        let toBillYear = new Date(result.billDetails[result.billDetails.length-1].toPeriod).getFullYear();
        let billPeriod = fromMonth+" "+fromBillYear+"-"+toMonth+" "+toBillYear;
        let tenantId= result.tenantId;
        let link = await self.getPaymentLink(result.consumerCode,tenantId,result.businessService,locale, user);
        let serviceCode = localisationService.getMessageBundleForCode(localisationServicePrefix + result.businessService.toUpperCase());

        var data={
          service: dialog.get_message(serviceCode,locale),
          id: result.consumerCode,
          payerName: result.payerName,
          secondaryInfo: 'Ajit Nagar,  Phagwara', //to do
          dueAmount: result.totalAmount,
          dueDate: dueDate,
          period: billPeriod,
          tenantId: tenantId,
          paymentLink: link,
          businessService: result.businessService
        };
        
        /*tenantId = "TENANT_TENANTS_" + tenantId.toUpperCase().replace('.','_');
        if(!tenantIdList.includes(tenantId))
          tenantIdList.push(tenantId);

        consumerCodeList.push(result.consumerCode);*/

        Bills['Bills'].push(data);
        count = count + 1;
      } 
    }
    

    if(Bills['Bills'].length>0){
      var stateLevelCode = "TENANT_TENANTS_"+config.rootTenantId.toUpperCase();
      var businessService = Bills['Bills'][0].businessService;
      tenantIdList.push(stateLevelCode);
      var businessServiceList = ['WS','SW'];
      let cosumerCodeToLocalityMap;
    
      if(businessServiceList.includes(businessService))
        cosumerCodeToLocalityMap = await this.getApplicationNumber(Bills['Bills'], businessService, user.authToken, locale, user);
    
      else
        cosumerCodeToLocalityMap = await this.getLocality(consumerCodeList, user.authToken, businessService, locale, user);
    
      let localisedMessages = await localisationService.getMessagesForCodesAndTenantId(tenantIdList, config.rootTenantId);

      for(var i=0;i<Bills['Bills'].length;i++){

        if( !(Object.keys(cosumerCodeToLocalityMap).length === 0) && cosumerCodeToLocalityMap[Bills['Bills'][i].id]){
          let tenantIdCode = "TENANT_TENANTS_" + Bills['Bills'][i].tenantId.toUpperCase().replace('.','_');
          Bills['Bills'][i].secondaryInfo = cosumerCodeToLocalityMap[Bills['Bills'][i].id] + ", " + localisedMessages[tenantIdCode][locale];

        }      
        else{
          let tenantIdCode = "TENANT_TENANTS_" + Bills['Bills'][i].tenantId.toUpperCase().replace('.','_');
          Bills['Bills'][i].secondaryInfo = localisedMessages[tenantIdCode][locale] + ", " + localisedMessages[stateLevelCode][locale];
        }
      }

    }
    
    return Bills['Bills'];  
  }

  async searchBillsForUser(user) {
    // Try with user auth token first, fallback to system auth if needed
    let authToken = user.authToken;
    let userInfo = user.userInfo;
    
    // If no valid user auth, try to create a system user auth token
    if (!authToken || !userInfo) {
      console.log("User auth not available, attempting system authentication for bill search");
      try {
        const systemAuth = await this.getSystemAuthToken();
        if (systemAuth) {
          authToken = systemAuth.authToken;
          userInfo = systemAuth.userInfo;
          console.log("Using system authentication for bill search");
        }
      } catch (error) {
        console.log("System auth failed, using fallback userInfo:", error.message);
      }
    }

    let requestBody = {
      RequestInfo: {
        authToken: authToken,
        userInfo: userInfo || {
          id: 1,
          uuid: "dummy-uuid",
          userName: user.mobileNumber,
          name: user.name || "Anonymous",
          mobileNumber: user.mobileNumber,
          emailId: "",
          locale: user.locale || "en_IN",
          type: "CITIZEN",
          roles: [{
            code: "CITIZEN",
            name: "Citizen"
          }],
          active: true,
          tenantId: config.rootTenantId
        }
      }
    };

    let billUrl = config.egovServices.egovServicesHost + config.egovServices.billServiceSearchPath;
    billUrl = billUrl + '?tenantId=' + config.rootTenantId;
    

    if(user.hasOwnProperty('paramOption') && (user.paramOption!=null) ){
      if(user.paramOption=='mobile')
        billUrl +='&mobileNumber='+user.paramInput;

      if(user.paramOption=='consumerNumber' || user.paramOption == 'tlApplicationNumber' || user.paramOption == 'nocApplicationNumber'
      || user.paramOption=='bpaApplicationNumber' || user.paramOption=='connectionNumber' || user.paramOption=='propertyId')
        billUrl +='&consumerCode='+user.paramInput;

      billUrl +='&businessService='+user.service;
    }
    else{
      billUrl+='&';
      billUrl +='mobileNumber='+user.mobileNumber;
    }

    let options = {
      method: 'POST',
      origin: '*',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    }
    
    let response = await fetch(billUrl, options);
    let results,totalBillSize=0,pendingBillSize=0;
    
    if(response.status === 201) {
      let responseBody = await response.json();
      results = await this.prepareBillResult(responseBody, user);
      totalBillSize=responseBody.Bill.length;
      pendingBillSize=results.length;
      
    } else {
      let errorBody = await response.json();
      console.error('Error in fetching bills - Status:', response.status);
      return undefined;
    }
    
    if(totalBillSize==0){
      return {                        
        totalBills: 0,             // Property ID not found or no bills linked
        pendingBills: undefined,
        billsExist: false          // NEW: Indicates no bills found at all
      }
    }
    else if(pendingBillSize==0){
      return {
        totalBills: totalBillSize,  // Return actual count of bills found
        pendingBills: undefined,    // No pending bills
        billsExist: true           // NEW: Indicates bills exist but are paid/zero
      } 
    }
    else{
      return {
        pendingBills: results,      // Pending bills exist
        totalBills: pendingBillSize,
        billsExist: true           // NEW: Bills exist with pending amounts
      }
    }


  }

  async fetchBillsForUser(user,service){
    let billSupportedBussinessService;

    if(service){
      if(service === 'WS')
      billSupportedBussinessService = ['WS','SW'];
      if(service === 'PT')
      billSupportedBussinessService = ['PT'];
      if(service === 'BPA')
        billSupportedBussinessService = ['BPA.LOW_RISK_PERMIT_FEE', 'BPA.NC_APP_FEE', 'BPA.NC_SAN_FEE', 'BPA.NC_OC_APP_FEE', 'BPA.NC_OC_SAN_FEE'];
    }
    else
      billSupportedBussinessService = ['WS','SW', 'PT', 'TL', 'FIRENOC', 'BPA.LOW_RISK_PERMIT_FEE', 'BPA.NC_APP_FEE', 'BPA.NC_SAN_FEE', 'BPA.NC_OC_APP_FEE', 'BPA.NC_OC_SAN_FEE'];

    let billResults={
        pendingBills:[],
        totalBills:0
    };

    let self = this;

    for(let service of billSupportedBussinessService){
      user.service = service;

      if(!user.hasOwnProperty('paramOption') || (user.paramOption==null) ){
        user.paramOption = 'mobile';
        user.paramInput = user.mobileNumber;
      }
      let results = await self.searchBillsForUser(user);
      if(results.totalBills !=0 && results.pendingBills){
        billResults.pendingBills = billResults.pendingBills.concat(results.pendingBills);
        billResults.totalBills = billResults.totalBills + results.totalBills;
      }
    }  
    
    if(billResults.totalBills === 0 ||  billResults.pendingBills.length === 0){
      return {                        
        totalBills: 0,
        pendingBills: undefined
      }
      
    }

    let finalResult = [];
    let billLimit = config.billsAndReceiptsUseCase.billSearchLimit;

    if(billResults.pendingBills.length < billLimit)
      billLimit = billResults.pendingBills.length;

    for(var i=0; i<billLimit; i++)
      finalResult = finalResult.concat(billResults.pendingBills[i]); 


      return {
        pendingBills: finalResult,      // Pending bills exist
        totalBills: billLimit
      }
  }

  async fetchBillsForParam(user, service, paramOption, paramInput) {
      user.service=service;
      user.paramOption=paramOption;
      user.paramInput=paramInput;

      let billsForUser;
      if(service === 'WS' || service === 'BPA')
        billsForUser = await this.fetchBillsForUser(user,service);
      else
        billsForUser = await this.searchBillsForUser(user);

      
      // Return the full object with billsExist flag for proper handling
      return billsForUser;
  }
  
  async getShortenedURL(finalPath)
  {
    var url = config.egovServices.egovServicesHost + config.egovServices.urlShortnerEndpoint;
    var request = {};
    request.url = finalPath; 
    var options = {
      method: 'POST',
      body: JSON.stringify(request),
      headers: {
        'Content-Type': 'application/json'
      }
    }
    let response = await fetch(url, options);
    let data = await response.text();
    return data;
  }

  async getPaymentLink(consumerCode,tenantId,businessService,locale, user)
  {
    var UIHost = config.egovServices.externalHost;
    var paymentPath = config.egovServices.msgpaylink;
    paymentPath = paymentPath.replace(/\$consumercode/g,consumerCode);
    paymentPath = paymentPath.replace(/\$tenantId/g,tenantId);
    paymentPath = paymentPath.replace(/\$businessservice/g,businessService);
    paymentPath = paymentPath.replace(/\$redirectNumber/g,"+"+config.whatsAppBusinessNumber);
    paymentPath = paymentPath.replace(/\$locale/g,locale);
    paymentPath = paymentPath.replace(/\$name/g,user.name);
    paymentPath = paymentPath.replace(/\$mobileNumber/g,user.mobileNumber);

    // Use OTP login flow for proper authentication like PGR service
    var finalPath = UIHost + "citizen/otpLogin?mobileNo=" + user.mobileNumber + "&redirectTo=" + encodeURIComponent(paymentPath);
    var link = await this.getShortenedURL(finalPath);
    return link;
  }

  async getLocality(consumerCodes, authToken, businessService, locale, user){

    let supportedService = JSON.parse(supportedServiceForLocality);
    businessService = supportedService[businessService];

    if(!businessService)
      businessService = supportedService["BPA"];
    

    let requestBody = {
      RequestInfo: {
        apiId: "Rainmaker",
        ver: "1.0", 
        ts: Date.now(),
        action: "_search",
        authToken: authToken,
        userInfo: {
          id: user.userInfo?.id || 1,
          uuid: user.userInfo?.uuid || "dummy-uuid", 
          type: "CITIZEN",
          mobileNumber: user.mobileNumber,
          name: user.name
        }
      },
      searchCriteria: {
        referenceNumber: consumerCodes,
        limit: 5000,
        offset: 0
      }
    };

    let locationUrl = config.egovServices.searcherHost + 'egov-searcher/locality/'+businessService+'/_get';

    let options = {
      method: 'POST',
      origin: '*',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    }

    let response = await fetch(locationUrl,options);
    let localitySearchResults;

    if(response.status === 200) {
      localitySearchResults = await response.json();
    } else {
      console.error('Error in fetching the Locality data');
      return undefined;
    }

    let localities = [];
    for(let result of localitySearchResults.Localities){
      if(!localities.includes(result.locality))
        localities.push(result.locality);
    }

    let localitiesLocalisationCodes = [];
    for(let locality of localities) {
      let localisationCode = 'admin.locality.' + locality;
      localitiesLocalisationCodes.push(localisationCode);
    }

    let localisedMessages = await localisationService.getMessagesForCodesAndTenantId(localitiesLocalisationCodes, config.rootTenantId);

    let messageBundle = {};
    for(let result of localitySearchResults.Localities) {
      let localisationCode = 'admin.locality.' + result.locality;
      messageBundle[result.referencenumber] = localisedMessages[localisationCode][locale];
    }

  return messageBundle;

  }

  async getApplicationNumber(Bills, businessService, authToken, locale, user){

    let requestBody = {
      RequestInfo: {
        apiId: "Rainmaker",
        ver: "1.0",
        ts: Date.now(),
        action: "_search",
        authToken: authToken,
        userInfo: {
          id: user.userInfo?.id || 1,
          uuid: user.userInfo?.uuid || "dummy-uuid",
          type: "CITIZEN",
          mobileNumber: user.mobileNumber,
          name: user.name
        }
      }
    };

    let options = {
      method: 'POST',
      origin: '*',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    }

    
    let applicationNumbersList = [];
    let consumerCodeToApplicationMapping={};

    for(let bill of Bills){
      let url = config.egovServices.externalHost;
      if(businessService === 'WS'){
        url = url + config.egovServices.waterConnectionSearch;
      }
      if(businessService === 'SW'){
        url = url + config.egovServices.sewerageConnectionSearch;
      }

      url = url + '&tenantId='+bill.tenantId;
      url = url + '&connectionNumber='+bill.id;
      let response = await fetch(url,options);
      let searchResults;
      
      if(response.status === 200) {
        searchResults = await response.json();
        let applicationNumber;
        if(businessService === 'WS'){
          applicationNumber = searchResults.WaterConnection[0].applicationNo
          applicationNumbersList.push(applicationNumber);
        }
        if(businessService === 'SW'){
          applicationNumber = searchResults.SewerageConnections[0].applicationNo
          applicationNumbersList.push(applicationNumber);
        }
        consumerCodeToApplicationMapping[applicationNumber] = bill.id;
      }
    }

    let cosumerCodeToLocalityMap = await this.getLocality(applicationNumbersList, authToken, businessService, locale, user);

    let messageBundle = {};
    for(var i=0;i<applicationNumbersList.length;i++){
      let applicationNo = applicationNumbersList[i];
      if(!(Object.keys(cosumerCodeToLocalityMap).length === 0) && cosumerCodeToLocalityMap[applicationNo])
        messageBundle[consumerCodeToApplicationMapping[applicationNo]] = cosumerCodeToLocalityMap[applicationNo];
    }
    
    return messageBundle;  
  }

  async getOpenSearchLink(service, name, mobileNumber, locale){
    var UIHost = config.egovServices.externalHost;
    var paymentPath;
    if(service=='WS')
      paymentPath = config.egovServices.wsOpenSearch;
    else
      paymentPath = config.egovServices.ptOpenSearch;

    paymentPath = paymentPath.replace(/\$name/g,name);
    paymentPath = paymentPath.replace(/\$mobileNumber/g,mobileNumber);
    paymentPath = paymentPath.replace(/\$locale/g,locale);

    var finalPath = UIHost + paymentPath;
    var link =  await this.getShortenedURL(finalPath);
    return link;
  }

  async getSystemAuthToken() {
    // Create a system user token for bill searching when user auth is not available
    const userService = require('../../session/user-service');
    
    try {
      // Use configured system mobile number
      const systemMobileNumber = config.userService.systemUserMobile;
      console.log(`Attempting system auth with mobile: ${systemMobileNumber}`);
      
      const systemAuth = await userService.loginUser(systemMobileNumber, config.rootTenantId);
      
      if (systemAuth && systemAuth.authToken) {
        console.log("System authentication successful");
        return systemAuth;
      }
      
      // If system user doesn't exist, try to create it
      console.log("System user not found, attempting to create");
      const createResult = await userService.createUser(systemMobileNumber, config.rootTenantId);
      
      if (createResult) {
        // Small delay for user creation to complete
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Retry login after creation
        const retryAuth = await userService.loginUser(systemMobileNumber, config.rootTenantId);
        if (retryAuth && retryAuth.authToken) {
          console.log("System authentication successful after user creation");
          return retryAuth;
        }
      }
      
      console.log("System authentication failed - no valid token obtained");
      return null;
      
    } catch (error) {
      console.log("System authentication error:", error.message);
      return null;
    }
  }

}
module.exports = new BillService();