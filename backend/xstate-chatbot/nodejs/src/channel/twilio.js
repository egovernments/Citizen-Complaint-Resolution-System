const config = require('../env-variables');
const fetch = require("node-fetch");
const axios = require('axios');
var FormData = require("form-data");
const mediaTypes = require('../media-types');

// The only host inbound media is fetched from, and the only path shape accepted
// on it. See twilioMediaUrl below.
const TWILIO_MEDIA_HOST = 'api.twilio.com';
const TWILIO_MEDIA_PATH = /^\/2010-04-01\/Accounts\/AC[0-9a-f]{32}\/Messages\/MM[0-9a-f]{32}\/Media\/ME[0-9a-f]{32}$/i;
const INPUT_TYPES = {
    LOCATION: 'location',
    BUTTON: 'button',
    IMAGE: 'image',
    DOCUMENT: 'document',
    TEXT: 'text',
    UNKNOWN: 'unknown',
}


class TwilioWhatsAppProvider {

    constructor() {
        this.accountSid = config.twilio.accountSid;
        this.authToken = config.twilio.authToken;
        this.whatsappNumber = config.twilio.whatsappNumber;
        this.baseUrl = config.twilio.baseUrl || `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    }

    getAuthHeader() {
        const credentials = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
        return `Basic ${credentials}`;
    }

    getExtensionForMimeType(contentType) {
        return mediaTypes.extensionForMimeType(contentType);
    }

    async fileStoreAPICall(fileName, fileData, contentType = null, tenantId = null) {
        var url = config.egovServices.egovServicesHost + config.egovServices.egovFilestoreServiceUploadEndpoint;
        url = url + '&tenantId=' + (tenantId || config.rootTenantId);
        var form = new FormData();
        form.append("file", fileData, {
            filename: fileName,
            contentType: mediaTypes.filestoreContentType(fileName) || contentType || 'application/octet-stream'
        });
        let response = await axios.post(url, form, {
            headers: {
                ...form.getHeaders()
            }
        });

        var filestore = response.data;
        return filestore['files'][0]['fileStoreId'];
    }

    getMimeTypeFromBase64(fileInBase64String) {
        const matches = fileInBase64String.match(/^data:([^;]+);base64,/);
        return matches ? matches[1] : 'application/octet-stream';
    }

    stripBase64Prefix(fileInBase64String) {
        return fileInBase64String.replace(/^data:[^;]+;base64,/, '');
    }

    async fileStoreAPICall(fileName, fileData, contentType = 'application/octet-stream', tenantId = null) {
        var url = config.egovServices.egovServicesHost + config.egovServices.egovFilestoreServiceUploadEndpoint;
        url = url + '&tenantId=' + (tenantId || config.rootTenantId);
        var form = new FormData();
        form.append("file", fileData, {
            filename: fileName,
            contentType: contentType
        });
        let response = await axios.post(url, form, {
            headers: {
                ...form.getHeaders()
            }
        });

        var filestore = response.data;
        return filestore['files'][0]['fileStoreId'];
    }

    async convertFromBase64AndStore(fileInBase64String, tenantId = null) {
        if (!fileInBase64String || typeof fileInBase64String !== "string") {
            throw new Error("Invalid fileInBase64String: Value is missing or not a string");
        }

        const contentType = this.getMimeTypeFromBase64(fileInBase64String);
        const fileExtension = this.getExtensionForMimeType(contentType);
        const base64Payload = this.stripBase64Prefix(fileInBase64String).replace(/ /g, '+');
        let buff = Buffer.from(base64Payload, 'base64');
        var tempName = 'pgr-whatsapp-' + Date.now() + fileExtension;

        try {
            var filestoreId = await this.fileStoreAPICall(tempName, buff, contentType, tenantId);
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

    extractRawMessage(req) {
        let requestBody = req.body;
        if (Object.keys(requestBody).length === 0) {
            requestBody = req.query;
            console.debug("Twilio - Extracted raw message from query:", JSON.stringify(requestBody, null, 2));
        }
        
        console.debug("Twilio - Extracted raw message:", JSON.stringify(requestBody, null, 2));
        return requestBody;
    }

    // Checks if the given Twilio number belongs to the served country based on the configured country code.
    isServedCountry(twillioNumber) { 
        const digits = String(twillioNumber || '').replace(/\D/g, '');
        const countryCode = String(config.countryCode).replace(/\D/g, '');
        return !countryCode || digits.startsWith(countryCode);
    }

    // Validates if the incoming request is a valid Twilio message (text, media, or location)
    async isValid(requestBody) {
        try {

            // Discard messages from numbers that do not belong to the served country.
            if (!this.isServedCountry(requestBody.From)) {
                console.log(`Twilio - Discarding message from out-of-country number: ${requestBody.From}`);
                return false;
            }

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
        // Twilio format: whatsapp:+258849904390 - strip to the bare national
        // number, mirroring toWhatsAppNumber's own use of config.countryCode
        // (this used to hardcode stripping '91' for India, which never matched
        // a +258 number, so context.user.mobileNumber kept its country code
        // and never matched entries in ALLOWED_MOBILE_NUMBERS).
        const digits = String(twilioNumber).replace(/\D/g, '');
        const countryCode = String(config.countryCode).replace(/\D/g, '');
        return countryCode && digits.startsWith(countryCode) ? digits.slice(countryCode.length) : digits;
    }

    getInputType(requestBody) {
        if (requestBody.ButtonPayload || requestBody.ListId)
            return INPUT_TYPES.BUTTON;
        
        if (requestBody.Latitude && requestBody.Longitude) 
            return INPUT_TYPES.LOCATION;
        
        if (requestBody.NumMedia && parseInt(requestBody.NumMedia) > 0)
            return this.getMediaType(requestBody);
        
        if (requestBody.Body) {
            return INPUT_TYPES.TEXT;
        }
        return INPUT_TYPES.UNKNOWN;
    }

    async getInputFromType(requestBody, inputType, tenantId = null) {
        switch (inputType) {
            case INPUT_TYPES.BUTTON:
                return requestBody.ButtonPayload || requestBody.ListId;
            case INPUT_TYPES.LOCATION:
                return '(' + requestBody.Latitude + ',' + requestBody.Longitude + ')';
            case INPUT_TYPES.IMAGE:
            case INPUT_TYPES.DOCUMENT:
                return await this.processMediaInput(requestBody, tenantId);
            case INPUT_TYPES.TEXT:
                return requestBody.Body || '';
            default:
                // unsupported/unknown media, or no recognizable input at all
                return ' ';
        }
    }

    getMediaType(requestBody) {
        const mediaType = requestBody.MediaContentType0 || '';
        if (mediaType && !mediaTypes.isSupportedMimeType(mediaType)) {
            return 'unsupported';
        } else if (mediaType.startsWith('image/')) {
            return 'image';
        } else if (mediaType) {
            return 'document';
        }
        return 'unknown';
    }

    // MediaUrl0 arrives in the webhook body and the download below attaches the
    // account credentials as basic auth, so an attacker-controlled host would
    // receive them. Only the path is taken from the webhook: the request URL is
    // rebuilt against a constant base, which drops any host, port, scheme or
    // userinfo the caller tried to smuggle in.
    twilioMediaUrl(rawUrl) {
        let parsed;
        try {
            parsed = new URL(String(rawUrl ?? ''));
        } catch {
            throw new Error('refusing to download media from a malformed url');
        }
        if (parsed.protocol !== 'https:' || parsed.hostname !== TWILIO_MEDIA_HOST) {
            throw new Error('refusing to download media from a non-Twilio host');
        }
        if (!TWILIO_MEDIA_PATH.test(parsed.pathname)) {
            throw new Error('refusing to download media from an unexpected twilio path');
        }
        return new URL(parsed.pathname, `https://${TWILIO_MEDIA_HOST}`).toString();
    }

