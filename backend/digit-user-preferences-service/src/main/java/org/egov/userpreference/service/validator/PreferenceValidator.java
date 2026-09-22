package org.egov.userpreference.service.validator;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.cfg.CoercionAction;
import com.fasterxml.jackson.databind.cfg.CoercionInputShape;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.type.LogicalType;
import lombok.extern.slf4j.Slf4j;
import org.egov.userpreference.config.ApplicationConfig;
import org.egov.userpreference.utils.CustomException;
import org.egov.userpreference.utils.ErrorCodes;
import org.egov.userpreference.utils.StringUtil;
import org.egov.userpreference.web.model.Channel;
import org.egov.userpreference.web.model.Consent;
import org.egov.userpreference.web.model.ConsentPolicy;
import org.egov.userpreference.web.model.ConsentScope;
import org.egov.userpreference.web.model.ConsentStatus;
import org.egov.userpreference.web.model.ErrorResponse;
import org.egov.userpreference.web.model.Preference;
import org.egov.userpreference.web.model.PreferenceCriteria;
import org.egov.userpreference.web.model.PreferencePayload;
import org.egov.userpreference.web.model.RequestInfo;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Input validation for the two preference endpoints.
 *
 * <p>Every check below, its error code, its message wording and the order the
 * failures are collected in are the Go service's, because they are the API
 * contract. Notably a single field can contribute more than one error — an
 * empty {@code preferenceCode} is both missing and out of the 2..128 range —
 * and all of them are returned together.
 */
@Component
@Slf4j
public class PreferenceValidator {

    /** The one {@code preferenceCode} whose payload has a known schema. */
    public static final String USER_NOTIFICATION_PREFERENCES = "USER_NOTIFICATION_PREFERENCES";

    // These bounds mirror the column widths in
    // db/migration/main/V20260205120000__create_user_preference.sql —
    // user_id varchar(64), preference_code varchar(128), tenant_id varchar(64).
    // They are checked here so an over-long value is a 400 rather than a 500
    // from the driver, which means widening a column in a future migration
    // must widen the matching constant too or the old bound silently stands.
    private static final int USER_ID_MAX_LENGTH = 64;
    private static final int PREFERENCE_CODE_MIN_LENGTH = 2;
    private static final int PREFERENCE_CODE_MAX_LENGTH = 128;
    private static final int TENANT_ID_MIN_LENGTH = 2;
    private static final int TENANT_ID_MAX_LENGTH = 64;

