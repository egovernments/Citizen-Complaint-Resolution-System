package org.egov.userpreference.controller;

import com.fasterxml.jackson.databind.JsonNode;
import org.egov.userpreference.support.ApiTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class PreferenceSearchApiTest extends ApiTestBase {

    private void seed(String userId, String tenantId, String code, String language, long createdTime) {
        jdbcTemplate.update("INSERT INTO user_preference (id, user_id, tenant_id, preference_code, payload, "
                        + "created_by, created_time, last_modified_by, last_modified_time) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                java.util.UUID.randomUUID().toString(), userId, tenantId, code,
                "{\"preferredLanguage\":\"" + language + "\"}",
                "seed", createdTime, "seed", createdTime);
    }

    @Test
    void findsAPreferenceByUserAndTenant() throws Exception {
        seed("user-1", "pg.citya", "USER_NOTIFICATION_PREFERENCES", "en_IN", 1000L);

        String body = """
                {
                  "RequestInfo": { "apiId": "user-preferences", "ver": "1.0", "msgId": "msg-s1" },
                  "criteria": { "userId": "user-1", "tenantId": "pg.citya", "limit": 10, "offset": 0 }
                }
                """;

        search(body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.responseInfo.status").value("successful"))
                .andExpect(jsonPath("$.responseInfo.msgId").value("msg-s1"))
                .andExpect(jsonPath("$.preferences", hasSize(1)))
                .andExpect(jsonPath("$.preferences[0].userId").value("user-1"))
                .andExpect(jsonPath("$.preferences[0].payload.preferredLanguage").value("en_IN"))
                .andExpect(jsonPath("$.pagination.limit").value(10))
                .andExpect(jsonPath("$.pagination.totalCount").value(1))
                // offset 0 was omitted by the Go struct's omitempty tag.
                .andExpect(jsonPath("$.pagination.offset").doesNotExist());
    }

    @Test
    void appliesTheDefaultPageSizeWhenNoLimitIsGiven() throws Exception {
        seed("user-1", "pg.citya", "USER_NOTIFICATION_PREFERENCES", "en_IN", 1000L);

        String body = """
                {
                  "RequestInfo": {},
                  "criteria": { "userId": "user-1" }
                }
                """;

        search(body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pagination.limit").value(10));
    }

    @Test
    void clampsAnOversizedPageToTheMaximum() throws Exception {
        seed("user-1", "pg.citya", "USER_NOTIFICATION_PREFERENCES", "en_IN", 1000L);

        String body = """
                {
                  "RequestInfo": {},
                  "criteria": { "userId": "user-1", "limit": 5000 }
                }
                """;

        search(body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pagination.limit").value(100));
    }

    @Test
    void treatsAnExplicitZeroLimitAsTheDefault() throws Exception {
        seed("user-1", "pg.citya", "USER_NOTIFICATION_PREFERENCES", "en_IN", 1000L);

        String body = """
                {
                  "RequestInfo": {},
                  "criteria": { "userId": "user-1", "limit": 0 }
                }
                """;

        search(body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pagination.limit").value(10))
                .andExpect(jsonPath("$.preferences", hasSize(1)));
    }

    @Test
    void returnsAnEmptyArrayRatherThanNullWhenNothingMatches() throws Exception {
        // novu-bridge reads body.get("preferences") and length-checks it, so a
        // null here would be a different code path for it than an empty list.
        String body = """
                {
                  "RequestInfo": {},
                  "criteria": { "userId": "nobody", "tenantId": "pg.citya" }
                }
                """;

        MvcResult result = search(body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences", hasSize(0)))
                // totalCount 0 is omitted, matching the Go omitempty tag.
                .andExpect(jsonPath("$.pagination.totalCount").doesNotExist())
                .andReturn();

        JsonNode preferences = json(result).get("preferences");
        assertEquals(true, preferences.isArray());
    }

    @Test
    void searchesByTenantAlone() throws Exception {
        seed("user-1", "pg.citya", "USER_NOTIFICATION_PREFERENCES", "en_IN", 1000L);
        seed("user-2", "pg.citya", "USER_NOTIFICATION_PREFERENCES", "hi_IN", 2000L);
        seed("user-3", "pg.cityb", "USER_NOTIFICATION_PREFERENCES", "fr_IN", 3000L);

        String body = """
                {
                  "RequestInfo": {},
                  "criteria": { "tenantId": "pg.citya" }
                }
                """;

        search(body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences", hasSize(2)))
                .andExpect(jsonPath("$.pagination.totalCount").value(2));
    }

    @Test
    void searchesByPreferenceCodeAlone() throws Exception {
        seed("user-1", "pg.citya", "USER_NOTIFICATION_PREFERENCES", "en_IN", 1000L);
        seed("user-2", "pg.cityb", "UI_DASHBOARD_LAYOUT", "hi_IN", 2000L);

        String body = """
                {
                  "RequestInfo": {},
                  "criteria": { "preferenceCode": "USER_NOTIFICATION_PREFERENCES", "limit": 10 }
                }
                """;

        search(body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences", hasSize(1)))
                .andExpect(jsonPath("$.preferences[0].preferenceCode").value("USER_NOTIFICATION_PREFERENCES"));
    }

    @Test
    void returnsTheMostRecentlyCreatedPreferenceFirst() throws Exception {
        seed("user-old", "pg.citya", "USER_NOTIFICATION_PREFERENCES", "en_IN", 1000L);
        seed("user-mid", "pg.citya", "USER_NOTIFICATION_PREFERENCES", "hi_IN", 2000L);
        seed("user-new", "pg.citya", "USER_NOTIFICATION_PREFERENCES", "fr_IN", 3000L);

        String body = """
                {
                  "RequestInfo": {},
                  "criteria": { "tenantId": "pg.citya" }
                }
                """;

        search(body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences[0].userId").value("user-new"))
                .andExpect(jsonPath("$.preferences[1].userId").value("user-mid"))
                .andExpect(jsonPath("$.preferences[2].userId").value("user-old"));
    }

    @Test
    void pagesThroughTheResultsWithLimitAndOffset() throws Exception {
        seed("user-old", "pg.citya", "USER_NOTIFICATION_PREFERENCES", "en_IN", 1000L);
        seed("user-mid", "pg.citya", "USER_NOTIFICATION_PREFERENCES", "hi_IN", 2000L);
        seed("user-new", "pg.citya", "USER_NOTIFICATION_PREFERENCES", "fr_IN", 3000L);

        String body = """
                {
                  "RequestInfo": {},
                  "criteria": { "tenantId": "pg.citya", "limit": 2, "offset": 1 }
                }
                """;

        search(body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences", hasSize(2)))
                .andExpect(jsonPath("$.preferences[0].userId").value("user-mid"))
                .andExpect(jsonPath("$.preferences[1].userId").value("user-old"))
                .andExpect(jsonPath("$.pagination.limit").value(2))
                .andExpect(jsonPath("$.pagination.offset").value(1))
                // The count is of everything matching, not of the page returned.
                .andExpect(jsonPath("$.pagination.totalCount").value(3));
    }

    @Test
    void doesNotMatchAGlobalPreferenceWhenATenantIsAskedFor() throws Exception {
        seed("user-1", "", "USER_NOTIFICATION_PREFERENCES", "en_IN", 1000L);

        String tenantScoped = """
                {
                  "RequestInfo": {},
                  "criteria": { "userId": "user-1", "tenantId": "pg.citya" }
                }
                """;

        search(tenantScoped)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences", hasSize(0)));

        String userOnly = """
                {
                  "RequestInfo": {},
                  "criteria": { "userId": "user-1" }
                }
                """;

        search(userOnly)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences", hasSize(1)))
                .andExpect(jsonPath("$.preferences[0].tenantId").doesNotExist());
    }
}