    async downloadMediaFromUrl(mediaUrl) {
        return await axios.get(
            this.twilioMediaUrl(mediaUrl),
            {
                responseType: 'arraybuffer',
                auth: {
                    username: this.accountSid,
                    password: this.authToken
                }
            }
        );
    }

    async uploadMediaToFileStore(fileName, fileBuffer, contentType, tenantId = null) {
        return await this.fileStoreAPICall(
            fileName,
            fileBuffer,
            contentType,
            tenantId
        );
    }

    getMediaContentType(requestBody) {
        return requestBody.MediaContentType0 || '';
    }

    async processMediaInput(requestBody, tenantId = null) {
        const mediaUrl = requestBody.MediaUrl0;
        if (!mediaUrl)
            return ' ';

        try {
            const download = async () => {
                const response = await this.downloadMediaFromUrl(mediaUrl);
                const contentType = this.getMediaContentType(requestBody) || response.headers['content-type'] || '';
                const fileExtension = this.getExtensionForMimeType(contentType);
                const fileBuffer = Buffer.from(response.data);

                if (fileBuffer.length > config.maxMediaSizeBytes) {
                    return 'FILE_TOO_LARGE';
                }

                return await this.uploadMediaToFileStore(
                    `pgr-whatsapp-${Date.now()}${fileExtension}`,
                    fileBuffer,
                    contentType,
                    tenantId
                );
            };
            const timeout = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('media processing timed out')), config.mediaProcessingTimeoutMs)
            );

            return await Promise.race([download(), timeout]);

        } catch (error) {
            console.error('Error processing media input:', error);
            return ' ';
        }
    }


    async getUserMessage(requestBody, tenantId = null) {
        console.log("Twilio - Received requestBody:", JSON.stringify(requestBody, null, 2));
        const inputType = this.getInputType(requestBody);
        const inputFromType = await this.getInputFromType(requestBody, inputType, tenantId);

        const reformattedMessage = {
            message: {
                input: inputFromType,
                type: inputType
            },
            user: {
                mobileNumber: this.extractPhoneNumber(requestBody.From)
            },
            extraInfo: {
                whatsAppBusinessNumber: this.extractPhoneNumber(requestBody.To),
                tenantId: config.rootTenantId
            }
        };

        return reformattedMessage;
    }

    async getFormattedMessageFromUser(rawMessage, tenantId) {
        return await this.getUserMessage(rawMessage, tenantId);
    }

    // Twilio wants E.164. `to` may arrive national (849904390) or already
    // prefixed (258849904390), so strip the country code before re-adding it.
    toWhatsAppNumber(to) {
        const digits = String(to).replace(/\D/g, '');
        const countryCode = String(config.countryCode).replace(/\D/g, '');
        const national = countryCode && digits.startsWith(countryCode)
            ? digits.slice(countryCode.length)
            : digits;
        return `whatsapp:+${countryCode}${national}`;
    }

    async sendTextMessage(to, body) {
        const params = new URLSearchParams();
        params.append('To', this.toWhatsAppNumber(to));
        params.append('From', `whatsapp:${this.whatsappNumber.startsWith('+') ? this.whatsappNumber : '+' + this.whatsappNumber}`);
        params.append('Body', body);

        return this.sendTwilioRequest(params);
    }

    async sendMediaMessage(to, mediaUrl, caption = '') {
        const params = new URLSearchParams();
        params.append('To', this.toWhatsAppNumber(to));
        params.append('From', `whatsapp:${this.whatsappNumber.startsWith('+') ? this.whatsappNumber : '+' + this.whatsappNumber}`);
        params.append('MediaUrl', mediaUrl);
        if (caption) {
            params.append('Body', caption);
        }

        return this.sendTwilioRequest(params);
    }

    async sendTemplateMessage(to, contentSid, contentVariables = {}) {
        const params = new URLSearchParams();
        params.append('To', this.toWhatsAppNumber(to));
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
                        let fileURL;
                        
                        // Check if content is already a direct URL (for location instructions, etc.)
                        if (content && (content.startsWith('http://') || content.startsWith('https://'))) {
                            // This is already a URL, use it directly
                            fileURL = content;
                            console.log("Twilio - Using direct URL for image:", fileURL);
                        } else {
                            // This is a filestore ID, fetch the URL from filestore
                            let fileStoreId = content;
                            console.log("Twilio - Fetching from filestore ID:", fileStoreId);
                            fileURL = await this.getFileForFileStoreId(fileStoreId);
                        }
                        
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
