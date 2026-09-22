require('dotenv').config();
const os = require('os');

const envVariables = {
    serviceId: process.env.NAME || 'xstate-chatbot',
    ver: process.env.VERSION || '0.0.1',

    port: process.env.SERVICE_PORT || 8082,

    contextPath: process.env.CONTEXT_PATH || '/xstate-chatbot',

    whatsAppProvider: process.env.WHATSAPP_PROVIDER || 'Twilio',

    serviceProvider: process.env.SERVICE_PROVIDER || 'eGov',

    repoProvider: process.env.REPO_PROVIDER || 'InMemory',

    // No built-in default: the old '919880900990' is an eGov DEMO number, and a blank
    // WHATSAPP_BUSINESS_NUMBER silently rendered it into citizen-facing deep links
    // (reminders-service and pdf-service both do .slice(2) on this). Blank now means
    // "omit", which is what host_vars documents, and a misconfiguration stays visible.
    whatsAppBusinessNumber: process.env.WHATSAPP_BUSINESS_NUMBER || '',

    allowedMobileNumbers: process.env.ALLOWED_MOBILE_NUMBERS || '',

    serviceAccount: {
        username: process.env.USER_SERVICE_ACCOUNT_USERNAME || '',
        password: process.env.USER_SERVICE_ACCOUNT_PASSWORD || '',
        tenantId: process.env.USER_SERVICE_ACCOUNT_TENANT ||  process.env.ROOT_TENANTID || 'mz',
    },

    // Placeholder name for a citizen before they have provided a real name.
    citizenPlaceholderName: process.env.CITIZEN_PLACEHOLDER_NAME || 'Cidadão',

    resetWords: (process.env.RESET_WORDS || 'reiniciar,reinicie,restart,reset,ola,oi,hello,hi').split(',').map(word => word.trim().toLowerCase()).filter(Boolean),

    cancelWords: (process.env.CANCEL_WORDS || 'cancelar,cancele,cancel,parar,pare,stop').split(',').map(word => word.trim().toLowerCase()).filter(Boolean),

    rootTenantId: process.env.ROOT_TENANTID || 'pg',

    // Boundary hierarchy this deployment files complaints against. Named per deployment
    // (bometfeedbackhub, for one, does not use ADMIN), so it cannot stay a literal.
    boundaryHierarchyType: process.env.BOUNDARY_HIERARCHY_TYPE || 'ADMIN',

    supportedLocales: process.env.SUPPORTED_LOCALES || 'en_IN',
    
    defaultLocale: (process.env.SUPPORTED_LOCALES || 'en_IN').split(',')[0].trim(),


    // Phone identity is per-country CONFIG, not code. countryCode is the dialling
    // prefix without '+'; mobileNumberLength is the national number length.
    // MZ: 258 / 9 (^8[0-9]{8}$).   IN: 91 / 10.
    countryCode: process.env.COUNTRY_CODE || '91',
    mobileNumberLength: parseInt(process.env.MOBILE_NUMBER_LENGTH || '10', 10),

    descriptionMinLength: parseInt(process.env.DESCRIPTION_MIN_LENGTH || '20', 10),

    caseRelatedTo: process.env.CASE_RELATED_TO || 'IGE',
    instituteNameMaxLength: parseInt(process.env.INSTITUTE_NAME_MAX_LENGTH || '300', 10),

    // boundary-service registers many unrelated hierarchy types per tenant
    // (other modules, QA fixtures); this picks out the one PGR actually uses.
    boundaryHierarchyType: process.env.BOUNDARY_HIERARCHY_TYPE || 'divisao_administrativa',

    // Tenant-aware mobile numbers, read from common-masters.MobileNumberValidation --
    // the same master egov-user, egov-hrms, digit-ui and novu-bridge use. The defaults
    // below apply only when the tenant has no row or MDMS is unreachable; they preserve
    // the previous India-only behaviour rather than inventing a new one.
    mobileValidation: {
        defaultCountryCode: process.env.DEFAULT_COUNTRY_CODE || '+91',
        defaultRegex: process.env.DEFAULT_MOBILE_REGEX || '^[0-9]{10}$',
        cacheTtlMs: parseInt(process.env.MOBILE_VALIDATION_CACHE_TTL_MS || '300000', 10),
    },

    // The dev-only catch-all reverse proxy in app.js. OFF by default: with it on, every
    // path the chatbot does not own is forwarded to the DIGIT services host, so a publicly
    // reachable container becomes an open proxy onto internal APIs. It exists solely so the
    // react-app dialog harness can share an origin (see LOCALSETUP.md).
    devProxyEnabled: process.env.DEV_PROXY_ENABLED === 'true',

    // Shared secret for POST /reminder, which fans a message out to every active session.
    // Unset means the route is disabled outright rather than left open.
    reminderAuthToken: process.env.REMINDER_AUTH_TOKEN || '',

    // Sandbox mode configuration
    isSandboxMode: process.env.ENABLE_SANDBOX_MODE === 'true',
    tenantManagementHost: process.env.TENANT_MANAGEMENT_HOST || 'https://sandbox.digit.org',
    sandboxHost: process.env.SANDBOX_HOST || 'https://sandbox.digit.org',



    googleAPIKey: process.env.GOOGLE_MAPS_API_KEY || '',

    dateFormat: process.env.DATEFORMAT || 'DD/MM/YYYY',
    timeZone: process.env.TIMEZONE || 'Asia/Kolkata',
    msgId: process.env.MSG_ID || '20170310130900',
    avgSessionTime: process.env.AVG_SESSION_TIME || 10,
    replyCooldownMs: parseInt(process.env.REPLY_COOLDOWN_MS || '2000', 10),

    // Deadlines for work a dispatch waits on. `dispatchSettle` supervises the
    // other two and MUST stay above both: if a request and its supervisor
    // expire together, the dispatch lock is released while the call may still
    // be resolving, and the citizen's retry files a second complaint.
    timeouts: {
        request: parseInt(process.env.REQUEST_TIMEOUT_MS || '20000', 10),
        mediaProcessing: parseInt(process.env.MEDIA_PROCESSING_TIMEOUT_MS || '13000', 10),
        dispatchSettle: parseInt(process.env.DISPATCH_SETTLE_TIMEOUT_MS || '30000', 10),
    },
    maxMediaSizeBytes: parseInt(process.env.MAX_MEDIA_SIZE_MB || '5', 10) * 1024 * 1024,
    // Maximum number of messages that can be queued per user before older messages are dropped.
    maxQueuedMessagesPerUser: parseInt(process.env.MAX_QUEUED_MESSAGES_PER_USER || '3', 10),
    paytmWnSLink: process.env.PAYTM_WNS_LINK || 'https://stvending.punjab.gov.in/wsbills/',

    postgresConfig: {
        dbHost: process.env.DB_HOST || 'localhost',
        dbPort: process.env.DB_PORT || '5432',
        dbName: process.env.DB_NAME || 'postgres4',
        dbUsername: process.env.DB_USER || 'postgres',
        dbPassword: process.env.DB_PASSWORD || '',
        dbSSL: process.env.DB_SSL === 'true'
    },

    kafka: {
        kafkaBootstrapServer: process.env.KAFKA_BOOTSTRAP_SERVER || 'localhost:9092',
        chatbotTelemetryTopic: process.env.CHATBOT_TELEMETRY_TOPIC || 'chatbot-telemetry-v2',

        kafkaConsumerEnabled: process.env.KAFKA_CONSUMER_ENABLED === 'true',
        kafkaConsumerGroupId: process.env.KAFKA_CONSUMER_GROUP_ID || 'xstate-chatbot',
    },

    kaleyra: {
        sendMessageUrl: process.env.KALEYRA_SEND_MESSAGE_URL || 'https://api.kaleyra.io/v1/{{sid}}/messages',
        sid: process.env.KALEYRA_SID || '',
        apikey: process.env.KALEYRA_API_KEY || '',
        channel: process.env.KALEYRA_CHANNEL || 'whatsapp',
    },

    twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID || '',
        authToken: process.env.TWILIO_AUTH_TOKEN || '',
        // Also no default, for the same reason: silently sending as the eGov demo number is
        // worse than a startup failure. senderAddress() raises when this is unset.
        whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER || '',
        baseUrl: process.env.TWILIO_BASE_URL || '',
        // Public origin Twilio was configured to call. Pinning it stops a forged
        // Host/X-Forwarded-Host from steering the signature check at a URL an
        // attacker controls — twilio-signature.js never reads request headers.
        webhookBaseUrl: process.env.TWILIO_WEBHOOK_BASE_URL || process.env.EXTERNAL_HOST || '',
        // Defaults ON: the webhook is public by necessity, so the signature is the
        // only thing separating a citizen from anyone who guessed the URL.
        verifyWebhookSignature: (process.env.TWILIO_VERIFY_WEBHOOK_SIGNATURE || 'true') !== 'false',
    },

    // Providers with no signing scheme of their own (ValueFirst, Kaleyra) verify
    // a shared secret instead, sent as X-Webhook-Secret or ?webhookSecret=.
    webhook: {
        sharedSecret: process.env.WEBHOOK_SHARED_SECRET || '',
        // Mirrors TWILIO_VERIFY_WEBHOOK_SIGNATURE: the only way to run unverified.
        verify: (process.env.VERIFY_WEBHOOK_SIGNATURE || 'true') !== 'false',
    },


    valueFirstWhatsAppProvider: {
        valueFirstUsername: process.env.VALUEFIRST_USERNAME || 'demo',
        valueFirstPassword: process.env.VALUEFIRST_PASSWORD || 'demo',
        valueFirstURL: process.env.VALUEFIRST_SEND_MESSAGE_URL || 'https://api.myvfirst.com/psms/servlet/psms.JsonEservice',
        valueFirstTokenURL: process.env.VALUEFIRST_TOKEN_URL || 'https://api.myvfirst.com/psms/api/messages/token',
        valuefirstNotificationAssignedTemplateid: process.env.VALUEFIRST_NOTIFICATION_ASSIGNED_TEMPLATEID || '205987,4156319',
        valuefirstNotificationResolvedTemplateid: process.env.VALUEFIRST_NOTIFICATION_RESOLVED_TEMPLATEID || '205989,4156321',
        valuefirstNotificationRejectedTemplateid: process.env.VALUEFIRST_NOTIFICATION_REJECTED_TEMPLATEID || '205991,4156323',
        valuefirstNotificationReassignedTemplateid: process.env.VALUEFIRST_NOTIFICATION_REASSIGNED_TEMPLATEID || '205993,4156325',
        valuefirstNotificationCommentedTemplateid: process.env.VALUEFIRST_NOTIFICATION_COMMENTED_TEMPLATEID || '205995',
        valuefirstNotificationWelcomeTemplateid: process.env.VALUEFIRST_NOTIFICATION_WELCOME_TEMPLATEID || '205999,4156311',
        valuefirstNotificationRootTemplateid: process.env.VALUEFIRST_NOTIFICATION_ROOT_TEMPLATEID || '206001,4156313',
        valuefirstNotificationViewReceptTemplateid: process.env.VALUEFIRST_NOTIFICATION_VIEW_RECEIPT_TEMPLATEID || '3597461,4156327',
        valuefirstNotificationPTBillTemplateid: process.env.VALUEFIRST_NOTIFICATION_PT_BILL_TEMPLATEID || '3595729,4156331',
        valuefirstNotificationWSBillTemplateid: process.env.VALUEFIRST_NOTIFICATION_WS_BILL_TEMPLATEID || '3595727,4156329',
        valuefirstNotificationOwnerBillSuccessTemplateid: process.env.VALUEFIRST_NOTIFICATION_OWNER_BILL_SUCCESS_TEMPLATEID || '3595731,4156489',
        valuefirstNotificationOtherPTBillSuccessTemplateid: process.env.VALUEFIRST_NOTIFICATION_OTHER_PT_BILL_SUCCESS_TEMPLATEID || '3618673,4156315',
        valuefirstNotificationOtherWSBillSuccessTemplateid: process.env.VALUEFIRST_NOTIFICATION_OTHER_WS_BILL_SUCCESS_TEMPLATEID || '3618675,4156317',
        valuefirstNotificationTrackCompliantTemplateid: process.env.VALUEFIRST_NOTIFICATION_TRACK_COMPLAINT_TEMPLATEID || '4052381,4156335',
        valuefirstNotificationLodgeCompliantTemplateid: process.env.VALUEFIRST_NOTIFICATION_LODGE_COMPLAINT_TEMPLATEID || '4052379,4156333',
        valuefirstLoginAuthorizationHeader: process.env.VALUEFIRST_LOGIN_AUTHORIZATION_HEADER || '',
        userServiceCreateNoValidatePath: process.env.USER_SERVICE_CREATE_NOVALIDATE_PATH || 'user/users/_createnovalidate',
        userServiceUpdateNoValidatePath: process.env.USER_SERVICE_UPDATE_NOVALIDATE_PATH || 'user/users/_updatenovalidate',
        userServiceSearchPath: process.env.USER_SERVICE_SEARCH_PATH || 'user/_search',
    },

    egovServices: {
        egovServicesHost: process.env.EGOV_SERVICES_HOST || 'https://sandbox.digit.org/',
        externalHost: process.env.EXTERNAL_HOST || 'https://sandbox.digit.org/',
        searcherHost: process.env.EGOV_SEARCHER_HOST || 'https://sandbox.digit.org/',
        userServiceHost: process.env.USER_SERVICE_HOST || 'https://sandbox.digit.org/',
        userServiceOAuthPath: process.env.USER_SERVICE_OAUTH_PATH || 'user/oauth/token',
        userServiceCreateCitizenPath: process.env.USER_SERVICE_CREATE_CITIZEN_PATH || 'user/citizen/_create',
        userServiceUpdateProfilePath: process.env.USER_SERVICE_UPDATE_PROFILE_PATH || 'user/profile/_update',
        userServiceCitizenDetailsPath: process.env.USER_SERVICE_CITIZEN_DETAILS_PATH || 'user/_details',
        userServiceCreateNoValidatePath: process.env.USER_SERVICE_CREATE_NOVALIDATE_PATH || 'user/users/_createnovalidate',
        userServiceUpdateNoValidatePath: process.env.USER_SERVICE_UPDATE_NOVALIDATE_PATH || 'user/users/_updatenovalidate',
        userServiceSearchPath: process.env.USER_SERVICE_SEARCH_PATH || 'user/_search',

        egovlocalizationhost: process.env.LOCALIZATION_SERVICE_HOST || 'https://sandbox.digit.org/',
        mdmsSearchPath: process.env.MDMS_SEARCH_PATH || 'egov-mdms-service/v1/_search',
        // v2 schema-code search, used for common-masters.MobileNumberValidation. Distinct
        // from the v1 moduleDetails search above; novu-bridge calls the same endpoint.
        mdmsV2SearchPath: process.env.MDMS_V2_SEARCH_PATH || 'mdms-v2/v2/_search',
        localisationServiceSearchPath: process.env.LOCALISATION_SERVICE_SEARCH_PATH || 'localization/messages/v1/_search',
        billServiceSearchPath: process.env.BILL_SERVICE_SEARCH_PATH || 'billing-service/bill/v2/_fetchbill',
        egovFilestoreServiceUploadEndpoint: process.env.EGOV_FILESTORE_SERVICE_UPLOAD_ENDPOINT || "filestore/v1/files?module=chatbot",
        egovFilestoreServiceDownloadEndpoint: process.env.EGOV_FILESTORE_SERVICE_DOWNLOAD_ENDPOINT || "filestore/v1/files/url",
        urlShortnerEndpoint: process.env.URL_SHORTNER_ENDPOINT || 'egov-url-shortening/shortener',
        collectonServicSearchEndpoint: process.env.COLLECTION_SERVICE_SEARCH_ENDPOINT || 'collection-services/payments/$module/_search',
        pgrCreateEndpoint: process.env.PGR_CREATE_ENDPOINT || 'pgr-services/v2/request/_create',
        pgrSearchEndpoint: process.env.PGR_SEARCH_ENDPOINT || 'pgr-services/v2/request/_search',
        swachCreateEndpoint: process.env.SWACH_CREATE_ENDPOINT || "swach-services/v2/request/_create",
        swachSearchEndpoint: process.env.SWACH_SEARCH_ENDPOINT || "swach-services/v2/request/_search",
        pgrv1CreateEndpoint: process.env.PGR_CREATE_ENDPOINT || 'rainmaker-pgr/v1/requests/_create',
        pgrv1SearchEndpoint: process.env.PGR_SEARCH_ENDPOINT || 'rainmaker-pgr/v1/requests/_search',
        waterConnectionSearch: process.env.WATER_CONNECTION_SEARCH || 'ws-services/wc/_search?searchType=CONNECTION',
        sewerageConnectionSearch: process.env.SEWERAGE_CONNECTION_SEARCH || 'sw-services/swc/_search?searchType=CONNECTION',
        nlpEngineHost: process.env.NLP_ENGINE_HOST || 'https://sandbox.digit.org/',
        cityFuzzySearch: process.env.CITY_FUZZY_SEARCH || 'nlp-engine/fuzzy/city',
        localityFuzzySearch: process.env.LOCALITY_FUZZY_SEARCH || 'nlp-engine/fuzzy/locality',

        cityExternalWebpagePath: process.env.CITY_EXTERNAL_WEBPAGE_PATH || 'citizen/openlink/whatsapp/city',
        localityExternalWebpagePath: process.env.LOCALITY_EXTERNAL_WEBPAGE_PATH || 'citizen/openlink/whatsapp/locality',
        receiptdownladlink: process.env.RECEIPT_DOWNLOAD_LINK || 'citizen/withoutAuth/egov-common/download-receipt?status=success&consumerCode=$consumercode&tenantId=$tenantId&receiptNumber=$receiptnumber&businessService=$businessservice&smsLink=true&mobileNo=$mobilenumber&channel=whatsapp&redirectNumber=+$whatsAppBussinessNumber&locale=$locale',
        msgpaylink: process.env.MSG_PAY_LINK || 'citizen/withoutAuth/egov-common/pay?consumerCode=$consumercode&tenantId=$tenantId&businessService=$businessservice&redirectNumber=$redirectNumber&channel=whatsapp&locale=$locale',
        wsOpenSearch: process.env.WS_OPEN_SEARCH || 'citizen/withoutAuth/wns/public-search',
        ptOpenSearch: process.env.PT_OPEN_SEARCH || 'citizen/withoutAuth/pt-mutation/public-search',
        attendanceEndpoint: process.env.ATTENDANCE_ENDPOINT || 'swach-services/v2/request/image/_create',
    },

    userService: {
        userLoginAuthorizationHeader: process.env.USER_LOGIN_AUTHORIZATION_HEADER || 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
        systemUserMobile: process.env.SYSTEM_USER_MOBILE || '9999999999',
    },

    pgrUseCase: {
        pgrVersion: process.env.PGR_VERSION || 'v2',
        complaintSearchLimit: process.env.COMPLAINT_SEARCH_LIMIT || 3,
        informationImageFilestoreId: process.env.INFORMATION_IMAGE_FILESTORE_ID || '5425a590-4105-4036-9769-e916c5176930',
        locationInstructionsUrl: process.env.LOCATION_INSTRUCTIONS_URL || 'https://cdn-icons-png.flaticon.com/512/535/535239.png',
        pgrUpdateTopic: process.env.PGR_UPDATE_TOPIC || 'update-pgr-request',
        geoSearch: process.env.GEO_SEARCH === 'false' ? false : true
    },

    swachUseCase: {
        complaintSearchLimit: process.env.COMPLAINT_SEARCH_LIMIT || 3,
        informationImageFilestoreId: process.env.INFORMATION_IMAGE_FILESTORE_ID || '5425a590-4105-4036-9769-e916c5176930',
        geoSearch: process.env.GEO_SEARCH === 'false' ? false : true
    },

    billsAndReceiptsUseCase: {
        billSearchLimit: process.env.BILL_SEARCH_LIMIT || 3,
        receiptSearchLimit: process.env.RECEIPT_SEARCH_LIMIT || 3,

        billSupportedModules: process.env.BILL_SUPPORTED_MODULES || 'WS, PT',

        paymentUpdateTopic: process.env.PAYMENT_UPDATE_TOPIC || 'egov.collection.payment-create',
        pgUpdateTransaction: process.env.PG_UPDATE_TRANSACTION || 'update-pg-txns',
        openSearchImageFilestoreId: process.env.OPEN_SEARCH_IMAGE_FILESTORE_ID || 'bd150c64-2188-44ba-b77e-3030475bddc8'
    },

}

module.exports = envVariables;
