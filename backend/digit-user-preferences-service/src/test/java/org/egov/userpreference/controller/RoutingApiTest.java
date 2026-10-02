package org.egov.userpreference.controller;

import org.egov.userpreference.support.ApiTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Routing failures keep their own status instead of collapsing into a 500.
 * The blanket exception handler is the one place that could get this wrong.
 */
class RoutingApiTest extends ApiTestBase {

    @Test
    void returnsNotFoundForAnUnknownPath() throws Exception {
        mockMvc.perform(post("/user-preference/v1/_nope")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.Errors[0].code").value("NOT_FOUND"));
    }

    @Test
    void returnsMethodNotAllowedForAGetOnAnUpsert() throws Exception {
        mockMvc.perform(get(UPSERT_URL))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(jsonPath("$.Errors[0].code").value("METHOD_NOT_ALLOWED"));
    }

    @Test
    void returnsUnsupportedMediaTypeForANonJsonBody() throws Exception {
        mockMvc.perform(post(SEARCH_URL)
                        .contentType(MediaType.TEXT_PLAIN)
                        .content("not json"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.Errors[0].code").value("UNSUPPORTED_MEDIA_TYPE"));
    }
}
