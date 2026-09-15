package org.egov.userpreference.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * Shared plumbing for the API tests: a MockMvc bound to the real application
 * context over H2, and a table truncated between tests so each one starts from
 * a known state.
 */
@SpringBootTest
@AutoConfigureMockMvc
public abstract class ApiTestBase {

    protected static final String UPSERT_URL = "/user-preference/v1/_upsert";
    protected static final String SEARCH_URL = "/user-preference/v1/_search";

    @Autowired
    protected MockMvc mockMvc;

    @Autowired
    protected ObjectMapper objectMapper;

    @Autowired
    protected JdbcTemplate jdbcTemplate;

    @BeforeEach
    void clearPreferences() {
        jdbcTemplate.update("DELETE FROM user_preference");
    }

    protected ResultActions upsert(String body) throws Exception {
        return mockMvc.perform(post(UPSERT_URL).contentType(MediaType.APPLICATION_JSON).content(body));
    }

    protected ResultActions search(String body) throws Exception {
        return mockMvc.perform(post(SEARCH_URL).contentType(MediaType.APPLICATION_JSON).content(body));
    }

    protected JsonNode json(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsString());
    }
}
