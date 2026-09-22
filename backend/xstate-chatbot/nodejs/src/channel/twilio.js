const config = require('../env-variables');
const mobileValidation = require('../machine/service/mobile-validation-service');
const fetch = require("node-fetch");
const axios = require('axios');
var FormData = require("form-data");
const mediaTypes = require('../media-types');
const { toNationalNumber, toInternationalNumber } = require('../phone-numbers');
const { maskMobile, summarizeInbound } = require('../privacy');
const { isValidTwilioSignature } = require('./twilio-signature');

// The only host inbound media is fetched from, and the only path shape accepted
// on it. See twilioMediaUrl below.
const TWILIO_MEDIA_HOST = 'api.twilio.com';
const TWILIO_MEDIA_PATH = /^\/2010-04-01\/Accounts\/(AC[0-9a-f]{32})\/Messages\/(MM[0-9a-f]{32})\/Media\/(ME[0-9a-f]{32})$/i;
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

    async fileStoreAPICall(fileName, fileData, contentType = null, tenantId = null, cancelToken) {
        var url = config.egovServices.egovServicesHost + config.egovServices.egovFilestoreServiceUploadEndpoint;
        url = url + '&tenantId=' + (tenantId || config.rootTenantId);
        var form = new FormData();
        form.append("file", fileData, {
            filename: fileName,
            contentType: mediaTypes.filestoreContentType(fileName) || contentType || 'application/octet-stream'
        });
        
        const response = await axios.post(url, form, {
            cancelToken,
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
            console.debug("Twilio - Extracted raw message from query:", summarizeInbound(requestBody));
        }
        
        console.debug("Twilio - Extracted raw message:", summarizeInbound(requestBody));
        return requestBody;
    }

    // Checks if the given Twilio number belongs to the served country based on the configured country code.
    isServedCountry(twillioNumber) { 
        const digits = String(twillioNumber || '').replace(/\D/g, '');
        const countryCode = String(config.countryCode).replace(/\D/g, '');
        return !countryCode || digits.startsWith(countryCode);
    }

    /**
     * Request authenticity — the gate that makes `From` trustworthy. Without it
     * anyone reaching the webhook can impersonate a whitelisted citizen, be logged
     * in by the service account and file complaints under that citizen's uuid.
     *
     * Returns false (reject) when signing is misconfigured rather than failing
     * open: a missing authToken/webhookBaseUrl in a deployment is exactly the
     * state an attacker benefits from.
     */
    verifyRequest(req) {
        if (!config.twilio.verifyWebhookSignature) {
            console.warn('Twilio - webhook signature verification is DISABLED (TWILIO_VERIFY_WEBHOOK_SIGNATURE=false)');
            return true;
        }

        const base = String(config.twilio.webhookBaseUrl || '').replace(/\/+$/, '');
        if (!base || !this.authToken) {
            console.error('Twilio - cannot verify webhook: TWILIO_WEBHOOK_BASE_URL or TWILIO_AUTH_TOKEN is unset');
            return false;
        }

        return isValidTwilioSignature({
            authToken: this.authToken,
            url: base + req.originalUrl,
            // Twilio signs the POST form fields; a GET status callback signs the
            // query string, which is already part of originalUrl.
            params: req.method === 'POST' ? req.body : {},
            signature: req.get('X-Twilio-Signature'),
        });
    }


    // Validates if the incoming request is a valid Twilio message (text, media, or location)
    async isValid(requestBody) {
        try {

            // Discard messages from numbers that do not belong to the served country.
            if (!this.isServedCountry(requestBody.From)) {
                console.log(`Twilio - Discarding message from out-of-country number: ${maskMobile(requestBody.From)}`);
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

    /**
     * Number -> the `whatsapp:+E.164` address Twilio's To/From fields require.
     *
     * Uses toAddressableDigits rather than toE164 so a number that could not be reconciled
     * to the tenant's rule is addressed as-sent instead of having the tenant's country code
     * prepended to it. extractPhoneNumber below keeps the raw digits in exactly that case,
     * and re-prefixing them fabricated addresses that cannot be delivered
     * (+447700900123 under the ke rule became +254447700900123).
     */
    async toWhatsAppAddress(number, tenantId = null) {
        const mobileConfig = await mobileValidation.getConfig(tenantId || config.rootTenantId);
        const digits = mobileValidation.toAddressableDigits(number, mobileConfig);
        if (!digits) throw new Error(`Cannot build a WhatsApp address from '${number}'`);
        return `whatsapp:+${digits}`;
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
        const match = TWILIO_MEDIA_PATH.exec(parsed.pathname);
        if (!match) {
            throw new Error('refusing to download media from an unexpected twilio path');
        }
        // Assembled from the three validated SIDs rather than from the inbound path,
        // so nothing the webhook sent reaches the request url verbatim.
        const [, accountSid, messageSid, mediaSid] = match;
        return `https://${TWILIO_MEDIA_HOST}/2010-04-01/Accounts/${accountSid}/Messages/${messageSid}/Media/${mediaSid}`;
    }

    async downloadMediaFromUrl(mediaUrl, cancelToken) {
        return await axios.get(
            this.twilioMediaUrl(mediaUrl),
            {
                responseType: 'arraybuffer',
                cancelToken,
                auth: {
                    username: this.accountSid,
                    password: this.authToken
                }
            }
        );
    }


    async uploadMediaToFileStore(fileName, fileBuffer, contentType, tenantId = null, cancelToken) {
        return await this.fileStoreAPICall(
            fileName,
            fileBuffer,
            contentType,
            tenantId,
            cancelToken
        );
    }


    getMediaContentType(requestBody) {
        return requestBody.MediaContentType0 || '';
    }

        async processMediaInput(requestBody, tenantId = null) {
        const mediaUrl = requestBody.MediaUrl0;
        if (!mediaUrl)
            return ' ';

        // Set up a cancellation mechanism for the media download to enforce the timeout.
        const cancellation = axios.CancelToken.source();
        const timer = setTimeout(
            () => cancellation.cancel(`media processing timed out after ${config.timeouts.mediaProcessing}ms`),
            config.timeouts.mediaProcessing
        );

        try {
            const response = await this.downloadMediaFromUrl(mediaUrl, cancellation.token);
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
                tenantId,
                cancellation.token
            );
        } catch (error) {
            if (axios.isCancel(error)) {
                console.error(`Twilio - ${error.message}`);
            } else {
                console.error('Error processing media input:', error.message);
            }
            return ' ';
        } finally {
            clearTimeout(timer);
        }
    }



    async getUserMessage(requestBody, tenantId = null) {
        console.log("Twilio - inbound:", summarizeInbound(requestBody));
        const inputType = this.getInputType(requestBody);
        const inputFromType = await this.getInputFromType(requestBody, inputType, tenantId);

        const reformattedMessage = {
            message: {
                input: inputFromType,
                type: inputType
            },
            user: {
                mobileNumber: await this.extractPhoneNumber(requestBody.From, tenantId)
            },
            extraInfo: {
                // The Twilio ACCOUNT's number, so it is deliberately not run through the
                // citizen tenant's rule — a sandbox sender never matches it.
                whatsAppBusinessNumber: mobileValidation.digitsOnly(requestBody.To),
                tenantId: config.rootTenantId
            }
        };

        return reformattedMessage;
    }

    async getFormattedMessageFromUser(rawMessage, tenantId) {
        return await this.getUserMessage(rawMessage, tenantId);
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
        const tenantId = (extraInfo && extraInfo.tenantId) || config.rootTenantId;
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
