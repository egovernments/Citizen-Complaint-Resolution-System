const config = require('../env-variables');
const fetch = require("node-fetch");
const fs = require('fs');
const axios = require('axios');
var FormData = require("form-data");
var uuid = require('uuid-random');

class TwilioWhatsAppProvider {

    constructor() {
        this.accountSid = config.twilio.accountSid;
        this.authToken = config.twilio.authToken;
        this.whatsappNumber = config.twilio.whatsappNumber;
        this.baseUrl = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    }

    getAuthHeader() {
        const credentials = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
        return `Basic ${credentials}`;
    }

    async fileStoreAPICall(fileName, fileData) {
        var url = config.egovServices.egovServicesHost + config.egovServices.egovFilestoreServiceUploadEndpoint;
        url = url + '&tenantId=' + config.rootTenantId;
        var form = new FormData();
        form.append("file", fileData, {
            filename: fileName,
            contentType: "image/jpg"
        });
        let response = await axios.post(url, form, {
            headers: {
                ...form.getHeaders()
            }
        });

        var filestore = response.data;
        return filestore['files'][0]['fileStoreId'];
    }

    async convertFromBase64AndStore(imageInBase64String) {
        if (!imageInBase64String || typeof imageInBase64String !== "string") {
            throw new Error("Invalid imageInBase64String: Value is missing or not a string");
        }

        imageInBase64String = imageInBase64String.replace(/ /g, '+');
        let buff = Buffer.from(imageInBase64String, 'base64');
        var tempName = 'pgr-whatsapp-' + Date.now() + '.jpg';

        try {
            var filestoreId = await this.fileStoreAPICall(tempName, buff);
            return filestoreId;
        } catch (error) {
            console.error("Error in fileStoreAPICall:", error);
            return null;
        }
    }

    async getFileForFileStoreId(filestoreId) {
        var url = config.egovServices.egovServicesHost + config.egovServices.egovFilestoreServiceDownloadEndpoint;
        url = url + '?';
        url = url + 'tenantId=' + config.rootTenantId;
        url = url + '&';
        url = url + 'fileStoreIds=' + filestoreId;

        console.log("Twilio - Fetching filestore URL:", url);

        var options = {
            method: "GET",
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                'authority': 'unified-demo.digit.org',
                'accept-language': 'en-GB,en;q=0.9',
                'pragma': 'no-cache',
                'referer': 'https://unified-demo.digit.org/digit-ui/employee/dss/dashboard/fsm',
                'sec-ch-ua': '"Google Chrome";v="107", "Chromium";v="107", "Not=A?Brand";v="24"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36'
            }
        }
        
