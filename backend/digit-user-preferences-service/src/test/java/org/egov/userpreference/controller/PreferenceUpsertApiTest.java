package org.egov.userpreference.controller;

import com.fasterxml.jackson.databind.JsonNode;
import org.egov.userpreference.support.ApiTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class PreferenceUpsertApiTest extends ApiTestBase {

    private static final String CREATE_BODY = """
            {
              "RequestInfo": {
                "apiId": "user-preferences",
                "ver": "1.0",
                "ts": 1707100000000,
                "action": "upsert",
                "msgId": "msg-001",
                "userInfo": { "uuid": "user-uuid-1", "tenantId": "pg.citya" }
              },
              "preference": {
                "userId": "user-uuid-1",
                "tenantId": "pg.citya",
                "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                "payload": {
                  "preferredLanguage": "en_IN",
                  "consent": {
                    "WHATSAPP": { "status": "GRANTED", "scope": "GLOBAL" },
                    "SMS": { "status": "GRANTED", "scope": "TENANT", "tenantId": "pg.citya" },
                    "EMAIL": { "status": "REVOKED", "scope": "GLOBAL" }
                  }
                }
              }
            }
            """;

    @Test
    void createsAPreferenceAndEchoesTheRequestIdentifiers() throws Exception {
        upsert(CREATE_BODY)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.responseInfo.status").value("successful"))
                .andExpect(jsonPath("$.responseInfo.apiId").value("user-preferences"))
                .andExpect(jsonPath("$.responseInfo.ver").value("1.0"))
                .andExpect(jsonPath("$.responseInfo.msgId").value("msg-001"))
                .andExpect(jsonPath("$.responseInfo.ts").isNumber())
                // The Go NewResponseInfo never populated resMsgId; keep it absent.
                .andExpect(jsonPath("$.responseInfo.resMsgId").doesNotExist())
                // Only _search carries a pagination block.
                .andExpect(jsonPath("$.pagination").doesNotExist())
                .andExpect(jsonPath("$.preferences", org.hamcrest.Matchers.hasSize(1)))
                .andExpect(jsonPath("$.preferences[0].id").isNotEmpty())
                .andExpect(jsonPath("$.preferences[0].userId").value("user-uuid-1"))
                .andExpect(jsonPath("$.preferences[0].tenantId").value("pg.citya"))
                .andExpect(jsonPath("$.preferences[0].preferenceCode").value("USER_NOTIFICATION_PREFERENCES"))
                .andExpect(jsonPath("$.preferences[0].payload.preferredLanguage").value("en_IN"))
                .andExpect(jsonPath("$.preferences[0].payload.consent.WHATSAPP.status").value("GRANTED"))
                .andExpect(jsonPath("$.preferences[0].payload.consent.SMS.tenantId").value("pg.citya"))
                .andExpect(jsonPath("$.preferences[0].auditDetails.createdBy").value("user-uuid-1"))
                .andExpect(jsonPath("$.preferences[0].auditDetails.lastModifiedBy").value("user-uuid-1"));
    }

    @Test
    void mintsAUuidWhenTheCallerSuppliesNoId() throws Exception {
        MvcResult result = upsert(CREATE_BODY).andExpect(status().isOk()).andReturn();
        String id = json(result).at("/preferences/0/id").asText();
        assertNotNull(java.util.UUID.fromString(id), "id should be a uuid");
    }

    @Test
    void honoursACallerSuppliedIdOnCreate() throws Exception {
        String body = CREATE_BODY.replace("\"userId\": \"user-uuid-1\"",
                "\"id\": \"11111111-2222-3333-4444-555555555555\", \"userId\": \"user-uuid-1\"");

        upsert(body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences[0].id").value("11111111-2222-3333-4444-555555555555"));
    }

    @Test
    void reusesTheSameRowAndPreservesTheCreationAuditOnUpdate() throws Exception {
        MvcResult created = upsert(CREATE_BODY).andExpect(status().isOk()).andReturn();
        JsonNode createdPreference = json(created).at("/preferences/0");
        String createdId = createdPreference.get("id").asText();
        long createdTime = createdPreference.at("/auditDetails/createdTime").asLong();

        // An employee editing a citizen's record: the audit records the
        // editor, not the owner. A citizen principal could not do this, which
        // OwnershipApiTest covers.
        String updateBody = """
                {
                  "RequestInfo": {
                    "msgId": "msg-002",
                    "userInfo": {
                      "uuid": "editor-uuid",
                      "tenantId": "pg.citya",
                      "roles": [ { "code": "EMPLOYEE" } ]
                    }
                  },
                  "preference": {
                    "userId": "user-uuid-1",
                    "tenantId": "pg.citya",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "payload": {
                      "preferredLanguage": "hi_IN",
                      "consent": { "WHATSAPP": { "status": "REVOKED", "scope": "GLOBAL" } }
                    }
                  }
                }
                """;

        MvcResult updated = upsert(updateBody).andExpect(status().isOk()).andReturn();
        JsonNode updatedPreference = json(updated).at("/preferences/0");

        assertEquals(createdId, updatedPreference.get("id").asText(), "upsert must land on the same row");
        assertEquals("hi_IN", updatedPreference.at("/payload/preferredLanguage").asText());
        assertEquals("REVOKED", updatedPreference.at("/payload/consent/WHATSAPP/status").asText());
        // The SMS and EMAIL consent from the first call is gone: the payload is
        // replaced wholesale, not merged.
        assertTrue(updatedPreference.at("/payload/consent/SMS").isMissingNode());

        assertEquals("user-uuid-1", updatedPreference.at("/auditDetails/createdBy").asText());
        assertEquals(createdTime, updatedPreference.at("/auditDetails/createdTime").asLong());
        assertEquals("editor-uuid", updatedPreference.at("/auditDetails/lastModifiedBy").asText());

        assertEquals(1, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM user_preference", Integer.class));
    }

    @Test
    void storesTenantScopedAndGlobalPreferencesAsDistinctRows() throws Exception {
        upsert(CREATE_BODY).andExpect(status().isOk());

        String globalBody = """
                {
                  "RequestInfo": { "userInfo": { "uuid": "user-uuid-1" } },
                  "preference": {
                    "userId": "user-uuid-1",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "payload": { "preferredLanguage": "fr_IN" }
                  }
                }
                """;

        upsert(globalBody)
                .andExpect(status().isOk())
                // An absent tenant is stored as the empty string and omitted on the way out.
                .andExpect(jsonPath("$.preferences[0].tenantId").doesNotExist());

        assertEquals(2, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM user_preference", Integer.class));
        assertEquals("", jdbcTemplate.queryForObject(
                "SELECT tenant_id FROM user_preference WHERE payload LIKE '%fr_IN%'", String.class));
    }

    @Test
    void updatesTheGlobalRowOnASecondGlobalUpsert() throws Exception {
        String globalBody = """
                {
                  "RequestInfo": { "userInfo": { "uuid": "user-uuid-2" } },
                  "preference": {
                    "userId": "user-uuid-2",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "payload": { "preferredLanguage": "fr_IN" }
                  }
                }
                """;

        MvcResult first = upsert(globalBody).andExpect(status().isOk()).andReturn();
        MvcResult second = upsert(globalBody.replace("fr_IN", "pt_IN")).andExpect(status().isOk()).andReturn();

        assertEquals(json(first).at("/preferences/0/id").asText(),
                json(second).at("/preferences/0/id").asText());
        assertEquals("pt_IN", json(second).at("/preferences/0/payload/preferredLanguage").asText());
        assertEquals(1, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM user_preference", Integer.class));
    }

    @Test
    void keepsPreferencesForDifferentUsersApart() throws Exception {
        upsert(CREATE_BODY).andExpect(status().isOk());
        upsert(CREATE_BODY.replace("user-uuid-1", "user-uuid-9")).andExpect(status().isOk());

        assertEquals(2, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM user_preference", Integer.class));
    }

    @Test
    void skipsSchemaValidationForAnyOtherPreferenceCode() throws Exception {
        // Only USER_NOTIFICATION_PREFERENCES has a known payload schema; every
        // other code stores an arbitrary document, including one that would
        // fail the notification checks.
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "userId": "user-uuid-3",
                    "preferenceCode": "UI_DASHBOARD_LAYOUT",
                    "payload": {
                      "preferredLanguage": "kl_XX",
                      "widgets": [ { "id": "open-complaints", "span": 2 } ]
                    }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences[0].payload.preferredLanguage").value("kl_XX"))
                .andExpect(jsonPath("$.preferences[0].payload.widgets[0].span").value(2));
    }

    @Test
    void storesThePayloadVerbatimIncludingUnknownAndLowercasedKeys() throws Exception {
        // The payload is an opaque document: it is parsed to validate it and
        // then stored as sent, so a caller's own key casing survives. That is
        // load-bearing — novu-bridge reads consent.WHATSAPP with exact casing.
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "userId": "user-uuid-4",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "payload": {
                      "preferredLanguage": "en_IN",
                      "quietHours": { "from": "22:00", "to": "07:00" },
                      "consent": {
                        "whatsapp": { "status": "GRANTED", "scope": "GLOBAL" },
                        "PUSH": { "status": "GRANTED", "scope": "GLOBAL" }
                      }
                    }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences[0].payload.quietHours.from").value("22:00"))
                .andExpect(jsonPath("$.preferences[0].payload.consent.whatsapp.status").value("GRANTED"))
                .andExpect(jsonPath("$.preferences[0].payload.consent.PUSH.status").value("GRANTED"))
                .andExpect(jsonPath("$.preferences[0].payload.consent.WHATSAPP").doesNotExist());
    }

    @Test
    void trimsWhitespaceAroundTheKeyFieldsBeforeStoring() throws Exception {
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "userId": "  user-uuid-5  ",
                    "preferenceCode": "  USER_PROFILE  ",
                    "payload": { "k": "v" }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences[0].userId").value("user-uuid-5"))
                .andExpect(jsonPath("$.preferences[0].preferenceCode").value("USER_PROFILE"));
    }

    @Test
    void recordsTheNumericUserIdAsTheAuditAuthorWhenNoUuidIsPresent() throws Exception {
        String body = """
                {
                  "RequestInfo": { "userInfo": { "id": 4242, "userName": "gro" } },
                  "preference": {
                    "userId": "user-uuid-6",
                    "preferenceCode": "USER_PROFILE",
                    "payload": { "k": "v" }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences[0].auditDetails.createdBy").value("4242"));
    }

    @Test
    void acceptsAQuotedUserIdJustAsReadilyAsANumericOne() throws Exception {
        String body = """
                {
                  "RequestInfo": { "userInfo": { "id": "4243" } },
                  "preference": {
                    "userId": "user-uuid-7",
                    "preferenceCode": "USER_PROFILE",
                    "payload": { "k": "v" }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences[0].auditDetails.createdBy").value("4243"));
    }

    @Test
    void fallsBackToRequesterIdWhenThereIsNoUserInfo() throws Exception {
        String body = """
                {
                  "RequestInfo": { "requesterId": "seed-job" },
                  "preference": {
                    "userId": "user-uuid-8",
                    "preferenceCode": "USER_PROFILE",
                    "payload": { "k": "v" }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences[0].auditDetails.createdBy").value("seed-job"));
    }

    @Test
    void attributesAnUnidentifiedCallerToSystem() throws Exception {
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "userId": "user-uuid-10",
                    "preferenceCode": "USER_PROFILE",
                    "payload": { "k": "v" }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences[0].auditDetails.createdBy").value("system"))
                .andExpect(jsonPath("$.preferences[0].auditDetails.lastModifiedBy").value("system"));
    }

    @Test
    void roundTripsAnExplicitlyNullPayload() throws Exception {
        // `"payload": null` is present-but-empty rather than missing, so it
        // clears validation and is stored as a jsonb null.
        String body = """
                {
                  "RequestInfo": {},
                  "preference": {
                    "userId": "user-uuid-11",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "payload": null
                  }
                }
                """;

        MvcResult result = upsert(body).andExpect(status().isOk()).andReturn();
        assertTrue(json(result).at("/preferences/0/payload").isNull());
    }

    @Test
    void movesTheModificationTimestampOnEveryUpdate() throws Exception {
        MvcResult created = upsert(CREATE_BODY).andExpect(status().isOk()).andReturn();
        long firstModified = json(created).at("/preferences/0/auditDetails/lastModifiedTime").asLong();

        Thread.sleep(5);

        MvcResult updated = upsert(CREATE_BODY).andExpect(status().isOk()).andReturn();
        long secondModified = json(updated).at("/preferences/0/auditDetails/lastModifiedTime").asLong();

        assertNotEquals(firstModified, secondModified);
        assertTrue(secondModified > firstModified);
    }
}
