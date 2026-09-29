package org.egov.userpreference.controller;

import org.egov.userpreference.support.ApiTestBase;
import org.junit.jupiter.api.Test;

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Every rejection path. The error codes and messages asserted here are the API
 * contract — they were emitted by the Go service and are what callers key on.
 */
class PreferenceValidationApiTest extends ApiTestBase {

    @Test
    void rejectsAnUpsertWithNoRequestInfo() throws Exception {
        String body = """
                {
                  "preference": {
                    "userId": "u1",
                    "preferenceCode": "USER_PROFILE",
                    "payload": { "k": "v" }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors", hasSize(1)))
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_REQUEST_INFO"))
                .andExpect(jsonPath("$.Errors[0].message").value("requestInfo is required"))
                // There is no RequestInfo to echo, so no responseInfo block.
                .andExpect(jsonPath("$.responseInfo").doesNotExist());
    }

    @Test
    void rejectsAnUpsertWithNoPreference() throws Exception {
        String body = """
                { "RequestInfo": { "apiId": "x", "msgId": "m1" } }
                """;

        upsert(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_REQUEST"))
                .andExpect(jsonPath("$.Errors[0].message").value("preference is required"))
                // Past the envelope check, so the request identifiers come back.
                .andExpect(jsonPath("$.responseInfo.status").value("failed"))
                .andExpect(jsonPath("$.responseInfo.apiId").value("x"))
                .andExpect(jsonPath("$.responseInfo.msgId").value("m1"));
    }

    @Test
    void rejectsAMissingUserId() throws Exception {
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "payload": { "test": "data" }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors", hasSize(1)))
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_USER_ID"))
                .andExpect(jsonPath("$.Errors[0].message").value("userId is required"));
    }

    @Test
    void rejectsAUserIdLongerThanTheColumn() throws Exception {
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "userId": "%s",
                    "preferenceCode": "USER_PROFILE",
                    "payload": { "k": "v" }
                  }
                }
                """.formatted("u".repeat(65));

        upsert(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors", hasSize(1)))
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_USER_ID"))
                .andExpect(jsonPath("$.Errors[0].message").value("userId must not exceed 64 characters"));
    }

    @Test
    void reportsBothFailuresForAnEmptyPreferenceCode() throws Exception {
        // An absent code is simultaneously missing and out of the 2..128
        // range. Both errors are returned, which is why the exception carries
        // an ordered list rather than a map keyed by code.
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "userId": "u1",
                    "payload": { "k": "v" }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors", hasSize(2)))
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_PREFERENCE_CODE"))
                .andExpect(jsonPath("$.Errors[0].message").value("preferenceCode is required"))
                .andExpect(jsonPath("$.Errors[1].code").value("INVALID_PREFERENCE_CODE"))
                .andExpect(jsonPath("$.Errors[1].message")
                        .value("preferenceCode must be between 2 and 128 characters"));
    }

    @Test
    void rejectsASingleCharacterPreferenceCode() throws Exception {
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "userId": "u1",
                    "preferenceCode": "X",
                    "payload": { "k": "v" }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors", hasSize(1)))
                .andExpect(jsonPath("$.Errors[0].message")
                        .value("preferenceCode must be between 2 and 128 characters"));
    }

    @Test
    void rejectsAMissingPayload() throws Exception {
        String body = """
                {
                  "RequestInfo": {},
                  "preference": { "userId": "u1", "preferenceCode": "USER_PROFILE" }
                }
                """;

        upsert(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors", hasSize(1)))
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_PAYLOAD"))
                .andExpect(jsonPath("$.Errors[0].message").value("payload is required"));
    }

    @Test
    void rejectsATenantIdShorterThanTwoCharacters() throws Exception {
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "userId": "u1",
                    "tenantId": "p",
                    "preferenceCode": "USER_PROFILE",
                    "payload": { "k": "v" }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_TENANT_ID"))
                .andExpect(jsonPath("$.Errors[0].message")
                        .value("tenantId must be between 2 and 64 characters"));
    }

    @Test
    void collectsEveryFieldFailureInOneResponse() throws Exception {
        String body = """
                {
                  "RequestInfo": {},
                  "preference": { "tenantId": "p" }
                }
                """;

        upsert(body)
                .andExpect(status().isBadRequest())
                // userId required, preferenceCode required, preferenceCode
                // length, payload required, tenantId length — in that order.
                .andExpect(jsonPath("$.Errors", hasSize(5)))
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_USER_ID"))
                .andExpect(jsonPath("$.Errors[1].code").value("INVALID_PREFERENCE_CODE"))
                .andExpect(jsonPath("$.Errors[2].code").value("INVALID_PREFERENCE_CODE"))
                .andExpect(jsonPath("$.Errors[3].code").value("INVALID_PAYLOAD"))
                .andExpect(jsonPath("$.Errors[4].code").value("INVALID_TENANT_ID"));
    }

    @Test
    void rejectsAnUnsupportedPreferredLanguage() throws Exception {
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "userId": "u1",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "payload": { "preferredLanguage": "ta_IN" }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_LANGUAGE"))
                .andExpect(jsonPath("$.Errors[0].message")
                        .value("preferredLanguage must be one of: en_IN, hi_IN, fr_IN, pt_IN; got: ta_IN"));
    }

    @Test
    void rejectsAConsentStatusThatIsNeitherGrantedNorRevoked() throws Exception {
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "userId": "u1",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "payload": { "consent": { "WHATSAPP": { "status": "MAYBE", "scope": "GLOBAL" } } }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_CONSENT_STATUS"))
                .andExpect(jsonPath("$.Errors[0].message")
                        .value("WHATSAPP consent status must be GRANTED or REVOKED; got: MAYBE"));
    }

    @Test
    void rejectsAnUnknownConsentScope() throws Exception {
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "userId": "u1",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "payload": { "consent": { "SMS": { "status": "GRANTED", "scope": "REGIONAL" } } }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_CONSENT_SCOPE"))
                .andExpect(jsonPath("$.Errors[0].message")
                        .value("SMS consent scope must be GLOBAL or TENANT; got: REGIONAL"));
    }

    @Test
    void requiresATenantIdOnTenantScopedConsent() throws Exception {
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "userId": "u1",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "payload": { "consent": { "EMAIL": { "status": "GRANTED", "scope": "TENANT" } } }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors[0].code").value("MISSING_TENANT_ID"))
                .andExpect(jsonPath("$.Errors[0].message")
                        .value("EMAIL consent with TENANT scope requires tenantId"));
    }

    @Test
    void reportsEveryChannelFailureInWhatsappSmsEmailOrder() throws Exception {
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "userId": "u1",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "payload": {
                      "preferredLanguage": "xx_XX",
                      "consent": {
                        "EMAIL": { "status": "NOPE" },
                        "WHATSAPP": { "status": "NOPE" },
                        "SMS": { "scope": "NOPE" }
                      }
                    }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors", hasSize(4)))
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_LANGUAGE"))
                .andExpect(jsonPath("$.Errors[1].message")
                        .value("WHATSAPP consent status must be GRANTED or REVOKED; got: NOPE"))
                .andExpect(jsonPath("$.Errors[2].message")
                        .value("SMS consent scope must be GLOBAL or TENANT; got: NOPE"))
                .andExpect(jsonPath("$.Errors[3].message")
                        .value("EMAIL consent status must be GRANTED or REVOKED; got: NOPE"));
    }

    @Test
    void rejectsANotificationPayloadThatIsNotAnObject() throws Exception {
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "userId": "u1",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "payload": [ "en_IN" ]
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_PAYLOAD_FORMAT"))
                .andExpect(jsonPath("$.Errors[0].message")
                        .value("payload must match USER_NOTIFICATION_PREFERENCES schema"));
    }

    @Test
    void rejectsANumericConsentStatusRatherThanCoercingIt() throws Exception {
        // Jackson would happily widen 5 to "5"; Go's json.Unmarshal would not.
        // Coercion is switched off on the payload mapper so the failure stays
        // INVALID_PAYLOAD_FORMAT.
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "userId": "u1",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "payload": { "consent": { "WHATSAPP": { "status": 5 } } }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_PAYLOAD_FORMAT"));
    }

    @Test
    void rejectsANonStringPreferredLanguage() throws Exception {
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "userId": "u1",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "payload": { "preferredLanguage": true }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_PAYLOAD_FORMAT"));
    }

    @Test
    void rejectsAConsentBlockThatIsNotAnObject() throws Exception {
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "userId": "u1",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "payload": { "consent": "GRANTED" }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_PAYLOAD_FORMAT"));
    }

    @Test
    void acceptsAnExplicitlyNullConsentBlock() throws Exception {
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "userId": "u1",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "payload": { "preferredLanguage": "en_IN", "consent": null }
                  }
                }
                """;

        upsert(body).andExpect(status().isOk());
    }

    @Test
    void rejectsASearchWithNoRequestInfo() throws Exception {
        String body = """
                { "criteria": { "userId": "u1" } }
                """;

        search(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_REQUEST_INFO"))
                .andExpect(jsonPath("$.responseInfo").doesNotExist());
    }

    @Test
    void rejectsASearchWithNoCriteria() throws Exception {
        String body = """
                { "RequestInfo": { "msgId": "m2" } }
                """;

        search(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_REQUEST"))
                .andExpect(jsonPath("$.Errors[0].message").value("criteria is required"))
                .andExpect(jsonPath("$.responseInfo.status").value("failed"));
    }

    @Test
    void refusesAnUnboundedSearch() throws Exception {
        String body = """
                {
                  "RequestInfo": {},
                  "criteria": { "limit": 10 }
                }
                """;

        search(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_CRITERIA"))
                .andExpect(jsonPath("$.Errors[0].message")
                        .value("at least one search criteria (userId, tenantId, or preferenceCode) is required"));
    }

    @Test
    void rejectsANegativeLimitAndOffsetTogether() throws Exception {
        String body = """
                {
                  "RequestInfo": {},
                  "criteria": { "userId": "u1", "limit": -1, "offset": -5 }
                }
                """;

        search(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors", hasSize(2)))
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_LIMIT"))
                .andExpect(jsonPath("$.Errors[0].message").value("limit must be non-negative"))
                .andExpect(jsonPath("$.Errors[1].code").value("INVALID_OFFSET"))
                .andExpect(jsonPath("$.Errors[1].message").value("offset must be non-negative"));
    }

    @Test
    void rejectsAMalformedJsonBody() throws Exception {
        upsert("{ \"RequestInfo\": {}, ")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_JSON"))
                .andExpect(jsonPath("$.Errors[0].message").value("Invalid JSON format"))
                .andExpect(jsonPath("$.responseInfo").doesNotExist());
    }

    @Test
    void rejectsAnEmptyBody() throws Exception {
        upsert("")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_JSON"));
    }

    @Test
    void rejectsACallerSuppliedIdThatIsNotAUuid() throws Exception {
        // The honoured id binds straight into CAST(? AS uuid); without this
        // check the driver's conversion error surfaced as a 500.
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "id": "not-a-uuid",
                    "userId": "u1",
                    "preferenceCode": "USER_PROFILE",
                    "payload": { "k": "v" }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_ID"))
                .andExpect(jsonPath("$.Errors[0].message").value("id must be a valid UUID"));
    }

    @Test
    void rejectsAShortGroupIdThatJavaWouldAcceptButPostgresWouldNot() throws Exception {
        // UUID.fromString zero-pads short groups, so "1-2-3-4-5" parses to
        // 00000001-0002-0003-0004-000000000005. PostgreSQL rejects that
        // spelling, so a parse-based check let it through to CAST(? AS uuid)
        // and the 500 came back anyway.
        for (String id : new String[]{"1-2-3-4-5", "abc-def-1-2-3"}) {
            String body = """
                    {
                      "RequestInfo": {},
                      "preference": {
                        "id": "%s",
                        "userId": "u-short-group",
                        "preferenceCode": "USER_PROFILE",
                        "payload": { "k": "v" }
                      }
                    }
                    """.formatted(id);

            upsert(body)
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.Errors[0].code").value("INVALID_ID"));
        }
    }

    @Test
    void acceptsAWellFormedCallerSuppliedId() throws Exception {
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "id": "11111111-2222-3333-4444-555555555555",
                    "userId": "u-valid-id",
                    "preferenceCode": "USER_PROFILE",
                    "payload": { "k": "v" }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences[0].id").value("11111111-2222-3333-4444-555555555555"));
    }

    @Test
    void validatesALowerCasedConsentBlockJustAsGoDid() throws Exception {
        // encoding/json matched keys case-insensitively, so Go reported both
        // of these. A case-sensitive payload mapper would have let them
        // through and stored an invalid status.
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "userId": "u1",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "payload": { "consent": { "sms": { "status": "MAYBE", "scope": "REGIONAL" } } }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors", hasSize(2)))
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_CONSENT_STATUS"))
                .andExpect(jsonPath("$.Errors[1].code").value("INVALID_CONSENT_SCOPE"));
    }

    @Test
    void validatesALowerCasedPreferredLanguageKey() throws Exception {
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "userId": "u1",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "payload": { "preferredlanguage": "ta_IN" }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_LANGUAGE"));
    }

    @Test
    void doesNotLeakTheDatabaseErrorTextOnAnInternalFailure() throws Exception {
        // A duplicate id forces a constraint violation. The response must not
        // carry the index, constraint or column names the driver reports.
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "id": "99999999-9999-9999-9999-999999999999",
                    "userId": "dup-a",
                    "preferenceCode": "USER_PROFILE",
                    "payload": { "k": "v" }
                  }
                }
                """;
        upsert(body).andExpect(status().isOk());

        String clash = body.replace("dup-a", "dup-b");
        upsert(clash)
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.Errors[0].code").value("INTERNAL_ERROR"))
                .andExpect(jsonPath("$.Errors[0].message").value("failed to save preference"));
    }

    @Test
    void doesNotLeakTheParserMessageOnAMalformedBody() throws Exception {
        upsert("{ \"RequestInfo\": {}, ")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors[0].code").value("INVALID_JSON"))
                .andExpect(jsonPath("$.Errors[0].message").value("Invalid JSON format"));
    }
}
