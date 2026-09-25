package org.egov.userpreference.utils;

/**
 * Error codes on the wire. Everything except {@link #INVALID_ID} and
 * {@link #NOT_AUTHORIZED} was emitted by the Go service and is part of the
 * API contract, so none of those may be renamed without a consumer-side
 * change. The two additions replace failure modes the Go service answered
 * with a 500 and a silent success respectively.
 */
public final class ErrorCodes {

    public static final String INVALID_JSON = "INVALID_JSON";
    public static final String INVALID_REQUEST = "INVALID_REQUEST";
    public static final String INVALID_REQUEST_INFO = "INVALID_REQUEST_INFO";
    public static final String INVALID_ID = "INVALID_ID";
    public static final String INVALID_USER_ID = "INVALID_USER_ID";
    public static final String NOT_AUTHORIZED = "NOT_AUTHORIZED";
    public static final String INVALID_TENANT_ID = "INVALID_TENANT_ID";
    public static final String INVALID_PREFERENCE_CODE = "INVALID_PREFERENCE_CODE";
    public static final String INVALID_PAYLOAD = "INVALID_PAYLOAD";
    public static final String INVALID_PAYLOAD_FORMAT = "INVALID_PAYLOAD_FORMAT";
    public static final String INVALID_LANGUAGE = "INVALID_LANGUAGE";
    public static final String INVALID_CONSENT_STATUS = "INVALID_CONSENT_STATUS";
    public static final String INVALID_CONSENT_SCOPE = "INVALID_CONSENT_SCOPE";
    public static final String MISSING_TENANT_ID = "MISSING_TENANT_ID";
    public static final String INVALID_CRITERIA = "INVALID_CRITERIA";
    public static final String INVALID_LIMIT = "INVALID_LIMIT";
    public static final String INVALID_OFFSET = "INVALID_OFFSET";
    public static final String INVALID_FIELD = "INVALID_FIELD";
    public static final String INTERNAL_ERROR = "INTERNAL_ERROR";

    private ErrorCodes() {
    }
}
