package org.egov.userpreference.service.validator;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.userpreference.config.ApplicationConfig;
import org.egov.userpreference.utils.CustomException;
import org.egov.userpreference.web.model.Preference;
import org.egov.userpreference.web.model.PreferenceCriteria;
import org.egov.userpreference.web.model.RequestInfo;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class PreferenceValidatorTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private PreferenceValidator validator;

    @BeforeEach
    void setUp() {
        ApplicationConfig config = new ApplicationConfig();
        config.setValidLanguages(List.of("en_IN", "hi_IN", "fr_IN", "pt_IN"));
        validator = new PreferenceValidator(config);
    }

    private Preference preference(String userId, String tenantId, String code, String payloadJson) {
        try {
            return Preference.builder()
                    .userId(userId)
                    .tenantId(tenantId)
                    .preferenceCode(code)
                    .payload(payloadJson == null ? null : MAPPER.readTree(payloadJson))
                    .build();
        } catch (Exception e) {
            throw new IllegalArgumentException(e);
        }
    }

    private List<String> codesFrom(CustomException e) {
        return e.getErrors().stream().map(err -> err.getCode()).toList();
    }

    @Test
    void acceptsAFullyPopulatedPreference() {
        assertDoesNotThrow(() -> validator.validatePreference(
                preference("u1", "pg.citya", "USER_NOTIFICATION_PREFERENCES", "{\"k\":\"v\"}"), null));
    }

    @Test
    void acceptsAPreferenceWithNoTenant() {
        assertDoesNotThrow(() -> validator.validatePreference(
                preference("u1", null, "USER_PROFILE", "{}"), null));
    }

    @Test
    void acceptsAnEmptyJsonObjectAsAPayload() {
        // `{}` is two bytes in Go and so passed the len() > 0 check; the
        // equivalent here is "present", not "non-empty".
        assertDoesNotThrow(() -> validator.validatePreference(
                preference("u1", null, "USER_PROFILE", "{}"), null));
    }

    @Test
    void reportsTheMissingFieldsInAFixedOrder() {
        CustomException e = assertThrows(CustomException.class,
                () -> validator.validatePreference(preference(null, "p", null, null), null));

        assertEquals(List.of("INVALID_USER_ID", "INVALID_PREFERENCE_CODE", "INVALID_PREFERENCE_CODE",
                "INVALID_PAYLOAD", "INVALID_TENANT_ID"), codesFrom(e));
        assertEquals(HttpStatus.BAD_REQUEST, e.getHttpStatus());
    }

    @Test
    void acceptsAUserIdOfExactlySixtyFourCharacters() {
        assertDoesNotThrow(() -> validator.validatePreference(
                preference("u".repeat(64), null, "USER_PROFILE", "{}"), null));
    }

    @Test
    void rejectsAUserIdOfSixtyFiveCharacters() {
        CustomException e = assertThrows(CustomException.class, () -> validator.validatePreference(
                preference("u".repeat(65), null, "USER_PROFILE", "{}"), null));
        assertEquals(List.of("INVALID_USER_ID"), codesFrom(e));
    }

    @Test
    void measuresLengthBeforeTrimmingSoAPaddedUserIdStillOverflows() {
        // The Go validator ran on the raw value and the enricher trimmed
        // afterwards, so a 66-character value that would trim to 64 is still
        // rejected. Keeping that order matters: the column is 64 wide, and a
        // caller padding its input should hear about it.
        CustomException e = assertThrows(CustomException.class, () -> validator.validatePreference(
                preference(" " + "u".repeat(64) + " ", null, "USER_PROFILE", "{}"), null));
        assertEquals(List.of("INVALID_USER_ID"), codesFrom(e));
    }

    @Test
    void acceptsAPreferenceCodeAtBothEndsOfTheRange() {
        assertDoesNotThrow(() -> validator.validatePreference(
                preference("u1", null, "AB", "{}"), null));
        assertDoesNotThrow(() -> validator.validatePreference(
                preference("u1", null, "C".repeat(128), "{}"), null));
    }

    @Test
    void rejectsAPreferenceCodeOverOneHundredAndTwentyEight() {
        CustomException e = assertThrows(CustomException.class, () -> validator.validatePreference(
                preference("u1", null, "C".repeat(129), "{}"), null));
        assertEquals(List.of("INVALID_PREFERENCE_CODE"), codesFrom(e));
    }

    @Test
    void acceptsATenantIdAtBothEndsOfTheRange() {
        assertDoesNotThrow(() -> validator.validatePreference(
                preference("u1", "pg", "USER_PROFILE", "{}"), null));
        assertDoesNotThrow(() -> validator.validatePreference(
                preference("u1", "t".repeat(64), "USER_PROFILE", "{}"), null));
    }

    @Test
    void rejectsATenantIdOverSixtyFour() {
        CustomException e = assertThrows(CustomException.class, () -> validator.validatePreference(
                preference("u1", "t".repeat(65), "USER_PROFILE", "{}"), null));
        assertEquals(List.of("INVALID_TENANT_ID"), codesFrom(e));
    }

    @Test
    void requiresARequestInfoBlock() {
        CustomException e = assertThrows(CustomException.class, () -> validator.validateRequestInfo(null));
        assertEquals(List.of("INVALID_REQUEST_INFO"), codesFrom(e));
    }

    @Test
    void acceptsAnEmptyRequestInfoBlock() {
        assertDoesNotThrow(() -> validator.validateRequestInfo(RequestInfo.builder().build()));
    }

    @Test
    void acceptsEveryConfiguredLanguage() throws Exception {
        for (String language : List.of("en_IN", "hi_IN", "fr_IN", "pt_IN")) {
            String payload = "{\"preferredLanguage\":\"" + language + "\"}";
            assertDoesNotThrow(() -> validator.validateNotificationPayload(MAPPER.readTree(payload), null),
                    language + " should be accepted");
        }
    }

    @Test
    void rejectsAnUnknownLanguageAndEchoesIt() throws Exception {
        CustomException e = assertThrows(CustomException.class, () -> validator.validateNotificationPayload(
                MAPPER.readTree("{\"preferredLanguage\":\"de_DE\"}"), null));
        assertEquals("INVALID_LANGUAGE", e.getErrors().get(0).getCode());
        assertEquals("preferredLanguage must be one of: en_IN, hi_IN, fr_IN, pt_IN; got: de_DE",
                e.getErrors().get(0).getMessage());
    }

    @Test
    void treatsAnEmptyLanguageAsUnset() throws Exception {
        assertDoesNotThrow(() -> validator.validateNotificationPayload(
                MAPPER.readTree("{\"preferredLanguage\":\"\"}"), null));
    }

    @Test
    void acceptsAConsentPolicyWithNeitherStatusNorScope() throws Exception {
        assertDoesNotThrow(() -> validator.validateNotificationPayload(
                MAPPER.readTree("{\"consent\":{\"SMS\":{}}}"), null));
    }

    @Test
    void acceptsTenantScopedConsentThatNamesItsTenant() throws Exception {
        assertDoesNotThrow(() -> validator.validateNotificationPayload(MAPPER.readTree(
                "{\"consent\":{\"SMS\":{\"status\":\"GRANTED\",\"scope\":\"TENANT\",\"tenantId\":\"pg.citya\"}}}"),
                null));
    }

    @Test
    void ignoresChannelsOutsideTheKnownThree() throws Exception {
        assertDoesNotThrow(() -> validator.validateNotificationPayload(
                MAPPER.readTree("{\"consent\":{\"PUSH\":{\"status\":\"WHATEVER\"}}}"), null));
    }

    @Test
    void treatsALiteralNullPayloadAsNothingToCheck() throws Exception {
        assertDoesNotThrow(() -> validator.validateNotificationPayload(MAPPER.readTree("null"), null));
    }

    @Test
    void rejectsAScalarPayload() throws Exception {
        CustomException e = assertThrows(CustomException.class, () -> validator.validateNotificationPayload(
                MAPPER.readTree("\"en_IN\""), null));
        assertEquals("INVALID_PAYLOAD_FORMAT", e.getErrors().get(0).getCode());
    }

    @Test
    void requiresAtLeastOneSearchCriterion() {
        CustomException e = assertThrows(CustomException.class,
                () -> validator.validateCriteria(PreferenceCriteria.builder().build(), null));
        assertEquals(List.of("INVALID_CRITERIA"), codesFrom(e));
    }

    @Test
    void acceptsAnyOneSearchCriterionOnItsOwn() {
        assertDoesNotThrow(() -> validator.validateCriteria(
                PreferenceCriteria.builder().userId("u1").build(), null));
        assertDoesNotThrow(() -> validator.validateCriteria(
                PreferenceCriteria.builder().tenantId("pg").build(), null));
        assertDoesNotThrow(() -> validator.validateCriteria(
                PreferenceCriteria.builder().preferenceCode("USER_PROFILE").build(), null));
    }

    @Test
    void acceptsAnAbsentLimitAndOffset() {
        assertDoesNotThrow(() -> validator.validateCriteria(
                PreferenceCriteria.builder().userId("u1").build(), null));
    }

    @Test
    void acceptsAnExplicitZeroLimitAndOffset() {
        assertDoesNotThrow(() -> validator.validateCriteria(
                PreferenceCriteria.builder().userId("u1").limit(0).offset(0).build(), null));
    }

    @Test
    void rejectsNegativePaging() {
        CustomException e = assertThrows(CustomException.class, () -> validator.validateCriteria(
                PreferenceCriteria.builder().userId("u1").limit(-1).offset(-1).build(), null));
        assertEquals(List.of("INVALID_LIMIT", "INVALID_OFFSET"), codesFrom(e));
    }

    @Test
    void carriesTheRequestInfoOntoTheException() {
        RequestInfo requestInfo = RequestInfo.builder().msgId("m1").build();
        CustomException e = assertThrows(CustomException.class,
                () -> validator.validateCriteria(PreferenceCriteria.builder().build(), requestInfo));
        assertEquals(requestInfo, e.getRequestInfo());
    }
}