        try {
            let response = await fetch(url, options);
            
            if (!response.ok) {
                console.error("Twilio - Filestore API error:", response.status, response.statusText);
                throw new Error(`Filestore API returned ${response.status}: ${response.statusText}`);
            }
            
            let responseData = await response.json();
            console.log("Twilio - Filestore API response:", JSON.stringify(responseData, null, 2));
            
            if (!responseData || !responseData.fileStoreIds || !Array.isArray(responseData.fileStoreIds) || responseData.fileStoreIds.length === 0) {
                console.error("Twilio - Invalid filestore response structure:", responseData);
                throw new Error("Invalid filestore response: missing fileStoreIds array");
            }
            
            if (!responseData.fileStoreIds[0] || !responseData.fileStoreIds[0].url) {
                console.error("Twilio - Missing URL in filestore response:", responseData.fileStoreIds[0]);
                throw new Error("Invalid filestore response: missing url property");
            }
            
            var fileURL = responseData.fileStoreIds[0].url.split(",");
            console.log("Twilio - Successfully extracted file URL:", fileURL[0]);
            return fileURL[0].toString();
            
        } catch (error) {
            console.error("Twilio - Error in getFileForFileStoreId:", error);
            throw error;
        }
    }

    async isValid(requestBody) {
        try {
            // Twilio webhook validation
            if (requestBody.From && requestBody.To && requestBody.Body !== undefined) {
                return true;
            }
            // Check for media messages
            if (requestBody.NumMedia && parseInt(requestBody.NumMedia) > 0) {
                return true;
            }
            // Check for location messages
            if (requestBody.Latitude && requestBody.Longitude) {
                return true;
            }
        } catch (error) {
            console.error("Invalid request:", error);
        }
        return false;
    }

    extractPhoneNumber(twilioNumber) {
        // Twilio format: whatsapp:+919876543210
        // Extract just the number without country code prefix
        let number = twilioNumber.replace('whatsapp:', '').replace('+', '');
        // Remove country code (assuming 91 for India)
        if (number.startsWith('91') && number.length > 10) {
            number = number.slice(2);
        }
        return number;
    }

    async getUserMessage(requestBody) {
        console.log("Twilio - Received requestBody:", JSON.stringify(requestBody, null, 2));

        let reformattedMessage = {};
        let type;
        let input;

        // Check for button response (Twilio interactive messages)
        if (requestBody.ButtonPayload || requestBody.ListId) {
            type = 'button';
            input = requestBody.ButtonPayload || requestBody.ListId;
        }
        // Check for location
        else if (requestBody.Latitude && requestBody.Longitude) {
            type = 'location';
            input = '(' + requestBody.Latitude + ',' + requestBody.Longitude + ')';
        }
        // Check for media (image, document, etc.)
        else if (requestBody.NumMedia && parseInt(requestBody.NumMedia) > 0) {
            const mediaType = requestBody.MediaContentType0 || '';

            if (mediaType.startsWith('image/')) {
                type = 'image';
                // Download and store the image
                try {
                    const mediaUrl = requestBody.MediaUrl0;
                    const response = await axios.get(mediaUrl, {
                        responseType: 'arraybuffer',
                        auth: {
                            username: this.accountSid,
                            password: this.authToken
                        }
                    });
                    const imageBuffer = Buffer.from(response.data);
                    const tempName = 'pgr-whatsapp-' + Date.now() + '.jpg';
                    input = await this.fileStoreAPICall(tempName, imageBuffer);
                } catch (error) {
                    console.error("Error downloading/storing image:", error);
                    input = ' ';
                }
            } else if (mediaType === 'application/pdf') {
                type = 'document';
                input = ' ';
            } else {
                type = 'unknown';
                input = ' ';
            }
        }
        // Text message
        else if (requestBody.Body) {
            type = 'text';
            input = requestBody.Body;
        }
        else {
            type = 'unknown';
            input = ' ';
        }

        reformattedMessage.message = {
            input: input,
            type: type
        };

        reformattedMessage.user = {
            mobileNumber: this.extractPhoneNumber(requestBody.From)
        };

        reformattedMessage.extraInfo = {
            whatsAppBusinessNumber: this.extractPhoneNumber(requestBody.To),
            tenantId: config.rootTenantId
        };

        return reformattedMessage;
    }

    async processMessageFromUser(req) {
        let reformattedMessage = {};
        let requestBody = req.body;

        // Twilio sends POST with form-urlencoded data
        if (Object.keys(requestBody).length === 0) {
            requestBody = req.query;
        }

        if (!await this.isValid(requestBody)) {
            console.log("Twilio - Invalid message received");
            return null;
        }

        reformattedMessage = await this.getUserMessage(requestBody);
        return reformattedMessage;
    }

    async sendTextMessage(to, body) {
        const params = new URLSearchParams();
        params.append('To', `whatsapp:+91${to}`);
        params.append('From', `whatsapp:${this.whatsappNumber.startsWith('+') ? this.whatsappNumber : '+' + this.whatsappNumber}`);
        params.append('Body', body);

        return this.sendTwilioRequest(params);
    }

    async sendMediaMessage(to, mediaUrl, caption = '') {
        const params = new URLSearchParams();
        params.append('To', `whatsapp:+91${to}`);
        params.append('From', `whatsapp:${this.whatsappNumber.startsWith('+') ? this.whatsappNumber : '+' + this.whatsappNumber}`);
        params.append('MediaUrl', mediaUrl);
        if (caption) {
            params.append('Body', caption);
        }

        return this.sendTwilioRequest(params);
    }

    async sendTemplateMessage(to, contentSid, contentVariables = {}) {
        const params = new URLSearchParams();
        params.append('To', `whatsapp:+91${to}`);
        params.append('From', `whatsapp:${this.whatsappNumber.startsWith('+') ? this.whatsappNumber : '+' + this.whatsappNumber}`);
        params.append('ContentSid', contentSid);
        if (Object.keys(contentVariables).length > 0) {
            params.append('ContentVariables', JSON.stringify(contentVariables));
        }

        return this.sendTwilioRequest(params);
    }

    async sendTwilioRequest(params) {
        try {
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Authorization': this.getAuthHeader(),
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: params.toString()
            });

            const responseData = await response.json();

            if (response.ok) {
                console.log("Twilio - Message sent successfully:", responseData.sid);
                return responseData;
            } else {
                console.error("Twilio - Error sending message:", responseData);
                return undefined;
            }
        } catch (error) {
            console.error("Twilio - Request failed:", error);
            return undefined;
        }
    }

    async sendMessageToUser(user, messages, extraInfo) {
        let userMobile = user.mobileNumber;

        for (let i = 0; i < messages.length; i++) {
            let message = messages[i];
            let type;
            let content;

            console.log("Twilio - sendMessageToUser message:", message);
            console.log("Twilio - sendMessageToUser type:", typeof message);

            if (typeof message === 'string') {
                type = 'text';
                content = message;
            } else if (typeof message === 'object') {
                type = message.type;
                content = message.output;
            }

            try {
                if (type === 'text') {
                    await this.sendTextMessage(userMobile, content);
                }
                else if (type === 'template') {
                    // For Twilio templates, we use ContentSid
                    // The template ID should be configured in Twilio Content API
                    const templateId = content; // This should be the ContentSid
                    let contentVariables = {};

                    if (message.params && message.params.length > 0) {
                        // Convert params array to object with numbered keys
                        message.params.forEach((param, index) => {
                            contentVariables[(index + 1).toString()] = param;
                        });
                    }

                    await this.sendTemplateMessage(userMobile, templateId, contentVariables);
                }
                else if (type === 'image' || type === 'pdf') {
                    // For media messages, get the file URL
                    try {
                        let fileStoreId = content;
                        console.log("Twilio - Attempting to fetch filestore ID:", fileStoreId);
                        let fileURL = await this.getFileForFileStoreId(fileStoreId);
                        let caption = extraInfo && extraInfo.fileName ? extraInfo.fileName : '';
                        await this.sendMediaMessage(userMobile, fileURL, caption);
                    } catch (fileError) {
                        console.error("Twilio - Failed to send media message:", fileError.message);
                        // Send a fallback text message instead
                        let fallbackMessage = "Sorry, we couldn't load the instructional image. Please proceed with location sharing or type *1* to continue without sharing location.";
                        await this.sendTextMessage(userMobile, fallbackMessage);
                    }
                }
                else {
                    // Default to text message
                    if (content) {
                        await this.sendTextMessage(userMobile, content.toString());
                    }
                }
            } catch (error) {
                console.error("Twilio - Error sending message:", error);
            }
        }
    }

    async getTransformMessageForTemplate(reformattedMessages) {
        if (reformattedMessages.length > 0) {
            for (let message of reformattedMessages) {
                let templateId = message.extraInfo.templateId;
                let templateParams = message.extraInfo.params;
                let userMobile = message.user.mobileNumber;

                let contentVariables = {};
                if (templateParams && templateParams.length > 0) {
                    templateParams.forEach((param, index) => {
                        contentVariables[(index + 1).toString()] = param;
                    });
                }

                await this.sendTemplateMessage(userMobile, templateId, contentVariables);
            }
        }
    }
}

module.exports = new TwilioWhatsAppProvider();
