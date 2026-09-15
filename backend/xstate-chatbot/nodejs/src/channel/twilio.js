const config = require('../env-variables');
const mobileValidation = require('../machine/service/mobile-validation-service');
const fetch = require("node-fetch");
const axios = require('axios');
var FormData = require("form-data");

const MIME_TYPE_EXTENSIONS = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx'
};

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
        return MIME_TYPE_EXTENSIONS[contentType] || '';
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

    /**
     * Twilio `whatsapp:+254712345678` -> the tenant's national number (`712345678`).
     *
     * The country code and the valid-number rule come from the tenant's
     * common-masters.MobileNumberValidation row, not from a hardcoded `91`. Returns the
     * bare digits when the number cannot be reconciled with the tenant rule, so the caller
     * still has something to key a session on and the downstream login produces the real
     * error rather than this layer silently mangling the number.
     */
    async extractPhoneNumber(twilioNumber, tenantId = null) {
        const mobileConfig = await mobileValidation.getConfig(tenantId || config.rootTenantId);
        const national = mobileValidation.toNational(twilioNumber, mobileConfig);
        if (national) return national;

        const digits = mobileValidation.digitsOnly(twilioNumber);
        console.error(
            `Twilio - '${twilioNumber}' does not match the mobile rule for tenant ` +
            `${tenantId || config.rootTenantId} (${mobileConfig.mobileNumberRegex}); using raw digits`
        );
        return digits;
    }

    /** National number -> the `whatsapp:+E.164` address Twilio's To/From fields require. */
    async toWhatsAppAddress(nationalNumber, tenantId = null) {
        const mobileConfig = await mobileValidation.getConfig(tenantId || config.rootTenantId);
        const e164 = mobileValidation.toE164(nationalNumber, mobileConfig);
        return `whatsapp:${e164}`;
    }

    /**
     * Build Twilio's `From` address from the configured sender.
     *
     * TWILIO_WHATSAPP_NUMBER is fed from `twilio_whatsapp_from`, and the repo-wide
     * convention for that variable is the ALREADY-PREFIXED form `whatsapp:+14155238886`
     * (every host_vars example and the Novu bootstrap default use it, because Novu's Twilio
     * integration wants it that way). Blindly re-prefixing produced
     * `From=whatsapp:+whatsapp:+14155238886`, which Twilio rejects -- the webhook validated,
     * the dialog ran, state was written, and the citizen never got a reply.
     *
     * So normalise instead of assuming: strip any `whatsapp:` prefix and any leading `+`,
     * then rebuild exactly once. That keeps `twilio_whatsapp_from` meaning the same thing for
     * the Novu outbound bootstrap, which also consumes it -- inbound must not redefine a
     * variable outbound depends on.
     */
    senderAddress() {
        const raw = String(this.whatsappNumber || '').trim();
        if (!raw) {
            // Fail loudly rather than silently sending as someone else's number.
            throw new Error(
                'TWILIO_WHATSAPP_NUMBER is not set. Set twilio_whatsapp_from in host_vars ' +
                '(e.g. "whatsapp:+14155238886") so the chatbot can address replies.'
            );
        }
        const digits = raw.replace(/^whatsapp:/i, '').replace(/[^0-9]/g, '');
        return `whatsapp:+${digits}`;
    }

    async getUserMessage(requestBody, tenantId = null) {
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
            const fileExtension = this.getExtensionForMimeType(mediaType);

            if (mediaType.startsWith('image/')) {
                type = 'image';
            } else if (mediaType) {
                type = 'document';
            } else {
                type = 'unknown';
                input = ' ';
            }

            if (type === 'image' || type === 'document') {
                try {
                    const mediaUrl = requestBody.MediaUrl0;
                    const response = await axios.get(mediaUrl, {
                        responseType: 'arraybuffer',
                        auth: {
                            username: this.accountSid,
                            password: this.authToken
                        }
                    });
                    const fileBuffer = Buffer.from(response.data);
                    const tempName = 'pgr-whatsapp-' + Date.now() + fileExtension;
                    input = await this.fileStoreAPICall(tempName, fileBuffer, mediaType || response.headers['content-type'], tenantId);
                } catch (error) {
                    console.error("Error downloading/storing media:", error);
                    input = ' ';
                }
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
            mobileNumber: await this.extractPhoneNumber(requestBody.From, tenantId)
        };

        reformattedMessage.extraInfo = {
            whatsAppBusinessNumber: await this.extractPhoneNumber(requestBody.To, tenantId),
            tenantId: tenantId || config.rootTenantId
        };

        return reformattedMessage;
    }

    async processMessageFromUser(req, providedTenantId = null) {
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

        // Use provided tenant ID, or fall back to query parameter, or use default
        let tenantId = providedTenantId || req.query.tenantId || config.rootTenantId;
        
        reformattedMessage = await this.getUserMessage(requestBody, tenantId);
        return reformattedMessage;
    }

    async sendTextMessage(to, body, tenantId = null) {
        const params = new URLSearchParams();
        params.append('To', await this.toWhatsAppAddress(to, tenantId));
        params.append('From', this.senderAddress());
        params.append('Body', body);

        return this.sendTwilioRequest(params);
    }

    async sendMediaMessage(to, mediaUrl, caption = '', tenantId = null) {
        const params = new URLSearchParams();
        params.append('To', await this.toWhatsAppAddress(to, tenantId));
        params.append('From', this.senderAddress());
        params.append('MediaUrl', mediaUrl);
        if (caption) {
            params.append('Body', caption);
        }

        return this.sendTwilioRequest(params);
    }

    async sendTemplateMessage(to, contentSid, contentVariables = {}, tenantId = null) {
        const params = new URLSearchParams();
        params.append('To', await this.toWhatsAppAddress(to, tenantId));
        params.append('From', this.senderAddress());
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
        // The citizen's tenant decides the country code; fall back to the deployment root.
        let tenantId = (extraInfo && extraInfo.tenantId) || config.rootTenantId;

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
                    await this.sendTextMessage(userMobile, content, tenantId);
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

                    await this.sendTemplateMessage(userMobile, templateId, contentVariables, tenantId);
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
                        await this.sendMediaMessage(userMobile, fileURL, caption, tenantId);
                    } catch (fileError) {
                        console.error("Twilio - Failed to send media message:", fileError.message);
                        // Send a fallback text message instead
                        let fallbackMessage = "Sorry, we couldn't load the instructional image. Please proceed with location sharing or type *1* to continue without sharing location.";
                        await this.sendTextMessage(userMobile, fallbackMessage, tenantId);
                    }
                }
                else {
                    // Default to text message
                    if (content) {
                        await this.sendTextMessage(userMobile, content.toString(), tenantId);
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
                let tenantId = message.tenantId || (message.extraInfo && message.extraInfo.tenantId) || config.rootTenantId;

                let contentVariables = {};
                if (templateParams && templateParams.length > 0) {
                    templateParams.forEach((param, index) => {
                        contentVariables[(index + 1).toString()] = param;
                    });
                }

                await this.sendTemplateMessage(userMobile, templateId, contentVariables, tenantId);
            }
        }
    }
}

module.exports = new TwilioWhatsAppProvider();
