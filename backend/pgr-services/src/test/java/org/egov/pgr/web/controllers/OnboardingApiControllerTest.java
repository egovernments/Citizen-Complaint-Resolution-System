package org.egov.pgr.web.controllers;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.Parameterized;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Arrays;
import java.util.Collection;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@RunWith(Parameterized.class)
public class OnboardingApiControllerTest {

    private final String path;
    private final String operation;
    private MockMvc mockMvc;

    public OnboardingApiControllerTest(String path, String operation) {
        this.path = path;
        this.operation = operation;
    }

    @Parameterized.Parameters(name = "{index}: POST {0}")
    public static Collection<Object[]> routes() {
        return Arrays.asList(new Object[][]{
                {"/v2/onboarding/signups/_create", "signups.create"},
                {"/v2/onboarding/signups/_update", "signups.update"},
                {"/v2/onboarding/signups/_search", "signups.search"},
                {"/v2/onboarding/identifiers/_check", "identifiers.check"},
                {"/v2/onboarding/signups/_submit", "signups.submit"},
                {"/v2/onboarding/operations/_search", "operations.search"},
                {"/v2/onboarding/operations/_retry", "operations.retry"}
        });
    }

    @Before
    public void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(new OnboardingApiController()).build();
    }

    @Test
    public void routeIsReservedWithoutInvokingAnImplementation() throws Exception {
        mockMvc.perform(post(path)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isNotImplemented())
                .andExpect(jsonPath("$.code").value("PGR_ONBOARDING_NOT_IMPLEMENTED"))
                .andExpect(jsonPath("$.operation").value(operation));
    }
}