    private static final Pattern CANONICAL_UUID = Pattern.compile(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

    private final ApplicationConfig applicationConfig;

    /**
     * Parses the notification payload for validation only.
     *
     * <p>Scalar coercion is switched off so that a non-string where a string
     * belongs ({@code "status": 5}, {@code "preferredLanguage": true}) fails
     * the parse and surfaces as {@code INVALID_PAYLOAD_FORMAT}, which is what
     * Go's {@code json.Unmarshal} did. Jackson would otherwise quietly widen
     * {@code 5} to {@code "5"} and report a different error code downstream.
     * Unknown keys stay ignored, also matching Go.
     *
     * <p>Key matching is case-insensitive for the same reason the service-wide
     * mapper is: {@code encoding/json} matched keys that way, so Go validated
     * a {@code "sms"} consent block just as it did {@code "SMS"}. This mapper
     * is built by hand and would not otherwise pick up
     * {@code spring.jackson.mapper.accept-case-insensitive-properties}, which
     * would let a lower-cased channel carry an invalid status past validation
     * and into the table.
     */
    private final ObjectMapper payloadMapper;

    public PreferenceValidator(ApplicationConfig applicationConfig) {
        this.applicationConfig = applicationConfig;
        this.payloadMapper = JsonMapper.builder()
                .enable(MapperFeature.ACCEPT_CASE_INSENSITIVE_PROPERTIES)
                .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                .build();
        this.payloadMapper.coercionConfigFor(LogicalType.Textual)
                .setCoercion(CoercionInputShape.Integer, CoercionAction.Fail)
                .setCoercion(CoercionInputShape.Float, CoercionAction.Fail)
                .setCoercion(CoercionInputShape.Boolean, CoercionAction.Fail);
    }

    /** The request envelope must carry a {@code RequestInfo} block, even an empty one. */
    public void validateRequestInfo(RequestInfo requestInfo) {
        if (requestInfo == null) {
            throw CustomException.validation(ErrorCodes.INVALID_REQUEST_INFO, "requestInfo is required", null);
        }
    }

    /** Field-level checks for an upsert. Collects every failure before throwing. */
    public void validatePreference(Preference preference, RequestInfo requestInfo) {
        List<ErrorResponse.Error> errors = new ArrayList<>();

        if (StringUtil.isEmpty(preference.getUserId())) {
            errors.add(CustomException.error(ErrorCodes.INVALID_USER_ID, "userId is required"));
        }
        if (StringUtil.length(preference.getUserId()) > USER_ID_MAX_LENGTH) {
            errors.add(CustomException.error(ErrorCodes.INVALID_USER_ID,
                    "userId must not exceed " + USER_ID_MAX_LENGTH + " characters"));
        }

        if (StringUtil.isEmpty(preference.getPreferenceCode())) {
            errors.add(CustomException.error(ErrorCodes.INVALID_PREFERENCE_CODE, "preferenceCode is required"));
        }
        int preferenceCodeLength = StringUtil.length(preference.getPreferenceCode());
        if (preferenceCodeLength < PREFERENCE_CODE_MIN_LENGTH || preferenceCodeLength > PREFERENCE_CODE_MAX_LENGTH) {
            errors.add(CustomException.error(ErrorCodes.INVALID_PREFERENCE_CODE,
                    "preferenceCode must be between " + PREFERENCE_CODE_MIN_LENGTH
                            + " and " + PREFERENCE_CODE_MAX_LENGTH + " characters"));
        }

        if (preference.getPayload() == null) {
            errors.add(CustomException.error(ErrorCodes.INVALID_PAYLOAD, "payload is required"));
        }

        // A caller-supplied id is honoured on create and binds into
        // CAST(? AS uuid). Rejecting a malformed one here keeps it a 400
        // rather than the 500 the driver's conversion error would produce.
        if (StringUtil.isNotEmpty(preference.getId()) && isNotUuid(preference.getId())) {
            errors.add(CustomException.error(ErrorCodes.INVALID_ID, "id must be a valid UUID"));
        }

        int tenantIdLength = StringUtil.length(preference.getTenantId());
        if (StringUtil.isNotEmpty(preference.getTenantId())
                && (tenantIdLength < TENANT_ID_MIN_LENGTH || tenantIdLength > TENANT_ID_MAX_LENGTH)) {
            errors.add(CustomException.error(ErrorCodes.INVALID_TENANT_ID,
                    "tenantId must be between " + TENANT_ID_MIN_LENGTH
                            + " and " + TENANT_ID_MAX_LENGTH + " characters"));
        }

        if (!errors.isEmpty()) {
            throw CustomException.validation(errors, requestInfo);
        }
    }

    /**
     * Schema checks for a {@code USER_NOTIFICATION_PREFERENCES} payload. Any
     * other {@code preferenceCode} stores an arbitrary document unchecked.
     */
    public void validateNotificationPayload(JsonNode payload, RequestInfo requestInfo) {
        PreferencePayload parsed;
        try {
            parsed = payloadMapper.treeToValue(payload, PreferencePayload.class);
        } catch (Exception e) {
            log.debug("Rejecting {} payload that does not match the schema", USER_NOTIFICATION_PREFERENCES, e);
            throw CustomException.validation(ErrorCodes.INVALID_PAYLOAD_FORMAT,
                    "payload must match " + USER_NOTIFICATION_PREFERENCES + " schema", requestInfo);
        }

        // A literal `null` payload parses to no payload at all, which Go read
        // as "nothing to check" rather than as a malformed document.
        if (parsed == null) {
            return;
        }

        List<ErrorResponse.Error> errors = new ArrayList<>();

        Set<String> validLanguages = applicationConfig.getValidLanguageSet();
        String language = parsed.getPreferredLanguage();
        if (StringUtil.isNotEmpty(language) && !validLanguages.isEmpty() && !validLanguages.contains(language)) {
            errors.add(CustomException.error(ErrorCodes.INVALID_LANGUAGE,
                    "preferredLanguage must be one of: " + applicationConfig.getValidLanguagesMessage()
                            + "; got: " + language));
        }

        if (parsed.getConsent() != null) {
            errors.addAll(validateConsent(parsed.getConsent()));
        }

        if (!errors.isEmpty()) {
            throw CustomException.validation(errors, requestInfo);
        }
    }

    /** Search criteria checks. */
    public void validateCriteria(PreferenceCriteria criteria, RequestInfo requestInfo) {
        List<ErrorResponse.Error> errors = new ArrayList<>();

        if (StringUtil.isEmpty(criteria.getUserId())
                && StringUtil.isEmpty(criteria.getTenantId())
                && StringUtil.isEmpty(criteria.getPreferenceCode())) {
            errors.add(CustomException.error(ErrorCodes.INVALID_CRITERIA,
                    "at least one search criteria (userId, tenantId, or preferenceCode) is required"));
        }

        if (criteria.getLimit() != null && criteria.getLimit() < 0) {
            errors.add(CustomException.error(ErrorCodes.INVALID_LIMIT, "limit must be non-negative"));
        }

        if (criteria.getOffset() != null && criteria.getOffset() < 0) {
            errors.add(CustomException.error(ErrorCodes.INVALID_OFFSET, "offset must be non-negative"));
        }

        if (!errors.isEmpty()) {
            throw CustomException.validation(errors, requestInfo);
        }
    }

    /** Channels are checked in WHATSAPP, SMS, EMAIL order so error lists stay stable. */
    private List<ErrorResponse.Error> validateConsent(Consent consent) {
        List<ErrorResponse.Error> errors = new ArrayList<>();
        errors.addAll(validatePolicy(Channel.WHATSAPP, consent.getWhatsApp()));
        errors.addAll(validatePolicy(Channel.SMS, consent.getSms()));
        errors.addAll(validatePolicy(Channel.EMAIL, consent.getEmail()));
        return errors;
    }

    /**
     * True unless the value is a canonical 8-4-4-4-12 UUID.
     *
     * <p>{@code UUID.fromString} is not usable as the test: it zero-pads short
     * groups, so it accepts {@code 1-2-3-4-5} and hands back
     * {@code 00000001-0002-0003-0004-000000000005}. PostgreSQL rejects that
     * spelling outright, so the lenient check let the value through to
     * {@code CAST(? AS uuid)} and the 500 this validation exists to prevent
     * came back anyway.
     */
    private static boolean isNotUuid(String value) {
        return !CANONICAL_UUID.matcher(value).matches();
    }

    private List<ErrorResponse.Error> validatePolicy(Channel channel, ConsentPolicy policy) {
        if (policy == null) {
            return List.of();
        }

        List<ErrorResponse.Error> errors = new ArrayList<>();

        String status = policy.getStatus();
        if (StringUtil.isNotEmpty(status) && !ConsentStatus.isValid(status)) {
            errors.add(CustomException.error(ErrorCodes.INVALID_CONSENT_STATUS,
                    channel + " consent status must be " + ConsentStatus.GRANTED
                            + " or " + ConsentStatus.REVOKED + "; got: " + status));
        }

        String scope = policy.getScope();
        if (StringUtil.isNotEmpty(scope) && !ConsentScope.isValid(scope)) {
            errors.add(CustomException.error(ErrorCodes.INVALID_CONSENT_SCOPE,
                    channel + " consent scope must be " + ConsentScope.GLOBAL
                            + " or " + ConsentScope.TENANT + "; got: " + scope));
        }

        if (ConsentScope.TENANT.name().equals(scope) && StringUtil.isEmpty(policy.getTenantId())) {
            errors.add(CustomException.error(ErrorCodes.MISSING_TENANT_ID,
                    channel + " consent with " + ConsentScope.TENANT + " scope requires tenantId"));
        }

        return errors;
    }
}
