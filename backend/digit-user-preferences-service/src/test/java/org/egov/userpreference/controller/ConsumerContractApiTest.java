package org.egov.userpreference.controller;

import com.fasterxml.jackson.databind.JsonNode;
import org.egov.userpreference.support.ApiTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Compatibility with the callers that exist today.
 *
 * <p>The bodies below are copied from the real consumers rather than
 * paraphrased, because the thing under test is the wire contract: Go matched
 * JSON keys case-insensitively and the callers drifted apart as a result —
 * novu-bridge's {@code PreferenceServiceClient} posts {@code requestInfo},
 * {@code local-setup/scripts/seed-test-account-preferences.py} posts
 * {@code RequestInfo}.
 */
class ConsumerContractApiTest extends ApiTestBase {

    @Test
    void acceptsTheLowerCamelRequestInfoThatNovuBridgeSends() throws Exception {
        String body = """
                {
                  "requestInfo": {},
                  "criteria": {
                    "userId": "dd1c8776-6031-4f5a-aa0e-a015ddce1153",
                    "tenantId": "pg.citya",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "limit": 1,
                    "offset": 0
                  }
                }
                """;

        search(body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.responseInfo.status").value("successful"))
                .andExpect(jsonPath("$.preferences", hasSize(0)));
    }

    @Test
    void acceptsTheCapitalisedRequestInfoThatTheSeedScriptSends() throws Exception {
        String body = """
                {
                  "RequestInfo": { "apiId": "seed" },
                  "preference": {
                    "userId": "dd1c8776-6031-4f5a-aa0e-a015ddce1153",
                    "tenantId": "ke.bomet",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "payload": {
                      "preferredLanguage": "hi_IN",
                      "consent": {
                        "WHATSAPP": { "status": "GRANTED", "scope": "GLOBAL" },
                        "SMS": { "status": "GRANTED", "scope": "GLOBAL" },
                        "EMAIL": { "status": "GRANTED", "scope": "GLOBAL" }
                      }
                    }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences[0].payload.preferredLanguage").value("hi_IN"));
    }

    @Test
    void toleratesTheKeyCasingGoMatchedLoosely() throws Exception {
        String body = """
                {
                  "REQUESTINFO": {},
                  "PREFERENCE": {
                    "USERID": "casing-user",
                    "tenantid": "pg.citya",
                    "PreferenceCode": "USER_PROFILE",
                    "Payload": { "k": "v" }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences[0].userId").value("casing-user"))
                .andExpect(jsonPath("$.preferences[0].tenantId").value("pg.citya"));
    }

    @Test
    void ignoresFieldsItDoesNotKnowAbout() throws Exception {
        String body = """
                {
                  "RequestInfo": {
                    "apiId": "x",
                    "plainAccessRequest": { "recordId": "r1", "plainRequestFields": ["mobileNumber"] },
                    "somethingNew": true
                  },
                  "preference": {
                    "userId": "tolerant-user",
                    "preferenceCode": "USER_PROFILE",
                    "payload": { "k": "v" },
                    "unexpected": "ignored"
                  }
                }
                """;

        upsert(body).andExpect(status().isOk());
    }

    @Test
    void servesTheConsentShapeNovuBridgeReadsBackFromASearch() throws Exception {
        // PreferenceServiceClient.isChannelAllowed walks
        // preferences[0].payload.consent.<CHANNEL>.status and treats anything
        // it cannot reach as a denial, so each hop has to be present.
        String upsertBody = """
                {
                  "requestInfo": {},
                  "preference": {
                    "userId": "gate-user",
                    "tenantId": "ke.bomet",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "payload": {
                      "preferredLanguage": "en_IN",
                      "consent": {
                        "WHATSAPP": { "status": "GRANTED", "scope": "GLOBAL" },
                        "SMS": { "status": "REVOKED", "scope": "GLOBAL" }
                      }
                    }
                  }
                }
                """;
        upsert(upsertBody).andExpect(status().isOk());

        String searchBody = """
                {
                  "requestInfo": {},
                  "criteria": {
                    "userId": "gate-user",
                    "tenantId": "ke.bomet",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "limit": 1,
                    "offset": 0
                  }
                }
                """;

        MvcResult result = search(searchBody).andExpect(status().isOk()).andReturn();
        JsonNode body = json(result);

        JsonNode preferences = body.get("preferences");
        assertTrue(preferences.isArray(), "novu-bridge casts `preferences` to a List");
        assertEquals(1, preferences.size());

        JsonNode payload = preferences.get(0).get("payload");
        assertTrue(payload.isObject(), "novu-bridge casts `payload` to a Map");

        JsonNode consent = payload.get("consent");
        assertEquals("GRANTED", consent.at("/WHATSAPP/status").asText());
        assertEquals("GLOBAL", consent.at("/WHATSAPP/scope").asText());
        assertEquals("REVOKED", consent.at("/SMS/status").asText());

        // The allowlist projection in novu-bridge's PreferenceController lifts
        // these four out of each record.
        assertTrue(preferences.get(0).has("userId"));
        assertTrue(preferences.get(0).has("tenantId"));
        assertTrue(payload.has("preferredLanguage"));
        assertTrue(payload.has("consent"));
    }

    @Test
    void emitsTheEnvelopeKeysInTheCasingCallersExpect() throws Exception {
        String body = """
                {
                  "RequestInfo": { "apiId": "x" },
                  "criteria": { "userId": "nobody" }
                }
                """;

        String raw = search(body).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();

        // Lower-camel responseInfo, not the capitalised ResponseInfo that
        // digit-config-service emits.
        assertTrue(raw.contains("\"responseInfo\""), raw);
        assertFalse(raw.contains("\"ResponseInfo\""), raw);
        assertTrue(raw.contains("\"preferences\""), raw);
        assertTrue(raw.contains("\"pagination\""), raw);
    }

    @Test
    void emitsACapitalisedErrorsListOnFailure() throws Exception {
        String raw = search("{\"RequestInfo\":{},\"criteria\":{}}")
                .andExpect(status().isBadRequest())
                .andReturn().getResponse().getContentAsString();

        assertTrue(raw.contains("\"Errors\""), raw);
        assertFalse(raw.contains("\"errors\""), raw);
    }
}
